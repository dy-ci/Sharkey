/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import type {
	MiMeta,
	UsersRepository,
	UserProfilesRepository,
	RegistrationTicketsRepository,
} from '@/models/_.js';
import type { Redis as RedisClient } from 'ioredis';
import type { MiLocalUser } from '@/models/User.js';
import { LogtoOidcService } from '@/core/LogtoOidcService.js';
import { SignupService } from '@/core/SignupService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { bindThis } from '@/decorators.js';
import { FastifyReplyError } from '@/misc/fastify-reply-error.js';
import { InternalEventService } from '@/global/InternalEventService.js';
import { RoleService } from '@/core/RoleService.js';
import { EmailService } from '@/core/EmailService.js';
import { CacheService } from '@/core/CacheService.js';
import { TimeService } from '@/global/TimeService.js';
import Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { SigninService } from './SigninService.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

const REG_EXPIRY_SECONDS = 600; // 10 minutes
const REAUTH_EXPIRY_SECONDS = 300; // 5 minutes — window to set a password after step-up

/**
 * Redis key for the one-time marker proving a user just completed an SSO
 * step-up re-authentication. Consumed by the i/set-password endpoint.
 */
export const logtoReauthRedisKey = (userId: string): string => `logto:oidc:reauth:${userId}`;

/**
 * The pending OIDC identity stashed in Redis while the user is asked for an
 * invitation code (invitation-only instances).
 */
type PendingRegistration = {
	sub: string;
	email: string;
	emailVerified: boolean;
	name: string | null;
	preferredUsername: string | null;
};

/**
 * Result of resolving an authenticated OIDC identity to a local account.
 * Either we have a usable user, or the instance is invitation-only and the
 * brand-new user must supply an invitation code to finish signing up.
 */
type ResolveResult =
	| { type: 'user'; user: MiLocalUser }
	| { type: 'needInvite'; regToken: string };

@Injectable()
export class LogtoApiService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.redis)
		private redis: RedisClient,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.registrationTicketsRepository)
		private registrationTicketsRepository: RegistrationTicketsRepository,

		private logtoOidcService: LogtoOidcService,
		private signupService: SignupService,
		private userEntityService: UserEntityService,
		private signinService: SigninService,
		private internalEventService: InternalEventService,
		private roleService: RoleService,
		private emailService: EmailService,
		private cacheService: CacheService,
		private readonly timeService: TimeService,
		private readonly loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('logto-api');
	}

	/**
	 * POST /api/logto/auth
	 * Generate authorization URL for Logto login
	 */
	@bindThis
	public async auth(request: FastifyRequest, reply: FastifyReply) {
		if (!this.logtoOidcService.isConfigured()) {
			throw new FastifyReplyError(503, 'Logto OIDC is not configured');
		}

		try {
			const { url, state } = await this.logtoOidcService.getAuthorizationUrl();
			reply.code(200);
			return { url, state };
		} catch (error) {
			this.logger.error('Failed to generate authorization URL', error as Error);
			throw new FastifyReplyError(500, 'Failed to initiate Logto login');
		}
	}

	/**
	 * GET /api/logto/callback
	 * Handle callback from Logto after authentication
	 */
	@bindThis
	public async callback(
		request: FastifyRequest<{
			Querystring: {
				code?: string;
				state?: string;
				error?: string;
				error_description?: string;
			};
		}>,
		reply: FastifyReply,
	) {
		const { code, state, error, error_description } = request.query;

		// Check for errors from Logto
		if (error) {
			this.logger.warn(`Logto returned error: ${error} - ${error_description}`);
			return reply.redirect(`${this.config.url}/logto-callback?loginError=${encodeURIComponent(error_description || error)}`);
		}

		// Validate required parameters
		if (!code || !state) {
			return reply.redirect(`${this.config.url}/logto-callback?loginError=${encodeURIComponent('Missing authorization code or state')}`);
		}

		try {
			// Exchange code for tokens and get user info
			const { sub, email, emailVerified, name, preferredUsername, purpose, userId } = await this.logtoOidcService.exchangeCodeForTokens(code, state);

			// Step-up re-authentication (e.g. before setting a first local password):
			// don't sign in or create anything — just verify the returned identity
			// matches the initiating account, then drop a short-lived one-time marker.
			if (purpose === 'reauth') {
				return await this.handleReauthCallback(reply, sub, userId);
			}

			// Resolve to a local account (or request an invitation code)
			const result = await this.resolveUser(sub, email, emailVerified, name, preferredUsername);

			// Invitation-only instance, brand-new user: ask for an invitation code
			if (result.type === 'needInvite') {
				return reply.redirect(`${this.config.url}/logto-callback?needInvite=true&regToken=${encodeURIComponent(result.regToken)}`);
			}

			const user = result.user;

			// Check if user is approved (manual approval flow preserved)
			if (!user.approved) {
				await this.sendPendingApprovalNotifications(user);
				return reply.redirect(`${this.config.url}/logto-callback?pendingApproval=true`);
			}

			// Generate token and sign in.
			// NOTE: signinService.signin() calls reply.code(200) internally. In
			// Fastify 5, reply.redirect(url) without an explicit status reuses the
			// already-set code (200), which sends "200 + Location" and the browser
			// does NOT follow it. We must pass 302 explicitly.
			const signinResult = await this.signinService.signin(request, reply, user);
			return reply.redirect(`${this.config.url}/logto-callback#i=${signinResult.i}`, 302);
		} catch (err) {
			this.logger.error('Failed to handle Logto callback', err as Error);
			return reply.redirect(`${this.config.url}/logto-callback?loginError=${encodeURIComponent((err as Error).message)}`);
		}
	}

	/**
	 * Finish an SSO step-up re-authentication initiated from the security
	 * settings. Verifies the returned identity (sub) belongs to the account that
	 * started the flow, then writes a short-lived one-time marker that
	 * i/set-password consumes. Redirects back to the settings page either way.
	 */
	@bindThis
	private async handleReauthCallback(reply: FastifyReply, sub: string, userId: string | null) {
		const settingsUrl = `${this.config.url}/settings/security`;

		if (!userId) {
			return reply.redirect(`${settingsUrl}?passwordReauth=error`, 302);
		}

		const profile = await this.userProfilesRepository.findOneBy({ userId });
		if (!profile || profile.logtoSub !== sub) {
			this.logger.warn(`Step-up re-auth identity mismatch for user ${userId}`);
			return reply.redirect(`${settingsUrl}?passwordReauth=error`, 302);
		}

		await this.redis.setex(logtoReauthRedisKey(userId), REAUTH_EXPIRY_SECONDS, '1');
		this.logger.info(`Step-up re-auth succeeded for user ${userId}`);
		return reply.redirect(`${settingsUrl}?passwordReauth=ok`, 302);
	}

	/**
	 * POST /api/logto/complete-signup
	 * Finish an invitation-gated OIDC signup: validate the invitation code,
	 * create the account and sign the user in (or hand off to approval).
	 */
	@bindThis
	public async completeSignup(
		request: FastifyRequest<{
			Body: {
				regToken?: string;
				invitationCode?: string;
			};
		}>,
		reply: FastifyReply,
	) {
		const { regToken, invitationCode } = request.body ?? {};

		if (!regToken) {
			throw new FastifyReplyError(400, 'Missing registration token');
		}

		// Retrieve and consume the pending OIDC identity
		const redisKey = `logto:oidc:reg:${regToken}`;
		const raw = await this.redis.get(redisKey);
		if (!raw) {
			throw new FastifyReplyError(400, 'Registration session expired, please sign in again');
		}
		await this.redis.del(redisKey);

		let pending: PendingRegistration;
		try {
			pending = JSON.parse(raw) as PendingRegistration;
		} catch {
			throw new FastifyReplyError(400, 'Corrupted registration session');
		}

		// Validate the invitation code (mirrors SignupApiService)
		if (!invitationCode || typeof invitationCode !== 'string') {
			throw new FastifyReplyError(400, 'Invitation code is required');
		}

		const ticket = await this.registrationTicketsRepository.findOneBy({ code: invitationCode });

		if (ticket == null || ticket.usedById != null) {
			throw new FastifyReplyError(400, 'Invalid invitation code');
		}

		if (ticket.expiresAt && ticket.expiresAt < this.timeService.date) {
			throw new FastifyReplyError(400, 'Invitation code has expired');
		}

		// Create the account
		const user = await this.createUser(pending.sub, pending.email, pending.emailVerified, pending.name, pending.preferredUsername);

		// Mark the invitation code as used
		await this.registrationTicketsRepository.update(ticket.id, {
			usedAt: this.timeService.date,
			usedById: user.id,
		});

		reply.code(200);

		// Manual approval flow
		if (!user.approved) {
			await this.sendPendingApprovalNotifications(user);
			return { pendingApproval: true };
		}

		const signinResult = await this.signinService.signin(request, reply, user);
		return { token: signinResult.i };
	}

	/**
	 * Resolve an authenticated OIDC identity to a local account.
	 * - Linked account (by logtoSub) -> sign in.
	 * - Existing account with the same *verified* email -> link & sign in.
	 * - Brand-new user on an invitation-only instance -> needInvite.
	 * - Brand-new user otherwise -> create.
	 */
	private async resolveUser(sub: string, email: string, emailVerified: boolean, name: string | null, preferredUsername: string | null): Promise<ResolveResult> {
		// 1. Already linked to Logto
		const existingProfileBySub = await this.userProfilesRepository.findOneBy({ logtoSub: sub });
		if (existingProfileBySub) {
			const user = await this.usersRepository.findOneBy({ id: existingProfileBySub.userId });
			if (!user) {
				throw new Error('Linked user not found');
			}
			await this.fillDisplayNameIfEmpty(user as MiLocalUser, name);
			return { type: 'user', user: user as MiLocalUser };
		}

		// 2. Existing local account with the same email — only auto-link when the
		//    email is verified by the IdP, to prevent account takeover.
		const existingProfileByEmail = await this.userProfilesRepository.findOneBy({ email });
		if (existingProfileByEmail) {
			if (!emailVerified) {
				throw new Error('An account with this email already exists, but the email is not verified by the identity provider. Cannot link automatically.');
			}

			await this.userProfilesRepository.update(
				{ userId: existingProfileByEmail.userId },
				{ logtoSub: sub },
			);

			const user = await this.usersRepository.findOneBy({ id: existingProfileByEmail.userId });
			if (!user) {
				throw new Error('User not found');
			}

			await this.fillDisplayNameIfEmpty(user as MiLocalUser, name);
			this.logger.info(`Linked Logto account to existing user: ${existingProfileByEmail.userId}`);
			return { type: 'user', user: user as MiLocalUser };
		}

		// 3. Brand-new user on an invitation-only instance: defer to invite step
		if (this.meta.disableRegistration) {
			const regToken = randomBytes(32).toString('hex');
			const pending: PendingRegistration = { sub, email, emailVerified, name, preferredUsername };
			await this.redis.setex(`logto:oidc:reg:${regToken}`, REG_EXPIRY_SECONDS, JSON.stringify(pending));
			this.logger.info('New Logto user on invitation-only instance, requesting invitation code');
			return { type: 'needInvite', regToken };
		}

		// 4. Brand-new user, open registration
		const user = await this.createUser(sub, email, emailVerified, name, preferredUsername);
		return { type: 'user', user };
	}

	/**
	 * Create a new passwordless local account from an OIDC identity.
	 */
	private async createUser(sub: string, email: string, emailVerified: boolean, name: string | null, preferredUsername: string | null): Promise<MiLocalUser> {
		const { account } = await this.signupService.signup({
			// Prefer the IdP's username, falling back to the email local-part.
			username: await this.generateAvailableUsername(preferredUsername, email),
			password: null, // Passwordless: this account authenticates via Logto
			host: null,
			reason: 'Signed up via Logto SSO',
			approved: !this.meta.approvalRequiredForSignup,
		});

		// Link Logto sub, record the email, and sync the display name from the IdP.
		await this.userProfilesRepository.update(
			{ userId: account.id },
			{ logtoSub: sub, email, emailVerified },
		);

		// signup() does not accept a display name, so set it here.
		await this.fillDisplayNameIfEmpty(account as MiLocalUser, name);

		this.logger.info(`Created new user via Logto: ${account.id}`);

		return account as MiLocalUser;
	}

	/**
	 * Populate a user's display name (MiUser.name) from the IdP-provided name,
	 * but only when the account has no display name yet — never overwrite a name
	 * the user has set themselves. MiUser.name is capped at 50 chars (nameSchema).
	 */
	private async fillDisplayNameIfEmpty(user: MiLocalUser, name: string | null): Promise<void> {
		if (user.name != null && user.name.length > 0) return;

		const displayName = (name ?? '').trim().substring(0, 50);
		if (displayName.length === 0) return;

		await this.usersRepository.update(user.id, { name: displayName });
		user.name = displayName;
	}

	/**
	 * Generate a unique, valid username. Prefers a sanitized form of the IdP's
	 * username claim, then the email local-part, then a generic fallback.
	 */
	private async generateAvailableUsername(preferred: string | null, email: string): Promise<string> {
		const sanitize = (raw: string): string => raw
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, '')
			.substring(0, 18);

		const base =
			(preferred ? sanitize(preferred) : '') ||
			sanitize(email.split('@')[0] ?? '') ||
			'user';

		// Try the base name first, then append a short random suffix on collision.
		for (let i = 0; i < 10; i++) {
			const candidate = i === 0 ? base : `${base}${randomBytes(3).toString('hex')}`;
			const exists = await this.usersRepository.exists({ where: { usernameLower: candidate.toLowerCase(), host: IsNull() } });
			if (!exists) {
				return candidate;
			}
		}

		// Extremely unlikely fallback
		return `${base}${randomBytes(6).toString('hex')}`;
	}

	/**
	 * Send notifications to the user and moderators about pending approval.
	 */
	private async sendPendingApprovalNotifications(user: MiLocalUser) {
		const userProfile = await this.userProfilesRepository.findOneBy({ userId: user.id });

		if (userProfile?.email) {
			await this.emailService.sendEmail(
				userProfile.email,
				'Account pending approval',
				'Your account has been created and is awaiting approval. We will notify you once it has been reviewed.',
				'Your account has been created and is awaiting approval. We will notify you once it has been reviewed.',
			);
		}

		const moderators = await this.roleService.getModerators();

		for (const moderator of moderators) {
			const profile = await this.userProfilesRepository.findOneBy({ userId: moderator.id });

			if (profile?.email) {
				await this.emailService.sendEmail(
					profile.email,
					'New user awaiting approval',
					`A new user called ${user.username} signed up via Logto SSO and is awaiting approval.`,
					`A new user called ${user.username} signed up via Logto SSO and is awaiting approval.`,
				);
			}
		}
	}
}
