<!--
SPDX-FileCopyrightText: marie and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<FormSuspense :p="init">
			<div class="_gaps_m">
				<MkSwitch v-model="enableLogto">
					<template #label>Enable Logto OIDC</template>
					<template #caption>Allow users to login via Logto SSO</template>
				</MkSwitch>

				<MkInput v-model="logtoIssuerUrl" :disabled="!enableLogto" placeholder="https://your-domain.logto.app">
					<template #prefix><i class="ti ti-link"></i></template>
					<template #label>Issuer URL</template>
					<template #caption>The Logto application endpoint URL</template>
				</MkInput>

				<MkInput v-model="logtoClientId" :disabled="!enableLogto" placeholder="Your Logto application ID">
					<template #prefix><i class="ti ti-id"></i></template>
					<template #label>Client ID</template>
					<template #caption>The Logto application client ID</template>
				</MkInput>

				<MkInput v-model="logtoClientSecret" :disabled="!enableLogto" type="password" placeholder="Your Logto application secret">
					<template #prefix><i class="ti ti-key"></i></template>
					<template #label>Client Secret</template>
					<template #caption>The Logto application client secret</template>
				</MkInput>

				<MkSwitch v-model="disablePasswordSignup">
					<template #label>Disable Password Registration</template>
					<template #caption>When enabled, new users can only register via Logto SSO. Existing password login remains unchanged.</template>
				</MkSwitch>

				<MkButton primary @click="save">Save</MkButton>
			</div>
		</FormSuspense>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import FormSuspense from '@/components/form/suspense.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { fetchInstance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

const enableLogto = ref<boolean>(false);
const logtoIssuerUrl = ref<string | null>('');
const logtoClientId = ref<string | null>('');
const logtoClientSecret = ref<string | null>('');
const disablePasswordSignup = ref<boolean>(false);

async function init() {
	const meta = await misskeyApi('admin/meta');
	enableLogto.value = meta.enableLogto;
	logtoIssuerUrl.value = meta.logtoIssuerUrl;
	logtoClientId.value = meta.logtoClientId;
	logtoClientSecret.value = meta.logtoClientSecret;
	disablePasswordSignup.value = meta.disablePasswordSignup;
}

function save() {
	os.apiWithDialog('admin/update-meta', {
		enableLogto: enableLogto.value,
		logtoIssuerUrl: logtoIssuerUrl.value,
		logtoClientId: logtoClientId.value,
		logtoClientSecret: logtoClientSecret.value,
		disablePasswordSignup: disablePasswordSignup.value,
	}).then(() => {
		os.promiseDialog(fetchInstance(true));
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: 'Logto SSO',
	icon: 'ph-key ph-bold ph-lg',
}));
</script>
