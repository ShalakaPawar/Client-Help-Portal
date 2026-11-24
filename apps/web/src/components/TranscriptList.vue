<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { TranscriptSegmentDto } from '@chp/shared';
import { formatClock } from '@/lib/format';

const props = defineProps<{ segments: TranscriptSegmentDto[]; activeIndex: number; seekable: boolean }>();
const emit = defineEmits<{ seek: [segment: TranscriptSegmentDto] }>();
const list = ref<HTMLElement | null>(null);

// Keep the line being spoken in view while the video plays.
watch(
  () => props.activeIndex,
  async (i) => {
    await nextTick();
    list.value?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
);
</script>

<template>
  <ol ref="list" class="max-h-[28rem] space-y-1 overflow-y-auto pr-1">
    <li v-for="(s, i) in segments" :key="i" :data-index="i">
      <button
        class="w-full rounded-lg px-3 py-2 text-left text-sm transition"
        :class="[
          i === activeIndex ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50',
          seekable ? 'cursor-pointer' : 'cursor-default',
        ]"
        :disabled="!seekable"
        :title="seekable ? 'Jump to this moment' : undefined"
        @click="emit('seek', s)"
      >
        <span class="mr-2 font-mono text-xs text-slate-400">{{ formatClock(s.startMs) }}</span>
        <span class="font-medium" :class="s.role === 'CONSULTANT' ? 'text-indigo-700' : 'text-emerald-700'">
          {{ s.speakerName }} ({{ s.role === 'CONSULTANT' ? 'Consultant' : 'Client' }}):
        </span>
        <span class="text-slate-700">{{ s.text }}</span>
      </button>
    </li>
  </ol>
</template>
