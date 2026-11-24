import { connectionLabel, stateAfterDisconnect } from './connection';
import { describeMediaError } from './media-errors';

describe('call connection states', () => {
  it('opening the call in another tab shows "moved", not a generic disconnect', () => {
    expect(stateAfterDisconnect('DUPLICATE_IDENTITY')).toBe('moved');
    expect(connectionLabel('moved')).toMatch(/another tab/);
  });

  it('other disconnects are plain disconnects', () => {
    expect(stateAfterDisconnect('ROOM_DELETED')).toBe('disconnected');
  });

  it('reconnecting is shown to the user', () => {
    expect(connectionLabel('reconnecting')).toMatch(/Reconnecting/);
  });
});

describe('media error messages', () => {
  const err = (name: string) => Object.assign(new Error('x'), { name });

  it('explains a blocked microphone', () => {
    expect(describeMediaError(err('NotAllowedError'), 'microphone')).toMatch(/blocked/);
  });
  it('explains a missing microphone', () => {
    expect(describeMediaError(err('NotFoundError'), 'microphone')).toMatch(/No microphone/);
  });
  it('treats a cancelled screen picker as a cancel, not a failure', () => {
    expect(describeMediaError(err('NotAllowedError'), 'screen')).toMatch(/cancelled/);
  });
});
