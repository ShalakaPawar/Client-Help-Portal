import type { TranscriptSegmentDto } from '@chp/shared';

/** 65_000 -> "1:05", 3_725_000 -> "1:02:05" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const sec = Math.round((now - new Date(iso).getTime()) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

/** Video time (seconds) to jump to when a transcript line is clicked. */
export function seekSeconds(segment: Pick<TranscriptSegmentDto, 'startMs'>): number {
  return Math.max(0, segment.startMs / 1000);
}

/**
 * The transcript line being spoken at `timeMs` (the last line that has started),
 * or -1 before the first line. Segments are sorted by startMs.
 */
export function activeSegmentIndex(segments: Pick<TranscriptSegmentDto, 'startMs'>[], timeMs: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].startMs <= timeMs) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
