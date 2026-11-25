<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { CallDto, LiveKitJoinDto } from '@chp/shared';
import { http } from '@/services/http';
import { onSocket } from '@/services/socket';
import { useAuth } from '@/stores/auth';
import { useCallStore } from '@/stores/call';
import { useToasts } from '@/stores/toasts';
import { useLiveKitRoom } from '@/composables/useLiveKitRoom';
import { connectionLabel } from '@/lib/connection';
import VideoTrack from '@/components/VideoTrack.vue';
import ConsentModal from '@/components/ConsentModal.vue';

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const callStore = useCallStore();
const toasts = useToasts();
const lk = useLiveKitRoom();

const callId = route.params.id as string;
const call = ref<CallDto | null>(null);
const loadError = ref<string | null>(null);
const busy = ref(false);
const presenceNote = ref<string | null>(null);
const showEndDialog = ref(false);
const maxCallMinutes = ref<number | null>(null);
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 10_000);

/** Minutes left before the automatic end (shown in the last 5 minutes). */
const minutesLeft = computed(() => {
  if (!maxCallMinutes.value || !call.value?.startedAt || call.value.status !== 'ACTIVE') return null;
  const endsAt = new Date(call.value.startedAt).getTime() + maxCallMinutes.value * 60_000;
  const left = Math.ceil((endsAt - now.value) / 60_000);
  return left <= 5 ? Math.max(left, 0) : null;
});

const other = computed(() => (call.value ? (auth.isClient ? call.value.consultant : call.value.client) : null));
const recordingOn = computed(() => {
  const s = call.value?.recording?.status;
  return call.value?.consent === 'GRANTED' && (s === 'STARTING' || s === 'RECORDING');
});
const needsConsent = computed(() => auth.isClient && call.value?.status === 'ACTIVE' && call.value?.consent === 'PENDING');

onMounted(async () => {
  try {
    // Client: join (also rejoins after a refresh). Consultant: fresh token for the room.
    const info = auth.isClient
      ? await http.post<LiveKitJoinDto>(`/calls/${callId}/join`)
      : await http.get<LiveKitJoinDto>(`/calls/${callId}/livekit-token`);
    call.value = info.call;
    maxCallMinutes.value = info.maxCallMinutes;
    callStore.apply(info.call);
    await lk.connect(info.livekitUrl, info.token);
  } catch (err) {
    loadError.value = (err as Error).message;
  }
});

const unsubscribers = [
  onSocket('call:updated', (c) => {
    if (c.id === callId) call.value = c;
  }),
  onSocket('call:ended', async (c) => {
    if (c.id !== callId) return;
    call.value = c;
    await lk.leave();
    toasts.info(c.status === 'MISSED' ? 'The call was not answered.' : 'The call has ended.');
    await router.push(c.status === 'ENDED' ? `/history/${callId}` : auth.homeRoute);
  }),
  onSocket('recording:status', (p) => {
    if (p.callId === callId && call.value) {
      call.value = { ...call.value, recording: call.value.recording ? { ...call.value.recording, status: p.status } : call.value.recording };
      if (p.status === 'FAILED') toasts.error(new Error('Recording failed to start. The call continues without recording.'));
    }
  }),
  onSocket('participant:left', (p) => {
    if (p.callId === callId) presenceNote.value = `${p.name} disconnected. Waiting for them to come back…`;
  }),
  onSocket('participant:returned', (p) => {
    if (p.callId === callId) presenceNote.value = null;
  }),
];
onBeforeUnmount(() => {
  unsubscribers.forEach((u) => u());
  clearInterval(clock);
});

async function answerConsent(granted: boolean) {
  busy.value = true;
  try {
    call.value = await http.post<CallDto>(`/calls/${callId}/consent`, { granted });
    toasts.info(granted ? 'Recording started.' : 'The call continues without recording.');
  } catch (err) {
    toasts.error(err);
  } finally {
    busy.value = false;
  }
}

async function stopRecording() {
  busy.value = true;
  try {
    call.value = await http.post<CallDto>(`/calls/${callId}/recording/stop`);
    toasts.info('Recording stopped. What was recorded so far will still be processed.');
  } catch (err) {
    toasts.error(err);
  } finally {
    busy.value = false;
  }
}

async function endCall(resolved?: boolean) {
  busy.value = true;
  showEndDialog.value = false;
  try {
    await http.post(`/calls/${callId}/end`, resolved === undefined ? {} : { resolved });
    // The call:ended event navigates away.
  } catch (err) {
    toasts.error(err);
  } finally {
    busy.value = false;
  }
}

function onEndClick() {
  if (auth.isConsultant) showEndDialog.value = true;
  else if (confirm('End the call for both of you?')) void endCall();
}
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
    <div v-if="loadError" class="card p-6">
      <p class="font-medium text-rose-700">Could not open this call</p>
      <p class="mt-1 text-sm text-slate-600">{{ loadError }}</p>
      <RouterLink :to="auth.homeRoute" class="btn-secondary mt-4">Back to dashboard</RouterLink>
    </div>

    <template v-else>
      <!-- Header: who, status, recording -->
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex-1">
          <h1 class="text-lg font-semibold">{{ call?.requestTitle ?? 'Call' }}</h1>
          <p class="text-sm text-slate-500">
            with {{ other?.name ?? '…' }} ·
            <span :class="lk.state.value === 'connected' ? 'text-emerald-700' : 'text-amber-700'">{{ connectionLabel(lk.state.value) }}</span>
          </p>
        </div>
        <span v-if="recordingOn" class="flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-sm font-medium text-rose-700">
          <span class="h-2 w-2 animate-pulse rounded-full bg-rose-600"></span> Recording
        </span>
        <span v-else-if="call?.consent === 'DECLINED' || call?.consent === 'WITHDRAWN'" class="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
          Not recorded
        </span>
        <span v-else-if="call?.consent === 'PENDING' && auth.isConsultant" class="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-800">
          Waiting for recording consent
        </span>
      </div>

      <!-- Notices -->
      <div v-if="lk.state.value === 'moved'" class="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        This call is now open in another tab or window. You can close this one.
      </div>
      <div v-if="minutesLeft !== null" class="card border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        This call will end automatically in about {{ minutesLeft }} min ({{ maxCallMinutes }}-minute limit).
      </div>
      <div v-if="presenceNote" class="card border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{{ presenceNote }}</div>
      <div v-if="lk.mediaError.value" class="card border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
        {{ lk.mediaError.value }}
      </div>
      <div v-if="lk.audioBlocked.value" class="card flex items-center gap-3 p-3 text-sm">
        <span class="flex-1">Your browser blocked sound until you click.</span>
        <button class="btn-primary py-1.5" @click="lk.enableAudio()">Turn on sound</button>
      </div>
      <div v-if="call?.status === 'WAITING' && auth.isConsultant" class="card p-3 text-sm text-slate-600">
        Calling {{ call.client.name }}… they'll see a "Join call" button.
      </div>

      <!-- Stage -->
      <div class="card relative aspect-video overflow-hidden bg-slate-900">
        <VideoTrack v-if="auth.isConsultant && lk.remoteScreen.value" :track="lk.remoteScreen.value" />
        <div v-else class="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-slate-300">
          <template v-if="auth.isClient">
            <p v-if="lk.sharingScreen.value" class="text-lg">You are sharing your screen with {{ other?.name }}.</p>
            <template v-else>
              <p class="text-lg">Share your screen so {{ other?.name ?? 'your consultant' }} can see what you see.</p>
              <button class="btn-primary" :disabled="lk.state.value !== 'connected'" @click="lk.startScreenShare()">Share screen</button>
            </template>
          </template>
          <p v-else-if="lk.remotePresent.value" class="text-lg">Waiting for {{ other?.name }} to share their screen…</p>
          <p v-else class="text-lg">Waiting for {{ other?.name ?? 'the client' }} to join…</p>
        </div>
      </div>

      <!-- Controls -->
      <div class="flex flex-wrap items-center justify-center gap-3">
        <button class="btn-secondary" :disabled="lk.state.value !== 'connected'" @click="lk.setMic(!lk.micEnabled.value)">
          {{ lk.micEnabled.value ? '🎙 Mute' : '🔇 Unmute' }}
        </button>
        <button v-if="auth.isClient && lk.sharingScreen.value" class="btn-secondary" @click="lk.stopScreenShare()">Stop sharing</button>
        <button v-if="auth.isClient && recordingOn" class="btn-secondary" :disabled="busy" @click="stopRecording">Stop recording</button>
        <button class="btn-danger" :disabled="busy" @click="onEndClick">End call</button>
      </div>
      <p class="text-center text-xs text-slate-400">Tip: use headphones so your speakers don't echo into the microphone.</p>
    </template>

    <ConsentModal v-if="needsConsent" :busy="busy" :consultant-name="call!.consultant.name" @answer="answerConsent" />

    <!-- Consultant: end + resolve in one step -->
    <div v-if="showEndDialog" class="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div class="card w-full max-w-sm p-6">
        <h2 class="text-lg font-semibold">End the call</h2>
        <p class="mt-2 text-sm text-slate-600">Was {{ call?.client.name }}'s problem solved?</p>
        <div class="mt-5 flex flex-col gap-2">
          <button class="btn-primary" @click="endCall(true)">Yes, mark resolved</button>
          <button class="btn-secondary" @click="endCall(false)">No, keep the request open</button>
          <button class="btn mt-1 text-slate-500" @click="showEndDialog = false">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>
