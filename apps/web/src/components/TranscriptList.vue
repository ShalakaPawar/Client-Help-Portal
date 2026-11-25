<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import type { TranscriptSegmentDto } from '@chp/shared';
import { formatClock } from '@/lib/format';

const props = defineProps<{ segments: TranscriptSegmentDto[]; activeIndex: number; seekable: boolean }>();
const emit = defineEmits<{ seek: [segment: TranscriptSegmentDto] }>();
const list = ref<HTMLElement | null>(null);
/** true while there are more lines below the visible area (shows a fade + "scroll for more"). */
const moreBelow = ref(false);

function updateScrollHint() {
  const el = list.value;
  moreBelow.value = !!el && el.scrollTop + el.clientHeight < el.scrollHeight - 4;
}

// Keep the line being spoken in view while the video plays.
watch(
  () => props.activeIndex,
  async (i) => {
    await nextTick();
    list.value?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },
);
watch(() => props.segments.length, () => nextTick(updateScrollHint));
onMounted(() => {
  nextTick(updateScrollHint);
  window.addEventListener('resize', updateScrollHint);
});

function scrollDown() {
  list.value?.scrollBy({ top: list.value.clientHeight * 0.8, behavior: 'smooth' });
}
</script>

<template>
  <!-- Fills the height it is given (the parent sets it); scrolls inside. -->
  <div class="relative flex h-full min-h-0 flex-col">
    <ol ref="list" class="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" @scroll="updateScrollHint">
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
    <!-- Scroll cue: fade + button, only while more lines are hidden below. -->
    <div v-if="moreBelow" class="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-gradient-to-t from-white to-transparent">
      <button
        class="pointer-events-auto mb-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 shadow-sm hover:bg-slate-50"
        @click="scrollDown"
      >
        Scroll for more ↓
      </button>
    </div>
  </div>
</template>
