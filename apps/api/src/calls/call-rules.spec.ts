import { canChangeConsent, canTransition, roomNameFor } from './call-rules';

describe('call state machine', () => {
  it.each([
    ['WAITING', 'ACTIVE', true],
    ['WAITING', 'MISSED', true],
    ['WAITING', 'ENDED', true],
    ['ACTIVE', 'ENDED', true],
    ['ACTIVE', 'WAITING', false],
    ['ACTIVE', 'MISSED', false],
    ['ENDED', 'ACTIVE', false],
    ['MISSED', 'ACTIVE', false],
  ] as const)('%s -> %s allowed: %s', (from, to, ok) => {
    expect(canTransition(from, to)).toBe(ok);
  });
});

describe('consent rules', () => {
  it('can be answered once, and a grant can be withdrawn', () => {
    expect(canChangeConsent('PENDING', 'GRANTED')).toBe(true);
    expect(canChangeConsent('PENDING', 'DECLINED')).toBe(true);
    expect(canChangeConsent('GRANTED', 'WITHDRAWN')).toBe(true);
    expect(canChangeConsent('DECLINED', 'GRANTED')).toBe(false);
    expect(canChangeConsent('GRANTED', 'DECLINED')).toBe(false);
    expect(canChangeConsent('WITHDRAWN', 'GRANTED')).toBe(false);
  });
});

it('room names are derived from the call id', () => {
  expect(roomNameFor('abc')).toBe('call-abc');
});
