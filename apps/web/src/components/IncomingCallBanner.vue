<script setup lang="ts">
import type { CallDto } from '@chp/shared';

defineProps<{ call: CallDto }>();
const emit = defineEmits<{ join: [] }>();
</script>

<template>
  <div class="card flex items-center gap-4 border-indigo-200 bg-indigo-50 p-4">
    <span class="relative flex h-3 w-3">
      <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75"></span>
      <span class="relative inline-flex h-3 w-3 rounded-full bg-indigo-500"></span>
    </span>
    <div class="flex-1 text-sm">
      <p class="font-medium text-indigo-900">
        {{ call.status === 'ACTIVE' ? 'You are in a call' : `${call.consultant.name} is calling you` }}
      </p>
      <p class="text-indigo-700">About: {{ call.requestTitle }}</p>
    </div>
    <button class="btn-primary" @click="emit('join')">{{ call.status === 'ACTIVE' ? 'Rejoin call' : 'Join call' }}</button>
  </div>
</template>
