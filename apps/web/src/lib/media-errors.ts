/**
 * Turns browser media errors (getUserMedia / getDisplayMedia) into plain-language messages.
 * `kind` says which device we were asking for.
 */
export function describeMediaError(err: unknown, kind: 'microphone' | 'screen'): string {
  const name = (err as { name?: string })?.name ?? '';
  if (kind === 'screen') {
    if (name === 'NotAllowedError' || name === 'AbortError') {
      return 'Screen sharing was cancelled. Click "Share screen" to try again.';
    }
    if (name === 'NotReadableError') return 'Your screen could not be captured. Close other apps that are recording the screen and try again.';
    if (name === 'NotSupportedError') return 'This browser cannot share the screen. Please use Chrome.';
  } else {
    if (name === 'NotAllowedError') {
      return 'Microphone access is blocked. Allow it in the browser address bar (the camera/mic icon), then click "Unmute".';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Plug one in and click "Unmute".';
    if (name === 'NotReadableError') return 'Your microphone is in use by another app. Close it and click "Unmute".';
  }
  return `Could not access your ${kind}: ${(err as Error)?.message ?? 'unknown error'}`;
}
