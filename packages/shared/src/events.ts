// Socket.IO events pushed from the server to browsers (notifications only;
// call media and call signalling are handled by LiveKit).
import type { CallDto, HelpRequestDto } from './dto';
import type { ProcessingStatus, RecordingStatus, Role } from './enums';

export const SocketEvent = {
  REQUEST_CREATED: 'request:created',
  REQUEST_UPDATED: 'request:updated',
  CALL_INCOMING: 'call:incoming',
  CALL_UPDATED: 'call:updated',
  CALL_ENDED: 'call:ended',
  PARTICIPANT_LEFT: 'participant:left',
  PARTICIPANT_RETURNED: 'participant:returned',
  RECORDING_STATUS: 'recording:status',
  PROCESSING_UPDATED: 'processing:updated',
} as const;
export type SocketEvent = (typeof SocketEvent)[keyof typeof SocketEvent];

export interface RecordingStatusPayload {
  callId: string;
  recordingId: string;
  status: RecordingStatus;
}

export interface ProcessingUpdatedPayload {
  callId: string;
  recordingId: string;
  processingStatus: ProcessingStatus;
  lastError: string | null;
}

export interface ParticipantPresencePayload {
  callId: string;
  role: Role;
  name: string;
}

export interface ServerToClientEvents {
  'request:created': (request: HelpRequestDto) => void;
  'request:updated': (request: HelpRequestDto) => void;
  'call:incoming': (call: CallDto) => void;
  'call:updated': (call: CallDto) => void;
  'call:ended': (call: CallDto) => void;
  'participant:left': (payload: ParticipantPresencePayload) => void;
  'participant:returned': (payload: ParticipantPresencePayload) => void;
  'recording:status': (payload: RecordingStatusPayload) => void;
  'processing:updated': (payload: ProcessingUpdatedPayload) => void;
}

// Browsers never send events to the server (all changes go through REST).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClientToServerEvents {}
