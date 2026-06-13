<!--
SPDX-FileCopyrightText: marie and other Sharkey contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.section">
		<h3 :class="$style.title">PIN Code</h3>
		<p :class="$style.description">
			Set a PIN code for additional verification. This is optional and can be used for sensitive operations.
		</p>

		<div v-if="hasPinCode" :class="$style.currentStatus">
			<p :class="$style.statusText">✓ PIN code is set</p>
			<MkButton @click="showRemoveConfirm = true" danger>
				Remove PIN
			</MkButton>
		</div>

		<div v-else :class="$style.currentStatus">
			<p :class="$style.statusText">No PIN code set</p>
		</div>

		<div :class="$style.form">
			<MkInput v-model="newPin" type="password" :placeholder="'4-12 digits'" autocomplete="new-password">
				<template #prefix><i class="ti ti-lock"></i></template>
				<template #label>New PIN Code</template>
				<template #caption>Must be 4-12 digits only</template>
			</MkInput>

			<MkInput v-model="confirmPin" type="password" :placeholder="'4-12 digits'" autocomplete="new-password">
				<template #prefix><i class="ti ti-lock"></i></template>
				<template #label>Confirm PIN Code</template>
			</MkInput>

			<MkButton primary @click="savePinCode" :disabled="!canSave">
				{{ hasPinCode ? 'Update PIN' : 'Set PIN' }}
			</MkButton>
		</div>
	</div>

	<!-- Remove confirmation dialog -->
	<MkModal v-if="showRemoveConfirm" @close="showRemoveConfirm = false">
		<div :class="$style.confirmModal">
			<h3>Remove PIN Code?</h3>
			<p>Are you sure you want to remove your PIN code?</p>
			<div :class="$style.confirmActions">
				<MkButton @click="showRemoveConfirm = false">Cancel</MkButton>
				<MkButton danger @click="removePinCode">Remove</MkButton>
			</div>
		</div>
	</MkModal>
</div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkModal from '@/components/MkModal.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const hasPinCode = ref(false);
const newPin = ref('');
const confirmPin = ref('');
const showRemoveConfirm = ref(false);

const canSave = computed(() => {
	return newPin.value.length >= 4 &&
		newPin.value.length <= 12 &&
		/^\d+$/.test(newPin.value) &&
		newPin.value === confirmPin.value;
});

onMounted(async () => {
	await checkPinCodeStatus();
});

async function checkPinCodeStatus() {
	try {
		// Try to verify with any PIN to check if one exists
		// This is a workaround since there's no direct "hasPinCode" endpoint
		const result = await misskeyApi('i/pin-code/verify', { pinCode: '00000000' });
		hasPinCode.value = true; // If we can check, a PIN exists
	} catch {
		hasPinCode.value = false;
	}
}

async function savePinCode() {
	if (!canSave.value) {
		os.alert({
			type: 'error',
			title: 'Invalid PIN',
			text: 'PIN must be 4-12 digits and match confirmation',
		});
		return;
	}

	try {
		await misskeyApi('i/pin-code', { pinCode: newPin.value });
		os.alert({
			type: 'success',
			title: 'PIN code saved',
		});
		newPin.value = '';
		confirmPin.value = '';
		await checkPinCodeStatus();
	} catch (error) {
		os.alert({
			type: 'error',
			title: 'Failed to save PIN',
			text: (error as Error).message,
		});
	}
}

async function removePinCode() {
	try {
		await misskeyApi('i/pin-code', { pinCode: null });
		os.alert({
			type: 'success',
			title: 'PIN code removed',
		});
		showRemoveConfirm.value = false;
		await checkPinCodeStatus();
	} catch (error) {
		os.alert({
			type: 'error',
			title: 'Failed to remove PIN',
			text: (error as Error).message,
		});
	}
}
</script>

<style lang="scss" module>
.root {
	padding: 1rem;
}

.section {
	margin-bottom: 2rem;
}

.title {
	font-size: 1.2rem;
	font-weight: bold;
	margin-bottom: 0.5rem;
}

.description {
	color: var(--MI_THEME-fgWeak);
	margin-bottom: 1rem;
}

.currentStatus {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 1rem;
	background: var(--MI_THEME-bg);
	border-radius: 8px;
	margin-bottom: 1rem;
}

.statusText {
	font-weight: 500;
}

.form {
	display: flex;
	flex-direction: column;
	gap: 1rem;
	max-width: 400px;
}

.confirmModal {
	padding: 2rem;
	background: var(--MI_THEME-bg);
	border-radius: 8px;
	max-width: 400px;
}

.confirmActions {
	display: flex;
	justify-content: flex-end;
	gap: 1rem;
	margin-top: 1.5rem;
}
</style>
