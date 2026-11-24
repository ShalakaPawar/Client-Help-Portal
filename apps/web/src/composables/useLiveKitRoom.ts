import { markRaw, onBeforeUnmount, ref, shallowRef } from 'vue';
import {
  ConnectionState,
  DisconnectReason,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import { describeMediaError } from '@/lib/media-errors';
import { type CallConnection, type DisconnectCause, stateAfterDisconnect } from '@/lib/connection';

/**
 * One LiveKit room for the call page. The SDK handles WebRTC, reconnects and
 * track handling; this composable exposes simple reactive state for the UI.
 * There is NO recording code here: recording happens on the server (Egress).
 */
export function useLiveKitRoom() {
  const state = ref<CallConnection>('idle');
  const micEnabled = ref(false);
  const sharingScreen = ref(false);
  const audioBlocked = ref(false);
  const mediaError = ref<string | null>(null);
  /** The other participant's screen share (consultant sees the client's screen). */
  const remoteScreen = shallowRef<RemoteTrack | null>(null);
  const remotePresent = ref(false);

  let room: Room | null = null;
  const audioEls = new Map<string, HTMLMediaElement>();

  async function connect(url: string, token: string) {
    await leave();
    state.value = 'connecting';
    const r = markRaw(
      new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }),
    );
    room = r;

    r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        el.style.display = 'none';
        document.body.appendChild(el);
        audioEls.set(track.sid ?? String(Math.random()), el);
      } else if (track.source === Track.Source.ScreenShare) {
        remoteScreen.value = track;
      }
    });
    r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      track.detach().forEach((el) => el.remove());
      if (track === remoteScreen.value) remoteScreen.value = null;
    });
    r.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
      // Fires when the user clicks Chrome's "Stop sharing" bar.
      if (pub.source === Track.Source.ScreenShare) sharingScreen.value = false;
    });
    r.on(RoomEvent.ParticipantConnected, () => (remotePresent.value = hasRemote(r)));
    r.on(RoomEvent.ParticipantDisconnected, (_p: RemoteParticipant) => (remotePresent.value = hasRemote(r)));
    r.on(RoomEvent.Reconnecting, () => (state.value = 'reconnecting'));
    r.on(RoomEvent.Reconnected, () => (state.value = 'connected'));
    r.on(RoomEvent.AudioPlaybackStatusChanged, () => (audioBlocked.value = !r.canPlaybackAudio));
    r.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      cleanupMedia();
      if (state.value !== 'idle') state.value = stateAfterDisconnect(toCause(reason));
    });

    try {
      await r.connect(url, token);
      state.value = r.state === ConnectionState.Connected ? 'connected' : 'connecting';
      remotePresent.value = hasRemote(r);
      audioBlocked.value = !r.canPlaybackAudio;
    } catch (err) {
      state.value = 'failed';
      throw err;
    }
    await setMic(true);
  }

  async function setMic(on: boolean) {
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(on);
      micEnabled.value = on;
      mediaError.value = null;
    } catch (err) {
      micEnabled.value = false;
      mediaError.value = describeMediaError(err, 'microphone');
    }
  }

  async function startScreenShare() {
    if (!room) return;
    try {
      await room.localParticipant.setScreenShareEnabled(true, { audio: false, selfBrowserSurface: 'exclude' });
      sharingScreen.value = true;
      mediaError.value = null;
    } catch (err) {
      sharingScreen.value = false;
      mediaError.value = describeMediaError(err, 'screen');
    }
  }

  async function stopScreenShare() {
    await room?.localParticipant.setScreenShareEnabled(false);
    sharingScreen.value = false;
  }

  /** Browsers block autoplay until a click; this resumes remote audio. */
  async function enableAudio() {
    await room?.startAudio();
    audioBlocked.value = !(room?.canPlaybackAudio ?? true);
  }

  async function leave() {
    const r = room;
    room = null;
    state.value = 'idle';
    cleanupMedia();
    if (r) await r.disconnect();
  }

  function cleanupMedia() {
    audioEls.forEach((el) => el.remove());
    audioEls.clear();
    remoteScreen.value = null;
    sharingScreen.value = false;
    micEnabled.value = false;
  }

  onBeforeUnmount(() => void leave());

  return {
    state,
    micEnabled,
    sharingScreen,
    audioBlocked,
    mediaError,
    remoteScreen,
    remotePresent,
    connect,
    setMic,
    startScreenShare,
    stopScreenShare,
    enableAudio,
    leave,
  };
}

function hasRemote(r: Room) {
  // Recorders (Egress) join as hidden participants and are not listed here.
  return r.remoteParticipants.size > 0;
}

function toCause(reason?: DisconnectReason): DisconnectCause {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'DUPLICATE_IDENTITY';
    case DisconnectReason.ROOM_DELETED:
      return 'ROOM_DELETED';
    case DisconnectReason.PARTICIPANT_REMOVED:
      return 'PARTICIPANT_REMOVED';
    case DisconnectReason.CLIENT_INITIATED:
      return 'CLIENT_INITIATED';
    default:
      return 'OTHER';
  }
}
