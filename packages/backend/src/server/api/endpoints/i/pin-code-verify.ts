/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { PinCodeService } from '@/core/PinCodeService.js';

export const meta = {
	requireCredential: true,

	secure: true,
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		pinCode: { type: 'string' },
	},
	required: ['pinCode'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private pinCodeService: PinCodeService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const valid = await this.pinCodeService.verifyPinCode(me.id, ps.pinCode);
			return { valid };
		});
	}
}
