<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useRequests } from '@/stores/requests';
import { useAuth } from '@/stores/auth';
import { useCallStore } from '@/stores/call';
import { useToasts } from '@/stores/toasts';
import { timeAgo } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge.vue';
import IncomingCallBanner from '@/components/IncomingCallBanner.vue';

const requests = useRequests();
const auth = useAuth();
/** New clients get the default consultant; an admin can change it. null = waiting for an admin. */
const consultant = computed(() => auth.user?.consultant ?? null);
const calls = useCallStore();
const toasts = useToasts();
const router = useRouter();

const title = ref('');
const description = ref('');
const submitting = ref(false);

onMounted(async () => {
  try {
    await Promise.all([requests.load(), calls.fetchActive(), auth.refreshMe()]);
  } catch (err) {
    toasts.error(err);
  }
});

async function submit() {
  submitting.value = true;
  try {
    await requests.create(title.value, description.value);
    title.value = '';
    description.value = '';
    toasts.success('Request sent. Your consultant can see it now.');
  } catch (err) {
    toasts.error(err);
  } finally {
    submitting.value = false;
  }
}

async function cancel(id: string) {
  try {
    await requests.cancel(id);
  } catch (err) {
    toasts.error(err);
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6 px-4 py-6">
    <IncomingCallBanner v-if="calls.active" :call="calls.active" @join="router.push(`/call/${calls.active!.id}`)" />

    <div v-if="consultant" class="card flex items-center gap-3 p-4 text-sm">
      <span class="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700">
        {{ consultant.name.charAt(0) }}
      </span>
      <p class="flex-1 text-slate-700">
        Your consultant is <b>{{ consultant.name }}</b>.
        <span class="text-slate-400">This is your currently assigned consultant; an admin can change it.</span>
      </p>
    </div>
    <div v-else class="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      Please wait until a consultant is assigned to you. You can raise requests once that's done.
    </div>

    <div class="grid gap-6 md:grid-cols-5">
      <form class="card space-y-4 p-5 md:col-span-2" @submit.prevent="submit">
        <h2 class="text-lg font-semibold">Ask for help</h2>
        <div>
          <label class="label" for="title">What are you stuck on?</label>
          <input id="title" v-model="title" class="input" maxlength="120" minlength="3" required placeholder="e.g. Can't export the monthly report" />
        </div>
        <div>
          <label class="label" for="desc">Details</label>
          <textarea id="desc" v-model="description" class="input min-h-28" maxlength="2000" required placeholder="What did you try? What happens?" />
        </div>
        <button class="btn-primary w-full" :disabled="submitting || !consultant">{{ submitting ? 'Sending…' : 'Raise request' }}</button>
      </form>

      <section class="card p-5 md:col-span-3">
        <h2 class="mb-4 text-lg font-semibold">My requests</h2>
        <p v-if="requests.loading && !requests.items.length" class="text-sm text-slate-500">Loading…</p>
        <p v-else-if="!requests.items.length" class="text-sm text-slate-500">No requests yet. Raise one when you get stuck.</p>
        <ul v-else class="divide-y divide-slate-100">
          <li v-for="r in requests.items" :key="r.id" class="flex items-start gap-3 py-3">
            <div class="flex-1">
              <p class="font-medium">{{ r.title }}</p>
              <p class="line-clamp-2 text-sm text-slate-500">{{ r.description }}</p>
              <p class="mt-1 text-xs text-slate-400">{{ timeAgo(r.createdAt) }} · {{ r.consultant.name }}</p>
            </div>
            <StatusBadge :status="r.status" />
            <button v-if="r.status === 'OPEN'" class="text-xs text-slate-500 underline hover:text-rose-600" @click="cancel(r.id)">
              Cancel
            </button>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
