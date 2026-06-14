/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { UserProfilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { LogtoOidcService } from '@/core/LogtoOidcService.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	requireCredential: true,

	limit: {
		duration: ms('1hour'),
		max: 10,
		minInterval: ms('1sec'),
	},

	secure: true,

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			url: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	},

	errors: {
		notConfigured: {
			message: 'Logto OIDC is not configured.',
			code: 'LOGTO_NOT_CONFIGURED',
			id: 'a1b2c3d4-0001-4a5b-8c6d-7e8f9a0b1c2d',
		},

		notLinked: {
			message: 'This account is not linked to Logto SSO.',
			code: 'LOGTO_NOT_LINKED',
			id: 'a1b2c3d4-0002-4a5b-8c6d-7e8f9a0b1c2d',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private logtoOidcService: LogtoOidcService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!this.logtoOidcService.isConfigured()) {
				throw new ApiError(meta.errors.notConfigured);
			}

			const profile = await this.userProfilesRepository.findOneByOrFail({ userId: me.id });
			if (profile.logtoSub == null) {
				throw new ApiError(meta.errors.notLinked);
			}

			// Start a step-up re-authentication tied to this user. The callback
			// verifies the returned identity and drops a one-time marker that
			// i/set-password consumes.
			const { url } = await this.logtoOidcService.getAuthorizationUrl({ purpose: 'reauth', userId: me.id });

			return { url };
		});
	}
}
