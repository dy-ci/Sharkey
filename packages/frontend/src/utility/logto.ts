/*
 * SPDX-FileCopyrightText: marie and other Sharkey contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { apiUrl } from '@@/js/config.js';

/**
 * Logto SSO uses raw Fastify routes (not Misskey API endpoints), so they are
 * not part of the typed misskey-js client. These small helpers wrap them.
 */

/**
 * Begin a Logto SSO flow and return the authorization URL to redirect to.
 */
export async function getLogtoAuthUrl(): Promise<string> {
	// No body is sent, so we must not set a JSON content-type (Fastify rejects
	// an empty body when content-type is application/json).
	const res = await window.fetch(`${apiUrl}/logto/auth`, {
		method: 'POST',
		credentials: 'omit',
	});

	if (!res.ok) {
		throw new Error(`Failed to initiate SSO (${res.status})`);
	}

	const body = await res.json() as { url: string };
	return body.url;
}

export type CompleteSignupResult =
	| { token: string }
	| { pendingApproval: true };

/**
 * Finish an invitation-gated OIDC signup by submitting the invitation code.
 */
export async function completeLogtoSignup(regToken: string, invitationCode: string): Promise<CompleteSignupResult> {
	const res = await window.fetch(`${apiUrl}/logto/complete-signup`, {
		method: 'POST',
		credentials: 'omit',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ regToken, invitationCode }),
	});

	const body = await res.json().catch(() => ({})) as Partial<{ token: string; pendingApproval: true; error: { message?: string }; message: string }>;

	if (!res.ok) {
		throw new Error(body.error?.message ?? body.message ?? `Failed to complete signup (${res.status})`);
	}

	return body as CompleteSignupResult;
}
