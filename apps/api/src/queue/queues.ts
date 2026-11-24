/** Queue and job names in one place. Job ids use '-' (BullMQ does not allow ':' in custom ids). */

export const PROCESSING_QUEUE = 'processing';
export const TIMERS_QUEUE = 'timers';

export const ProcessingJob = { PROCESS_RECORDING: 'process-recording' } as const;

export const TimerJob = {
  /** Client did not join in time -> MISSED. */
  RING_TIMEOUT: 'ring-timeout',
  /** Someone left; if both are still gone -> end the call. */
  AUTO_END_CHECK: 'auto-end-check',
  /** Maximum call length reached -> end the call. */
  CALL_CAP: 'call-cap',
  /** Safety net when egress_ended webhooks don't arrive. */
  EGRESS_CHECK: 'egress-check',
} as const;
export type TimerJob = (typeof TimerJob)[keyof typeof TimerJob];

export interface ProcessRecordingData {
  recordingId: string;
}

export interface TimerData {
  id: string; // callId or recordingId depending on the job
}

export const processingJobId = (recordingId: string) => `rec-${recordingId}`;
export const timerJobId = (name: TimerJob, id: string) => `${name}-${id}`;
