import type { Role } from '@chp/shared';

/** Our own small view of LiveKit data, so business code and tests never depend on SDK classes. */

export type EgressState = 'starting' | 'active' | 'ending' | 'complete' | 'failed' | 'aborted' | 'limit_reached';

export interface EgressSnapshot {
  egressId: string;
  state: EgressState;
  /** When LiveKit accepted the egress request (NOT when media started; the composite starts ~7-12 s later). */
  startedAt: Date | null;
  /** When the output's media actually started (from the segments/file result). Use this for timelines. */
  mediaStartedAt: Date | null;
  endedAt: Date | null;
  error: string | null;
}

export interface ParticipantSnapshot {
  identity: string;
  isRecorder: boolean;
  micTrackSids: string[];
}

export interface LiveKitEvent {
  id: string;
  event:
    | 'room_started'
    | 'room_finished'
    | 'participant_joined'
    | 'participant_left'
    | 'track_published'
    | 'track_unpublished'
    | 'egress_started'
    | 'egress_updated'
    | 'egress_ended'
    | string;
  roomName: string | null;
  participant: { identity: string; isRecorder: boolean } | null;
  track: { sid: string; isMicrophone: boolean } | null;
  egress: EgressSnapshot | null;
}

export interface TokenRequest {
  identity: string;
  name: string;
  room: string;
  role: Role;
}

/** True when an egress will not change any more. */
export const isEgressFinished = (state: EgressState) =>
  state === 'complete' || state === 'failed' || state === 'aborted' || state === 'limit_reached';
