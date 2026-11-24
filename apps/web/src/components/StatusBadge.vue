<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: string; label?: string }>();

const styles: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-800',
  IN_CALL: 'bg-indigo-100 text-indigo-800',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-100 text-slate-600',
  WAITING: 'bg-amber-100 text-amber-800',
  ACTIVE: 'bg-indigo-100 text-indigo-800',
  ENDED: 'bg-slate-100 text-slate-700',
  MISSED: 'bg-rose-100 text-rose-700',
  RECORDING: 'bg-rose-100 text-rose-700',
  AVAILABLE: 'bg-emerald-100 text-emerald-800',
  DONE: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-rose-100 text-rose-700',
  NONE: 'bg-slate-100 text-slate-600',
};

const text = computed(() => props.label ?? props.status.replaceAll('_', ' ').toLowerCase());
const cls = computed(() => styles[props.status] ?? 'bg-sky-100 text-sky-800');
</script>

<template>
  <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize" :class="cls">
    {{ text }}
  </span>
</template>
