import { CallStatus, ConsentStatus } from '@chp/shared';

/**
 * Allowed call status changes. Anything else is rejected with 409 INVALID_STATE.
 *   WAITING -> ACTIVE (client joined) | ENDED (consultant cancelled) | MISSED (ring timeout)
 *   ACTIVE  -> ENDED
 */
export const CALL_TRANSITIONS: Record<CallStatus, CallStatus[]> = {
  WAITING: ['ACTIVE', 'ENDED', 'MISSED'],
  ACTIVE: ['ENDED'],
  ENDED: [],
  MISSED: [],
};

export const LIVE_CALL_STATUSES: CallStatus[] = ['WAITING', 'ACTIVE'];

export function canTransition(from: CallStatus, to: CallStatus) {
  return CALL_TRANSITIONS[from].includes(to);
}

/** Consent can be given or declined once; a grant can later be withdrawn. */
export function canChangeConsent(from: ConsentStatus, to: ConsentStatus) {
  if (from === 'PENDING') return to === 'GRANTED' || to === 'DECLINED';
  if (from === 'GRANTED') return to === 'WITHDRAWN';
  return false;
}

export const roomNameFor = (callId: string) => `call-${callId}`;
