/** UI meaning of the LiveKit connection, kept separate from the SDK so it can be unit-tested. */

export type CallConnection = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'moved' | 'failed';

/** LiveKit DisconnectReason names we care about. */
export type DisconnectCause = 'DUPLICATE_IDENTITY' | 'ROOM_DELETED' | 'PARTICIPANT_REMOVED' | 'CLIENT_INITIATED' | 'OTHER';

/** What a disconnect means for the user. */
export function stateAfterDisconnect(cause: DisconnectCause): CallConnection {
  if (cause === 'DUPLICATE_IDENTITY') return 'moved'; // same user opened the call in another tab
  return 'disconnected';
}

export function connectionLabel(state: CallConnection): string {
  switch (state) {
    case 'idle':
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Connected';
    case 'reconnecting':
      return 'Connection lost. Reconnecting…';
    case 'moved':
      return 'This call was opened in another tab.';
    case 'failed':
      return 'Could not connect to the call.';
    case 'disconnected':
      return 'Disconnected';
  }
}
