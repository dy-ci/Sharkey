/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/_.js';
import type { Config } from '@/config.js';
import type { Redis as RedisClient } from 'ioredis';
import Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';

const STATE_EXPIRY_SECONDS = 600; // 10 minutes
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
// Discovery is probed at both the standard and Logto's /oidc well-known paths.

type OidcDiscovery = {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	userinfo_endpoint: string;
};

type StatePayload = {
	codeVerifier: string;
	nonce: string;
	// Distinguishes a normal login from a step-up re-authentication of an
	// already-logged-in user (used to gate setting a first local password).
	purpose: 'signin' | 'reauth';
	// For 'reauth', the id of the user who initiated the step-up. Set from an
	// authenticated request, so it cannot be forged by the browser.
	userId?: string;
};

@Injectable()
export class LogtoOidcService {
	private logger: Logger;
	private discoveryCache = new Map<string, { value: OidcDiscovery; expiresAt: number }>();

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.redis)
		private redis: RedisClient,

		private readonly loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('logto-oidc');
	}

	/**
	 * Check if Logto OIDC is properly configured
	 */
	public isConfigured(): boolean {
		return !!(
			this.meta.enableLogto &&
			this.meta.logtoIssuerUrl &&
			this.meta.logtoClientId &&
			this.meta.logtoClientSecret
		);
	}

	/**
	 * The redirect URI that Logto sends the user back to. This must point at
	 * Sharkey's own callback route (the API server is mounted under /api).
	 */
	private getRedirectUri(): string {
		return `${this.config.url}/api/logto/callback`;
	}

	/**
	 * Resolve the OIDC endpoints via the discovery document, cached per issuer.
	 *
	 * The admin may configure the issuer either as the bare endpoint
	 * (e.g. https://xxx.logto.app) or as the full OIDC issuer
	 * (e.g. https://xxx.logto.app/oidc). Logto serves its discovery document
	 * under /oidc, so we try the standard path first and fall back to the
	 * Logto convention.
	 */
	private async getDiscovery(): Promise<OidcDiscovery> {
		const issuerUrl = this.meta.logtoIssuerUrl!.replace(/\/$/, '');

		const cached = this.discoveryCache.get(issuerUrl);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.value;
		}

		const candidates = [
			`${issuerUrl}/.well-known/openid-configuration`,
			`${issuerUrl}/oidc/.well-known/openid-configuration`,
		];

		let lastStatus = 0;
		for (const discoveryUrl of candidates) {
			const res = await this.fetchWithRetry(discoveryUrl, {
				headers: { Accept: 'application/json' },
			});

			if (!res.ok) {
				lastStatus = res.status;
				continue;
			}

			const doc = await res.json() as Partial<OidcDiscovery>;

			if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.userinfo_endpoint) {
				this.logger.warn(`Incomplete OIDC discovery document at ${discoveryUrl}`);
				continue;
			}

			const value: OidcDiscovery = {
				issuer: doc.issuer,
				authorization_endpoint: doc.authorization_endpoint,
				token_endpoint: doc.token_endpoint,
				userinfo_endpoint: doc.userinfo_endpoint,
			};

			this.discoveryCache.set(issuerUrl, { value, expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS });

			return value;
		}

		throw new Error(`Failed to fetch OIDC discovery document (last status ${lastStatus})`);
	}

	/**
	 * fetch() that retries transient network failures (e.g. an upstream TLS
	 * reset / "Client network socket disconnected before secure TLS connection
	 * was established"). Only the connection-level rejection is retried — when
	 * fetch() rejects, no HTTP response was received, so retrying is safe and
	 * does not risk double-consuming a single-use authorization code.
	 */
	private async fetchWithRetry(url: string, init?: RequestInit, retries = 2): Promise<Response> {
		let lastError: unknown;
		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				return await fetch(url, init);
			} catch (e) {
				lastError = e;
				const cause = (e as { cause?: { code?: string; message?: string } }).cause;
				this.logger.warn(`Network fetch to ${url} failed (attempt ${attempt + 1}/${retries + 1}): ${(e as Error).message}${cause?.code ? ` [${cause.code}]` : ''}`);
				if (attempt < retries) {
					await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
				}
			}
		}
		throw lastError;
	}

	/**
	 * Generate PKCE code verifier and challenge
	 */
	private generatePKCE(): { codeVerifier: string; codeChallenge: string } {
		const codeVerifier = randomBytes(32).toString('base64url');
		const codeChallenge = createHash('sha256')
			.update(codeVerifier)
			.digest('base64url');
		return { codeVerifier, codeChallenge };
	}

	/**
	 * Build the Logto authorization URL with PKCE.
	 *
	 * @param opts.purpose  'reauth' starts a step-up re-authentication for an
	 *   already-logged-in user (e.g. to set a first local password); defaults
	 *   to 'signin'.
	 * @param opts.userId   the initiating user's id, stored in the state for the
	 *   'reauth' purpose so the callback can verify the returned identity.
	 */
	public async getAuthorizationUrl(opts?: { purpose?: 'signin' | 'reauth'; userId?: string }): Promise<{ url: string; state: string }> {
		if (!this.isConfigured()) {
			throw new Error('Logto OIDC is not configured');
		}

		const discovery = await this.getDiscovery();
		const { codeVerifier, codeChallenge } = this.generatePKCE();
		const state = randomBytes(32).toString('hex');
		const nonce = randomBytes(16).toString('hex');

		// Store the code verifier and nonce in Redis with TTL, keyed by state
		const redisKey = `logto:oidc:state:${state}`;
		const payload: StatePayload = {
			codeVerifier,
			nonce,
			purpose: opts?.purpose ?? 'signin',
			userId: opts?.userId,
		};
		await this.redis.setex(redisKey, STATE_EXPIRY_SECONDS, JSON.stringify(payload));

		const params = new URLSearchParams({
			client_id: this.meta.logtoClientId!,
			redirect_uri: this.getRedirectUri(),
			response_type: 'code',
			state,
			nonce,
			code_challenge: codeChallenge,
			code_challenge_method: 'S256',
			scope: 'openid profile email',
		});

		const authorizationUrl = `${discovery.authorization_endpoint}?${params.toString()}`;

		this.logger.info(`Generated authorization URL for state: ${state}`);

		return { url: authorizationUrl, state };
	}

	/**
	 * Exchange authorization code for tokens and extract user info.
	 *
	 * The token exchange is a back-channel request (server-to-server over TLS,
	 * authenticated with the client secret), so the tokens returned are
	 * trustworthy without an additional JWKS signature check. We still validate
	 * the standard claims (iss / aud / exp / nonce) defensively.
	 */
	public async exchangeCodeForTokens(
		code: string,
		state: string,
	): Promise<{ sub: string; email: string; emailVerified: boolean; name: string | null; preferredUsername: string | null; purpose: 'signin' | 'reauth'; userId: string | null }> {
		if (!this.isConfigured()) {
			throw new Error('Logto OIDC is not configured');
		}

		// Retrieve and delete the state payload from Redis (single use)
		const redisKey = `logto:oidc:state:${state}`;
		const raw = await this.redis.get(redisKey);

		if (!raw) {
			throw new Error('Invalid or expired state');
		}
		await this.redis.del(redisKey);

		let statePayload: StatePayload;
		try {
			statePayload = JSON.parse(raw) as StatePayload;
		} catch {
			throw new Error('Corrupted state payload');
		}

		const discovery = await this.getDiscovery();

		// Exchange code for tokens
		const tokenResponse = await this.fetchWithRetry(discovery.token_endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: this.getRedirectUri(),
				client_id: this.meta.logtoClientId!,
				client_secret: this.meta.logtoClientSecret!,
				code_verifier: statePayload.codeVerifier,
			}),
		});

		if (!tokenResponse.ok) {
			const error = await tokenResponse.text();
			this.logger.error(`Token exchange failed: ${error}`);
			throw new Error('Failed to exchange authorization code');
		}

		const tokens = await tokenResponse.json() as { id_token?: string; access_token?: string };

		if (!tokens.id_token) {
			throw new Error('No ID token in token response');
		}

		// Decode and validate the ID token claims
		const idToken = this.verifyIdToken(tokens.id_token, discovery.issuer, statePayload.nonce);

		let email = idToken.email;
		let emailVerified = idToken.emailVerified ?? false;
		let name = idToken.name ?? null;
		let preferredUsername = idToken.preferredUsername ?? null;

		// Prefer the userinfo endpoint as the authoritative source for the
		// verified email status and profile claims (also a back-channel request).
		if (tokens.access_token) {
			try {
				const userinfoResponse = await this.fetchWithRetry(discovery.userinfo_endpoint, {
					headers: { Authorization: `Bearer ${tokens.access_token}` },
				});

				if (userinfoResponse.ok) {
					const userinfo = await userinfoResponse.json() as {
						email?: string;
						email_verified?: boolean;
						name?: string;
						nickname?: string;
						preferred_username?: string;
						username?: string;
					};
					if (userinfo.email) {
						email = userinfo.email;
						emailVerified = userinfo.email_verified ?? emailVerified;
					}
					name = userinfo.name ?? userinfo.nickname ?? name;
					preferredUsername = userinfo.preferred_username ?? userinfo.username ?? preferredUsername;
				}
			} catch (e) {
				this.logger.warn('Failed to fetch userinfo, falling back to ID token claims', e as Error);
			}
		}

		if (!idToken.sub || !email) {
			throw new Error('Missing required claims (sub or email)');
		}

		this.logger.info(`Successfully authenticated user: ${idToken.sub} (emailVerified=${emailVerified})`);

		return {
			sub: idToken.sub,
			email,
			emailVerified,
			name,
			preferredUsername,
			purpose: statePayload.purpose ?? 'signin',
			userId: statePayload.userId ?? null,
		};
	}

	/**
	 * Decode and validate ID token claims (iss / aud / exp / nonce).
	 * Signature is trusted via the back-channel token exchange (see above).
	 */
	private verifyIdToken(idToken: string, expectedIssuer: string, expectedNonce: string): { sub: string; email?: string; emailVerified?: boolean; name?: string | null; preferredUsername?: string | null } {
		try {
			const parts = idToken.split('.');
			if (parts.length !== 3) {
				throw new Error('Invalid JWT format');
			}

			const payload = JSON.parse(
				Buffer.from(parts[1], 'base64url').toString('utf8'),
			) as {
				iss?: string;
				aud?: string | string[];
				exp?: number;
				nonce?: string;
				sub?: string;
				email?: string;
				email_verified?: boolean;
				name?: string;
				nickname?: string;
				preferred_username?: string;
				username?: string;
			};

			// Verify issuer
			if (payload.iss !== expectedIssuer) {
				throw new Error(`Invalid issuer: expected ${expectedIssuer}, got ${payload.iss}`);
			}

			// Verify audience (client ID); aud may be a string or array
			const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
			if (!aud.includes(this.meta.logtoClientId!)) {
				throw new Error(`Invalid audience: expected ${this.meta.logtoClientId}, got ${payload.aud}`);
			}

			// Verify expiration
			const now = Math.floor(Date.now() / 1000);
			if (payload.exp && payload.exp < now) {
				throw new Error('ID token has expired');
			}

			// Verify nonce
			if (payload.nonce !== expectedNonce) {
				throw new Error('Invalid nonce');
			}

			if (!payload.sub) {
				throw new Error('Missing sub claim');
			}

			return {
				sub: payload.sub,
				email: payload.email,
				emailVerified: payload.email_verified,
				name: payload.name ?? payload.nickname ?? null,
				preferredUsername: payload.preferred_username ?? payload.username ?? null,
			};
		} catch (error) {
			this.logger.error('ID token verification failed', error as Error);
			throw new Error('Invalid ID token');
		}
	}
}
