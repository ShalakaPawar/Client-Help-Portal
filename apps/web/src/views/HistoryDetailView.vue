<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { HistoryDetailDto, MediaTokenDto, TranscriptSegmentDto } from '@chp/shared';
import { http } from '@/services/http';
import { onSocket } from '@/services/socket';
import { useAuth } from '@/stores/auth';
import { useToasts } from '@/stores/toasts';
import { activeSegmentIndex, formatClock, formatDateTime, seekSeconds } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge.vue';
import TranscriptList from '@/components/TranscriptList.vue';

const route = useRoute();
const auth = useAuth();
const toasts = useToasts();
const callId = route.params.id as string;

const detail = ref<HistoryDetailDto | null>(null);
const notFound = ref(false);
const videoUrl = ref<string | null>(null);
const video = ref<HTMLVideoElement | null>(null);
const currentMs = ref(0);
const retrying = ref(false);

const recording = computed(() => detail.value?.call.recording ?? null);
const segments = computed<TranscriptSegmentDto[]>(() => detail.value?.transcript ?? []);
const activeIndex = computed(() => activeSegmentIndex(segments.value, currentMs.value));
const processingText = computed(() => {
  const r = recording.value;
  if (!r) return null;
  if (r.status === 'NONE') return 'This call was not recorded (the client chose not to).';
  if (r.status === 'STOPPING' || r.status === 'FINALIZING') return 'Preparing the video…';
  if (r.processingStatus === 'TRANSCRIBING') return 'Making the transcript…';
  if (r.processingStatus === 'SUMMARIZING') return 'Writing the summary…';
  if (r.processingStatus === 'PENDING') return 'Waiting to process…';
  return null;
});
const failed = computed(() => recording.value && (recording.value.processingStatus === 'FAILED' || recording.value.status === 'FAILED'));

async function load() {
  try {
    detail.value = await http.get<HistoryDetailDto>(`/history/${callId}`);
    if (recording.value?.status === 'AVAILABLE' && !videoUrl.value) await loadVideo();
  } catch (err) {
    if ((err as { status?: number }).status === 404) notFound.value = true;
    else toasts.error(err);
  }
}

async function loadVideo(resumeAt?: number) {
  if (!recording.value) return;
  const token = await http.get<MediaTokenDto>(`/recordings/${recording.value.id}/media-token`);
  videoUrl.value = token.url;
  if (resumeAt !== undefined) {
    // The <video> reloads with the new URL; jump back to where the user was.
    requestAnimationFrame(() => video.value?.addEventListener('loadedmetadata', () => (video.value!.currentTime = resumeAt), { once: true }));
  }
}

/** The signed link expires after 5 minutes; get a new one and continue where we were. */
async function onVideoError() {
  const at = video.value?.currentTime ?? 0;
  try {
    await loadVideo(at);
  } catch (err) {
    toasts.error(err);
  }
}

function seek(s: TranscriptSegmentDto) {
  if (!video.value) return;
  video.value.currentTime = seekSeconds(s);
  void video.value.play().catch(() => undefined);
}

async function retry() {
  if (!recording.value) return;
  retrying.value = true;
  try {
    await http.post(`/recordings/${recording.value.id}/retry`);
    toasts.info('Processing restarted.');
    await load();
  } catch (err) {
    toasts.error(err);
  } finally {
    retrying.value = false;
  }
}

onMounted(load);
const offs = [
  onSocket('processing:updated', (p) => p.callId === callId && load()),
  onSocket('recording:status', (p) => p.callId === callId && load()),
];
onBeforeUnmount(() => offs.forEach((off) => off()));
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-4 px-4 py-6">
    <RouterLink to="/history" class="text-sm text-indigo-600 hover:underline">← All calls</RouterLink>

    <div v-if="notFound" class="card p-6 text-slate-600">This call does not exist or you don't have access to it.</div>

    <template v-else-if="detail">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex-1">
          <h1 class="text-xl font-semibold">{{ detail.call.requestTitle }}</h1>
          <p class="text-sm text-slate-500">
            {{ formatDateTime(detail.call.startedAt) }} · with
            {{ auth.isClient ? detail.call.consultant.name : detail.call.client.name }}
            <template v-if="recording?.durationMs"> · {{ formatClock(recording.durationMs) }}</template>
          </p>
        </div>
        <StatusBadge v-if="recording?.partial" status="FAILED" label="partly recorded" />
      </div>

      <div v-if="processingText" class="card flex items-center gap-3 p-4 text-sm text-slate-600">
        <span v-if="recording?.status !== 'NONE'" class="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent"></span>
        {{ processingText }}
      </div>
      <div v-if="failed" class="card flex items-center gap-3 border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        <span class="flex-1">Processing failed: {{ recording?.lastError ?? 'unknown error' }}</span>
        <button class="btn-secondary" :disabled="retrying" @click="retry">{{ retrying ? 'Retrying…' : 'Retry' }}</button>
      </div>

      <div class="grid gap-4 lg:grid-cols-5">
        <div class="space-y-4 lg:col-span-3">
          <div class="card overflow-hidden bg-black">
            <video
              v-if="videoUrl"
              ref="video"
              :src="videoUrl"
              class="aspect-video w-full"
              controls
              preload="metadata"
              @timeupdate="currentMs = (video?.currentTime ?? 0) * 1000"
              @error="onVideoError"
            ></video>
            <div v-else class="flex aspect-video items-center justify-center text-sm text-slate-400">
              {{ recording?.status === 'NONE' ? 'No recording' : 'The video will appear here when it is ready.' }}
            </div>
          </div>

          <section v-if="detail.summary" class="card p-5">
            <div class="mb-3 flex items-center gap-2">
              <h2 class="text-lg font-semibold">Summary</h2>
              <StatusBadge
                :status="detail.summary.outcome === 'RESOLVED' ? 'RESOLVED' : detail.summary.outcome === 'UNRESOLVED' ? 'FAILED' : 'OPEN'"
                :label="detail.summary.outcome.toLowerCase()"
              />
            </div>
            <p class="text-sm text-slate-700">{{ detail.summary.overview }}</p>
            <template v-if="detail.summary.issuesDiscussed.length">
              <h3 class="mt-4 text-sm font-medium">Issues discussed</h3>
              <ul class="mt-1 list-disc pl-5 text-sm text-slate-700">
                <li v-for="(i, k) in detail.summary.issuesDiscussed" :key="k">{{ i }}</li>
              </ul>
            </template>
            <template v-if="detail.summary.resolution">
              <h3 class="mt-4 text-sm font-medium">Resolution</h3>
              <p class="text-sm text-slate-700">{{ detail.summary.resolution }}</p>
            </template>
            <h3 class="mt-4 text-sm font-medium">Action items</h3>
            <ul v-if="detail.summary.actionItems.length" class="mt-1 space-y-1 text-sm">
              <li v-for="(a, k) in detail.summary.actionItems" :key="k" class="flex gap-2">
                <span class="rounded bg-slate-100 px-1.5 text-xs leading-5 text-slate-600">{{ a.owner === 'CLIENT' ? 'Client' : 'Consultant' }}</span>
                <span class="text-slate-700">{{ a.task }}</span>
              </li>
            </ul>
            <p v-else class="text-sm text-slate-500">None.</p>
          </section>
        </div>

        <section class="card p-4 lg:col-span-2">
          <h2 class="mb-2 text-lg font-semibold">Transcript</h2>
          <p v-if="!detail.transcript" class="text-sm text-slate-500">
            {{ recording?.status === 'NONE' ? 'No transcript (not recorded).' : 'The transcript will appear here.' }}
          </p>
          <p v-else-if="!segments.length" class="text-sm text-slate-500">No speech was detected.</p>
          <template v-else>
            <p class="mb-2 text-xs text-slate-400">Click a line to jump to that moment.</p>
            <TranscriptList :segments="segments" :active-index="activeIndex" :seekable="!!videoUrl" @seek="seek" />
          </template>
        </section>
      </div>
    </template>
  </div>
</template>
