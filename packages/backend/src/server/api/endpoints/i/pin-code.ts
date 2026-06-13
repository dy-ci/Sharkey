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

	errors: {
		invalidPinCode: {
			message: 'PIN code must be 4-12 digits',
			code: 'INVALID_PIN_CODE',
			id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		pinCode: { type: 'string', nullable: true },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private pinCodeService: PinCodeService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (ps.pinCode === null) {
				// Remove PIN code
				await this.pinCodeService.removePinCode(me.id);
			} else if (typeof ps.pinCode === 'string') {
				// Set PIN code
				await this.pinCodeService.setPinCode(me.id, ps.pinCode);
			}

			return { success: true };
		});
	}
}
