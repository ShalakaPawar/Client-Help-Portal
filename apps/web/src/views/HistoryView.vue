<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { CallDto, Paginated } from '@chp/shared';
import { http } from '@/services/http';
import { onSocket } from '@/services/socket';
import { useAuth } from '@/stores/auth';
import { useToasts } from '@/stores/toasts';
import { formatClock, formatDateTime } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge.vue';

const auth = useAuth();
const toasts = useToasts();
const items = ref<CallDto[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);

async function load(cursor?: string) {
  loading.value = true;
  try {
    const page = await http.get<Paginated<CallDto>>(`/history${cursor ? `?cursor=${cursor}` : ''}`);
    items.value = cursor ? [...items.value, ...page.items] : page.items;
    nextCursor.value = page.nextCursor;
  } catch (err) {
    toasts.error(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => load());
// Status badges update live while transcripts and summaries are being made.
const offs = [onSocket('processing:updated', () => load()), onSocket('call:ended', () => load())];
onBeforeUnmount(() => offs.forEach((off) => off()));

function processingLabel(c: CallDto): { status: string; label: string } {
  const r = c.recording;
  if (c.status === 'MISSED') return { status: 'MISSED', label: 'missed' };
  if (!r || r.status === 'NONE') return { status: 'NONE', label: 'not recorded' };
  // Recorder never started (e.g. all recorders busy): nothing to process.
  if (r.status === 'FAILED' && r.processingStatus === 'PENDING' && !r.durationMs) return { status: 'NONE', label: 'not recorded' };
  if (r.processingStatus === 'DONE') return { status: 'DONE', label: 'ready' };
  if (r.processingStatus === 'FAILED' || r.status === 'FAILED') return { status: 'FAILED', label: 'failed' };
  return { status: r.processingStatus, label: 'processing…' };
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6">
    <section class="card p-5">
      <h2 class="mb-4 text-lg font-semibold">Call history</h2>
      <p v-if="loading && !items.length" class="text-sm text-slate-500">Loading…</p>
      <p v-else-if="!items.length" class="text-sm text-slate-500">No calls yet.</p>
      <table v-else class="w-full text-left text-sm">
        <thead class="text-xs text-slate-500 uppercase">
          <tr>
            <th class="py-2 font-medium">When</th>
            <th class="py-2 font-medium">{{ auth.isClient ? 'Consultant' : 'Client' }}</th>
            <th class="py-2 font-medium">Request</th>
            <th class="py-2 font-medium">Length</th>
            <th class="py-2 font-medium">Recording</th>
            <th></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="c in items" :key="c.id">
            <td class="py-3 text-slate-600">{{ formatDateTime(c.startedAt ?? c.createdAt) }}</td>
            <td class="py-3">{{ auth.isClient ? c.consultant.name : c.client.name }}</td>
            <td class="py-3">{{ c.requestTitle }}</td>
            <td class="py-3 text-slate-600">{{ c.recording?.durationMs ? formatClock(c.recording.durationMs) : '—' }}</td>
            <td class="py-3"><StatusBadge v-bind="processingLabel(c)" /></td>
            <td class="py-3 text-right">
              <RouterLink v-if="c.status === 'ENDED'" :to="`/history/${c.id}`" class="text-indigo-600 hover:underline">Open</RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
      <button v-if="nextCursor" class="btn-secondary mt-4" :disabled="loading" @click="load(nextCursor!)">Load more</button>
    </section>
  </div>
</template>
