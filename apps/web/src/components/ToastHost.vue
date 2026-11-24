<script setup lang="ts">
import { useToasts } from '@/stores/toasts';

const toasts = useToasts();
const tone = { info: 'bg-slate-800', success: 'bg-emerald-600', error: 'bg-rose-600' };
</script>

<template>
  <div class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
    <div
      v-for="t in toasts.items"
      :key="t.id"
      class="pointer-events-auto flex items-start gap-3 rounded-lg px-4 py-3 text-sm text-white shadow-lg"
      :class="tone[t.kind]"
      role="status"
    >
      <span class="flex-1">{{ t.text }}</span>
      <button class="opacity-70 hover:opacity-100" aria-label="Dismiss" @click="toasts.dismiss(t.id)">✕</button>
    </div>
  </div>
</template>
