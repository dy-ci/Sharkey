/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/_.js';
import type { Redis as RedisClient } from 'ioredis';
import Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';

const STATE_EXPIRY_SECONDS = 600; // 10 minutes

@Injectable()
export class LogtoOidcService {
	private logger: Logger;

	constructor(
		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.redis)
		private redis: Redis,

		private readonly loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('LogtoOidc');
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
	 * Generate a random state parameter
	 */
	private generateState(): string {
		return randomBytes(32).toString('hex');
	}

	/**
	 * Build the Logto authorization URL with PKCE
	 */
	public async getAuthorizationUrl(): Promise<{ url: string; state: string }> {
		if (!this.isConfigured()) {
			throw new Error('Logto OIDC is not configured');
		}

		const { codeVerifier, codeChallenge } = this.generatePKCE();
		const state = this.generateState();

		// Store the state and code verifier in Redis with TTL
		const redisKey = `logto:oidc:state:${state}`;
		await this.redis.setex(redisKey, STATE_EXPIRY_SECONDS, codeVerifier);

		const issuerUrl = this.meta.logtoIssuerUrl!.replace(/\/$/, '');
		const redirectUri = `${issuerUrl}/callback`; // Logto's default callback path

		const params = new URLSearchParams({
			client_id: this.meta.logtoClientId!,
			redirect_uri: redirectUri,
			response_type: 'code',
			state: state,
			code_challenge: codeChallenge,
			code_challenge_method: 'S256',
			scope: 'openid profile email',
		});

		const authorizationUrl = `${issuerUrl}/authorize?${params.toString()}`;

		this.logger.info(`Generated authorization URL for state: ${state}`);

		return {
			url: authorizationUrl,
			state,
		};
	}

	/**
	 * Exchange authorization code for tokens and extract user info
	 */
	public async exchangeCodeForTokens(
		code: string,
		state: string,
	): Promise<{ sub: string; email: string }> {
		if (!this.isConfigured()) {
			throw new Error('Logto OIDC is not configured');
		}

		// Retrieve and delete the code verifier from Redis
		const redisKey = `logto:oidc:state:${state}`;
		const codeVerifier = await this.redis.get(redisKey);

		if (!codeVerifier) {
			throw new Error('Invalid or expired state');
		}

		// Delete the state to prevent reuse
		await this.redis.del(redisKey);

		const issuerUrl = this.meta.logtoIssuerUrl!.replace(/\/$/, '');
		const redirectUri = `${issuerUrl}/callback`;

		// Exchange code for tokens
		const tokenResponse = await fetch(`${issuerUrl}/oidc/token`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code: code,
				redirect_uri: redirectUri,
				client_id: this.meta.logtoClientId!,
				client_secret: this.meta.logtoClientSecret!,
				code_verifier: codeVerifier,
			}),
		});

		if (!tokenResponse.ok) {
			const error = await tokenResponse.text();
			this.logger.error(`Token exchange failed: ${error}`);
			throw new Error('Failed to exchange authorization code');
		}

		const tokens = await tokenResponse.json();

		// Decode and verify ID token (basic verification)
		const idToken = this.verifyIdToken(tokens.id_token);

		// Get email from ID token or fetch from userinfo endpoint
		let email = idToken.email;

		if (!email) {
			// Fetch from userinfo endpoint
			const userinfoResponse = await fetch(`${issuerUrl}/oidc/me`, {
				headers: {
					Authorization: `Bearer ${tokens.access_token}`,
				},
			});

			if (userinfoResponse.ok) {
				const userinfo = await userinfoResponse.json();
				email = userinfo.email;
			}
		}

		if (!idToken.sub || !email) {
			throw new Error('Missing required claims (sub or email) in ID token');
		}

		this.logger.info(`Successfully authenticated user: ${idToken.sub}`);

		return {
			sub: idToken.sub,
			email,
		};
	}

	/**
	 * Basic ID token verification
	 * Note: For production, use a proper JWT verification library
	 */
	private verifyIdToken(idToken: string): { sub: string; email?: string } {
		try {
			// Split the JWT
			const parts = idToken.split('.');
			if (parts.length !== 3) {
				throw new Error('Invalid JWT format');
			}

			// Decode the payload (base64url)
			const payload = JSON.parse(
				Buffer.from(parts[1], 'base64url').toString('utf8'),
			);

			// Verify issuer
			const issuerUrl = this.meta.logtoIssuerUrl!.replace(/\/$/, '');
			if (payload.iss !== issuerUrl) {
				throw new Error(`Invalid issuer: expected ${issuerUrl}, got ${payload.iss}`);
			}

			// Verify audience (client ID)
			if (payload.aud !== this.meta.logtoClientId) {
				throw new Error(`Invalid audience: expected ${this.meta.logtoClientId}, got ${payload.aud}`);
			}

			// Verify expiration
			const now = Math.floor(Date.now() / 1000);
			if (payload.exp && payload.exp < now) {
				throw new Error('ID token has expired');
			}

			return {
				sub: payload.sub,
				email: payload.email,
			};
		} catch (error) {
			this.logger.error('ID token verification failed', error as Error);
			throw new Error('Invalid ID token');
		}
	}
}
