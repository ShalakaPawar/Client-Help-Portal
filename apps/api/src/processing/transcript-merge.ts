import type { Role, TranscriptSegmentDto } from '@chp/shared';

/** One speech-to-text result for one voice file. Times are seconds from the start of that file. */
export interface Utterance {
  start: number;
  end: number;
  text: string;
}

export interface VoicePiece {
  role: Role;
  speakerName: string;
  /** Where this voice file starts on the video timeline (ms). */
  offsetMs: number;
  utterances: Utterance[];
}

export interface MergeOptions {
  /** A client line this close (ms) to a consultant line may be echo. */
  echoWindowMs: number;
  /** Word similarity (0..1) at or above which it is treated as echo. */
  echoSimilarity: number;
}

export const DEFAULT_MERGE_OPTIONS: MergeOptions = { echoWindowMs: 1500, echoSimilarity: 0.8 };

/**
 * Builds the call transcript from separate voice files.
 *  1. Shift each utterance by its file's offset so it lines up with the video.
 *  2. Label it with the speaker's name and role.
 *  3. Drop echo: a CLIENT line that repeats a CONSULTANT line at the same moment
 *     (the consultant's voice leaking from the client's speakers into the client's mic).
 *  4. Sort by start time. Overlapping speech keeps both lines.
 */
export function mergeTranscript(pieces: VoicePiece[], options: MergeOptions = DEFAULT_MERGE_OPTIONS): TranscriptSegmentDto[] {
  const segments: TranscriptSegmentDto[] = pieces.flatMap((p) =>
    p.utterances
      .filter((u) => u.text.trim().length > 0)
      .map((u) => ({
        speakerName: p.speakerName,
        role: p.role,
        startMs: Math.max(0, Math.round(p.offsetMs + u.start * 1000)),
        endMs: Math.max(0, Math.round(p.offsetMs + u.end * 1000)),
        text: u.text.trim(),
      })),
  );

  const consultantLines = segments.filter((s) => s.role === 'CONSULTANT');
  const withoutEcho = segments.filter((s) => {
    if (s.role !== 'CLIENT') return true;
    return !consultantLines.some(
      (c) => Math.abs(c.startMs - s.startMs) <= options.echoWindowMs && wordSimilarity(c.text, s.text) >= options.echoSimilarity,
    );
  });

  return withoutEcho.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/** Jaccard similarity of the two texts' word sets (case and punctuation ignored). */
export function wordSimilarity(a: string, b: string): number {
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean));
  const A = words(a);
  const B = words(b);
  if (A.size === 0 && B.size === 0) return 1;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common);
}
