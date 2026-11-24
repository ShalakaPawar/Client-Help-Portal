<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { LiveKitJoinDto } from '@chp/shared';
import { useRequests } from '@/stores/requests';
import { useCallStore } from '@/stores/call';
import { useToasts } from '@/stores/toasts';
import { http } from '@/services/http';
import { timeAgo } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge.vue';

const requests = useRequests();
const calls = useCallStore();
const toasts = useToasts();
const router = useRouter();
const filter = ref<'OPEN' | 'ALL'>('OPEN');
const starting = ref<string | null>(null);

const visible = computed(() =>
  filter.value === 'OPEN' ? requests.items.filter((r) => r.status === 'OPEN' || r.status === 'IN_CALL') : requests.items,
);
const openCount = computed(() => requests.items.filter((r) => r.status === 'OPEN').length);

onMounted(async () => {
  try {
    await Promise.all([requests.load(), calls.fetchActive()]);
  } catch (err) {
    toasts.error(err);
  }
});

async function startCall(requestId: string) {
  starting.value = requestId;
  try {
    const res = await http.post<LiveKitJoinDto>(`/requests/${requestId}/calls`);
    calls.apply(res.call);
    await router.push(`/call/${res.call.id}`);
  } catch (err) {
    toasts.error(err);
  } finally {
    starting.value = null;
  }
}

async function resolve(id: string) {
  try {
    await requests.resolve(id);
  } catch (err) {
    toasts.error(err);
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-6">
    <div v-if="calls.active" class="card flex items-center gap-4 border-indigo-200 bg-indigo-50 p-4">
      <p class="flex-1 text-sm text-indigo-900">
        You have a live call with <b>{{ calls.active.client.name }}</b> about “{{ calls.active.requestTitle }}”.
      </p>
      <button class="btn-primary" @click="router.push(`/call/${calls.active!.id}`)">Return to call</button>
    </div>

    <section class="card p-5">
      <div class="mb-4 flex items-center gap-3">
        <h2 class="text-lg font-semibold">Help requests</h2>
        <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{{ openCount }} open</span>
        <div class="ml-auto flex rounded-lg border border-slate-200 p-0.5 text-sm">
          <button class="rounded-md px-3 py-1" :class="filter === 'OPEN' ? 'bg-slate-100 font-medium' : ''" @click="filter = 'OPEN'">
            Open
          </button>
          <button class="rounded-md px-3 py-1" :class="filter === 'ALL' ? 'bg-slate-100 font-medium' : ''" @click="filter = 'ALL'">
            All
          </button>
        </div>
      </div>

      <p v-if="requests.loading && !requests.items.length" class="text-sm text-slate-500">Loading…</p>
      <p v-else-if="!visible.length" class="text-sm text-slate-500">No requests right now. New ones appear here instantly.</p>
      <ul v-else class="divide-y divide-slate-100">
        <li
          v-for="r in visible"
          :key="r.id"
          class="flex items-start gap-4 rounded-lg px-2 py-3 transition-colors duration-1000"
          :class="requests.fresh.has(r.id) ? 'bg-amber-50' : ''"
        >
          <div class="flex-1">
            <p class="font-medium">
              {{ r.title }}
              <span v-if="requests.fresh.has(r.id)" class="ml-2 rounded bg-amber-200 px-1.5 text-xs text-amber-900">New</span>
            </p>
            <p class="line-clamp-2 text-sm text-slate-500">{{ r.description }}</p>
            <p class="mt-1 text-xs text-slate-400">{{ r.client.name }} · {{ timeAgo(r.createdAt) }}</p>
          </div>
          <StatusBadge :status="r.status" />
          <button
            v-if="r.status === 'OPEN'"
            class="btn-primary py-1.5"
            :disabled="!!calls.active || starting === r.id"
            :title="calls.active ? 'Finish your current call first' : undefined"
            @click="startCall(r.id)"
          >
            {{ starting === r.id ? 'Starting…' : 'Start call' }}
          </button>
          <button v-if="r.status === 'OPEN'" class="text-xs text-slate-500 underline hover:text-emerald-700" @click="resolve(r.id)">
            Mark resolved
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
