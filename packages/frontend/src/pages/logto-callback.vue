<!--
SPDX-FileCopyrightText: marie and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.loading">
		<p v-if="error" :class="$style.error">{{ error }}</p>
		<p v-else-if="pendingApproval" :class="$style.pending">您的账号正在审核中，我们会在审核通过后通知您。</p>
		<p v-else>正在处理登录...</p>
	</div>
</div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { login } from '@/accounts.js';

const error = ref<string | null>(null);
const pendingApproval = ref(false);

onMounted(async () => {
	// Check for pending approval
	const urlParams = new URLSearchParams(window.location.search);
	if (urlParams.get('pendingApproval') === 'true') {
		pendingApproval.value = true;
		return;
	}

	// Check for login error
	const loginError = urlParams.get('loginError');
	if (loginError) {
		error.value = decodeURIComponent(loginError);
		return;
	}

	// Extract token from URL fragment
	const hash = window.location.hash;
	const tokenMatch = hash.match(/[?&]i=([^&]+)/);

	if (!tokenMatch) {
		error.value = 'No authentication token found';
		return;
	}

	const token = tokenMatch[1];

	try {
		// Login with the token
		await login(token);
		// Redirect to home page
		window.location.href = '/';
	} catch (err) {
		error.value = (err as Error).message || 'Failed to login';
	}
});
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

.error {
	color: var(--MI_THEME-error);
	margin-top: 1rem;
}

.pending {
	color: var(--MI_THEME-accent);
	margin-top: 1rem;
}
</style>
