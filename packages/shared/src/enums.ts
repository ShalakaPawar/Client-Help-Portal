// String enums shared by API and web. Values match the Prisma enums exactly.

export const Role = { CONSULTANT: 'CONSULTANT', CLIENT: 'CLIENT', ADMIN: 'ADMIN' } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const RequestStatus = {
  OPEN: 'OPEN',
  IN_CALL: 'IN_CALL',
  RESOLVED: 'RESOLVED',
  CANCELLED: 'CANCELLED',
} as const;
export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];

export const CallStatus = {
  WAITING: 'WAITING',
  ACTIVE: 'ACTIVE',
  ENDED: 'ENDED',
  MISSED: 'MISSED',
} as const;
export type CallStatus = (typeof CallStatus)[keyof typeof CallStatus];

export const ConsentStatus = {
  PENDING: 'PENDING',
  GRANTED: 'GRANTED',
  DECLINED: 'DECLINED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type ConsentStatus = (typeof ConsentStatus)[keyof typeof ConsentStatus];

export const RecordingStatus = {
  PENDING_CONSENT: 'PENDING_CONSENT',
  NONE: 'NONE',
  STARTING: 'STARTING',
  RECORDING: 'RECORDING',
  STOPPING: 'STOPPING',
  FINALIZING: 'FINALIZING',
  AVAILABLE: 'AVAILABLE',
  FAILED: 'FAILED',
} as const;
export type RecordingStatus = (typeof RecordingStatus)[keyof typeof RecordingStatus];

export const ProcessingStatus = {
  PENDING: 'PENDING',
  TRANSCRIBING: 'TRANSCRIBING',
  SUMMARIZING: 'SUMMARIZING',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;
export type ProcessingStatus = (typeof ProcessingStatus)[keyof typeof ProcessingStatus];

export const Outcome = { RESOLVED: 'RESOLVED', UNRESOLVED: 'UNRESOLVED', UNCLEAR: 'UNCLEAR' } as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_IN_USE: 'EMAIL_IN_USE',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_WEBHOOK_SIGNATURE: 'INVALID_WEBHOOK_SIGNATURE',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  NOT_FOUND: 'NOT_FOUND',
  CONSULTANT_BUSY: 'CONSULTANT_BUSY',
  CALL_ALREADY_ACTIVE: 'CALL_ALREADY_ACTIVE',
  INVALID_STATE: 'INVALID_STATE',
  RATE_LIMITED: 'RATE_LIMITED',
  MEDIA_SERVER_UNAVAILABLE: 'MEDIA_SERVER_UNAVAILABLE',
  RECORDER_UNAVAILABLE: 'RECORDER_UNAVAILABLE',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_AUTH_FAILED: 'PROVIDER_AUTH_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
