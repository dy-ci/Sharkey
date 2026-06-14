/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { UserAuthService } from '@/core/UserAuthService.js';
import { InternalEventService } from '@/global/InternalEventService.js';
import { logtoReauthRedisKey } from '@/server/api/LogtoApiService.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	requireCredential: true,

	limit: {
		duration: ms('1hour'),
		max: 10,
		minInterval: ms('1sec'),
	},

	secure: true,

	errors: {
		passwordAlreadySet: {
			message: 'This account already has a password. Use change-password instead.',
			code: 'PASSWORD_ALREADY_SET',
			id: 'c9f3a0e4-1b2c-4d6e-8f10-9a2b3c4d5e6f',
		},

		reauthRequired: {
			message: 'Re-authentication is required before setting a password.',
			code: 'REAUTH_REQUIRED',
			id: 'd1e2f3a4-5b6c-7d8e-9f01-2a3b4c5d6e7f',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		newPassword: { type: 'string', minLength: 1 },
	},
	required: ['newPassword'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private userAuthService: UserAuthService,
		private readonly internalEventService: InternalEventService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: me.id });

			// Only for accounts that have no local password yet (e.g. created via
			// SSO). Accounts with a password must use i/change-password.
			if (profile.password != null) {
				throw new ApiError(meta.errors.passwordAlreadySet);
			}

			// Require a recent SSO step-up re-authentication. The marker is set by
			// the Logto callback only after verifying the user's identity, and is
			// single-use.
			const reauthKey = logtoReauthRedisKey(me.id);
			const reauthed = await this.redisClient.get(reauthKey);
			if (!reauthed) {
				throw new ApiError(meta.errors.reauthRequired);
			}
			await this.redisClient.del(reauthKey);

			const hash = await this.userAuthService.hashPassword(ps.newPassword);

			await this.userProfilesRepository.update(me.id, {
				password: hash,
			});
			await this.internalEventService.emit('updateUserProfile', { userId: me.id, keys: ['password'] });
		});
	}
}
