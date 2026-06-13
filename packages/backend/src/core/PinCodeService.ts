/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { DI } from '@/di-symbols.js';
import type { UserProfilesRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';

const PIN_REGEX = /^\d{4,12}$/; // 4-12 digits only

@Injectable()
export class PinCodeService {
	private logger: Logger;

	constructor(
		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private readonly loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('PinCode');
	}

	/**
	 * Set or update a user's PIN code
	 */
	@bindThis
	public async setPinCode(userId: string, pinCode: string): Promise<void> {
		// Validate PIN format
		if (!PIN_REGEX.test(pinCode)) {
			throw new Error('PIN code must be 4-12 digits');
		}

		// Hash the PIN code
		const hash = await argon2.hash(pinCode);

		// Store the hash
		await this.userProfilesRepository.update({ userId }, { pinCodeHash: hash });

		this.logger.info(`PIN code set for user: ${userId}`);
	}

	/**
	 * Verify a user's PIN code
	 */
	@bindThis
	public async verifyPinCode(userId: string, pinCode: string): Promise<boolean> {
		// Get the stored hash
		const profile = await this.userProfilesRepository.findOneBy({ userId });

		if (!profile?.pinCodeHash) {
			// No PIN set for this user
			return false;
		}

		// Verify the PIN against the hash
		try {
			return await argon2.verify(profile.pinCodeHash, pinCode);
		} catch (error) {
			this.logger.error('Failed to verify PIN code', error as Error);
			return false;
		}
	}

	/**
	 * Remove a user's PIN code
	 */
	@bindThis
	public async removePinCode(userId: string): Promise<void> {
		await this.userProfilesRepository.update({ userId }, { pinCodeHash: null });
		this.logger.info(`PIN code removed for user: ${userId}`);
	}

	/**
	 * Check if a user has a PIN code set
	 */
	@bindThis
	public async hasPinCode(userId: string): Promise<boolean> {
		const profile = await this.userProfilesRepository.findOneBy({ userId });
		return !!profile?.pinCodeHash;
	}
}
