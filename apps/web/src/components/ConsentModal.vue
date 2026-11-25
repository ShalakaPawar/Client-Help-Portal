<script setup lang="ts">
defineProps<{ busy: boolean; consultantName: string }>();
const emit = defineEmits<{ answer: [granted: boolean] }>();
</script>

<template>
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-labelledby="consent-title">
    <div class="card w-full max-w-md p-6">
      <h2 id="consent-title" class="text-lg font-semibold">Can we record this call?</h2>
      <p class="mt-3 text-sm text-slate-600">
        {{ consultantName }} would like to record this call so you both get a recording, a transcript and a summary afterwards.
      </p>
      <ul class="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-600">
        <li>Your shared screen and both voices are recorded.</li>
        <li>If you say no, the call continues without recording.</li>
      </ul>
      <div class="mt-6 flex justify-end gap-3">
        <button class="btn-secondary" :disabled="busy" @click="emit('answer', false)">No, don't record</button>
        <button class="btn-primary" :disabled="busy" @click="emit('answer', true)">Yes, record</button>
      </div>
    </div>
  </div>
</template>
