<!--
SPDX-FileCopyrightText: marie and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.loading">
		<p v-if="error" :class="$style.error">{{ error }}</p>

		<p v-else-if="pendingApproval" :class="$style.pending">{{ i18n.ts.ssoAccountPendingApproval }}</p>

		<form v-else-if="needInvite" class="_gaps_m" :class="$style.inviteForm" @submit.prevent="submitInvite">
			<p>{{ i18n.ts.ssoEnterInvitationCode }}</p>
			<MkInput v-model="invitationCode" type="text" :spellcheck="false" required>
				<template #label>{{ i18n.ts.invitationCode }}</template>
				<template #prefix><i class="ti ti-key"></i></template>
			</MkInput>
			<MkButton type="submit" primary rounded :disabled="submitting" style="margin: 0 auto;">{{ i18n.ts.done }}</MkButton>
		</form>

		<p v-else>{{ i18n.ts.ssoProcessingLogin }}</p>
	</div>
</div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { login } from '@/accounts.js';
import { i18n } from '@/i18n.js';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import { completeLogtoSignup } from '@/utility/logto.js';

const error = ref<string | null>(null);
const pendingApproval = ref(false);
const needInvite = ref(false);
const invitationCode = ref('');
const submitting = ref(false);

let regToken = '';

onMounted(async () => {
	const urlParams = new URLSearchParams(window.location.search);

	// Invitation-only instance: a brand-new SSO user must supply an invite code
	if (urlParams.get('needInvite') === 'true') {
		regToken = urlParams.get('regToken') ?? '';
		if (!regToken) {
			error.value = i18n.ts.ssoLoginFailed;
			return;
		}
		needInvite.value = true;
		return;
	}

	// Account awaiting manual approval
	if (urlParams.get('pendingApproval') === 'true') {
		pendingApproval.value = true;
		return;
	}

	// Login error returned from the backend
	const loginError = urlParams.get('loginError');
	if (loginError) {
		error.value = decodeURIComponent(loginError);
		return;
	}

	// Extract the session token from the URL fragment (#i=<token>)
	const tokenMatch = window.location.hash.match(/#?i=([^&]+)/);
	if (!tokenMatch) {
		error.value = i18n.ts.ssoLoginFailed;
		return;
	}

	try {
		await login(tokenMatch[1]);
		window.location.href = '/';
	} catch (err) {
		error.value = (err as Error).message || i18n.ts.ssoLoginFailed;
	}
});

async function submitInvite(): Promise<void> {
	if (submitting.value) return;
	submitting.value = true;
	error.value = null;

	try {
		const result = await completeLogtoSignup(regToken, invitationCode.value);

		if ('pendingApproval' in result && result.pendingApproval) {
			needInvite.value = false;
			pendingApproval.value = true;
			return;
		}

		if ('token' in result && result.token) {
			await login(result.token);
			window.location.href = '/';
		}
	} catch (err) {
		error.value = (err as Error).message || i18n.ts.ssoLoginFailed;
	} finally {
		submitting.value = false;
	}
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	align-items: center;
	justify-content: center;
	min-height: 100vh;
}

.loading {
	text-align: center;
}

.inviteForm {
	width: min(100%, 360px);
	text-align: left;
	padding: 0 16px;
}

.error {
	color: var(--MI_THEME-error);
	margin-top: 1rem;
}

.pending {
	color: var(--MI_THEME-accent);
	margin-top: 1rem;
}
</style>
