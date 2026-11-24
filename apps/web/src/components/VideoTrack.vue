<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { RemoteTrack } from 'livekit-client';

/** Renders a LiveKit video track (the shared screen). */
const props = defineProps<{ track: RemoteTrack | null }>();
const el = ref<HTMLVideoElement | null>(null);

watch(
  [() => props.track, el],
  ([track, video], [oldTrack]) => {
    if (oldTrack && video) oldTrack.detach(video);
    if (track && video) track.attach(video);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (props.track && el.value) props.track.detach(el.value);
});
</script>

<template>
  <video ref="el" class="h-full w-full bg-black object-contain" autoplay playsinline muted></video>
</template>
