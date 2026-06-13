/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '@/config.js';
import { DI } from '@/di-symbols.js';
import type {
	MiMeta,
	UsersRepository,
	UserProfilesRepository,
} from '@/models/_.js';
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

@Injectable()
export class LogtoApiService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

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
		this.logger = this.loggerService.getLogger('LogtoApi');
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
			return reply.redirect(`${this.config.url}/?loginError=${encodeURIComponent(error_description || error)}`);
		}

		// Validate required parameters
		if (!code || !state) {
			return reply.redirect(`${this.config.url}/?loginError=Missing authorization code or state`);
		}

		try {
			// Exchange code for tokens and get user info
			const { sub, email } = await this.logtoOidcService.exchangeCodeForTokens(code, state);

			// Find or create user
			let user = await this.findOrCreateUser(sub, email);

			// Check if user is approved
			if (!user.approved) {
				// Send pending approval notification
				await this.sendPendingApprovalNotifications(user);

				// Redirect to pending approval page
				return reply.redirect(`${this.config.url}/logto-callback?pendingApproval=true`);
			}

			// Generate token and sign in
			const result = this.signinService.signin(request, reply, user as MiLocalUser);

			// Redirect to home with token
			const response = await result;
			const token = response.i;
			return reply.redirect(`${this.config.url}/logto-callback#i=${token}`);
		} catch (error) {
			this.logger.error('Failed to handle Logto callback', error as Error);
			return reply.redirect(`${this.config.url}/?loginError=${encodeURIComponent((error as Error).message)}`);
		}
	}

	/**
	 * Find existing user by Logto sub or email, or create a new user
	 */
	private async findOrCreateUser(sub: string, email: string): Promise<MiLocalUser> {
		// Try to find user by Logto sub
		const existingProfileBySub = await this.userProfilesRepository.findOneBy({ logtoSub: sub });

		if (existingProfileBySub) {
			// User exists and is linked to Logto
			const user = await this.usersRepository.findOneBy({ id: existingProfileBySub.userId });
			if (!user) {
				throw new Error('User not found');
			}
			// All users created by SignupService are local users
			return user as MiLocalUser;
		}

		// Try to find user by email and link Logto sub
		const existingProfileByEmail = await this.userProfilesRepository.findOneBy({ email });

		if (existingProfileByEmail) {
			// Link Logto sub to existing user
			await this.userProfilesRepository.update(
				{ userId: existingProfileByEmail.userId },
				{ logtoSub: sub },
			);

			const user = await this.usersRepository.findOneBy({ id: existingProfileByEmail.userId });
			if (!user) {
				throw new Error('User not found');
			}

			this.logger.info(`Linked Logto account to existing user: ${existingProfileByEmail.userId}`);
			return user as MiLocalUser;
		}

		// Create new user
		const { account } = await this.signupService.signup({
			username: this.generateUsernameFromEmail(email),
			password: null, // No password for Logto users
			host: null,
			reason: 'Signed up via Logto SSO',
			approved: !this.meta.approvalRequiredForSignup,
		});

		// Link Logto sub to new user
		await this.userProfilesRepository.update(
			{ userId: account.id },
			{ logtoSub: sub, email },
		);

		this.logger.info(`Created new user via Logto: ${account.id}`);

		return account as MiLocalUser;
	}

	/**
	 * Generate a username from email address
	 */
	private generateUsernameFromEmail(email: string): string {
		const username = email.split('@')[0]
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '') // Remove non-alphanumeric characters
			.substring(0, 20); // Limit length

		// Ensure username is not empty and is valid
		return username || `user${Date.now()}`;
	}

	/**
	 * Send notifications to moderators about pending approval
	 */
	private async sendPendingApprovalNotifications(user: any) {
		if (user.email) {
			await this.emailService.sendEmail(
				user.email,
				'等待审核',
				'恭喜！你的账号正在审核中，我们会在审核通过后通知你。',
				'恭喜！你的账号正在审核中，我们会在审核通过后通知你。',
			);
		}

		const moderators = await this.roleService.getModerators();

		for (const moderator of moderators) {
			const profile = await this.userProfilesRepository.findOneBy({
				userId: moderator.id,
			});

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
