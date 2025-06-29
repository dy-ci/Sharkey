<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :displayBackButton="true" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div :class="$style.tl">
			<MkStreamingNotesTimeline
				ref="tlEl" :key="listId + withRenotes + onlyFiles"
				src="list"
				:list="listId"
				:sound="true"
				:withRenotes="withRenotes"
				:onlyFiles="onlyFiles"
			/>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, watch, ref, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { useRouter } from '@/router.js';
import { store } from '@/store.js';
import { deepMerge } from '@/utility/merge.js';
import * as os from '@/os.js';
import { $i } from '@/i.js';

const router = useRouter();

const props = defineProps<{
	listId: string;
}>();

const list = ref<Misskey.entities.UserList | null>(null);

const withRenotes = computed<boolean>({
	get: () => store.r.tl.value.filter.withRenotes,
	set: (x) => saveTlFilter('withRenotes', x),
});

const onlyFiles = computed<boolean>({
	get: () => store.r.tl.value.filter.onlyFiles,
	set: (x) => saveTlFilter('onlyFiles', x),
});

function saveTlFilter(key: keyof typeof store.s.tl.filter, newValue: boolean) {
	if (key !== 'withReplies' || $i) {
		store.r.tl.value = deepMerge({ filter: { [key]: newValue } }, store.s.tl);
	}
}

watch(() => props.listId, async () => {
	list.value = await misskeyApi('users/lists/show', {
		listId: props.listId,
	});
}, { immediate: true });

function settings() {
	router.push(`/my/lists/${props.listId}`);
}

const headerActions = computed(() => list.value ? [{
	icon: 'ph-dots-three ph-bold ph-lg',
	text: i18n.ts.options,
	handler: (ev) => {
		os.popupMenu([{
			type: 'switch',
			text: i18n.ts.showRenotes,
			ref: withRenotes,
		}, {
			type: 'switch',
			text: i18n.ts.fileAttachedOnly,
			ref: onlyFiles,
		}], ev.currentTarget ?? ev.target);
	},
}, {
	icon: 'ti ti-settings',
	text: i18n.ts.settings,
	handler: settings,
}] : []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: list.value ? list.value.name : i18n.ts.lists,
	icon: 'ti ti-list',
}));
</script>

<style lang="scss" module>
.tl {
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	overflow: clip;
}
</style>
