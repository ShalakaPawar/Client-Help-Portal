import { mergeTranscript, VoicePiece, wordSimilarity } from './transcript-merge';

const client = (offsetMs: number, utterances: VoicePiece['utterances']): VoicePiece => ({
  role: 'CLIENT',
  speakerName: 'Alice',
  offsetMs,
  utterances,
});
const consultant = (offsetMs: number, utterances: VoicePiece['utterances']): VoicePiece => ({
  role: 'CONSULTANT',
  speakerName: 'Sam',
  offsetMs,
  utterances,
});

describe('mergeTranscript', () => {
  it('shifts each voice file by its offset and labels speakers', () => {
    const out = mergeTranscript([
      client(0, [{ start: 1, end: 2, text: 'My export is broken' }]),
      consultant(500, [{ start: 2, end: 3, text: 'Click the settings icon' }]),
    ]);
    expect(out).toEqual([
      { speakerName: 'Alice', role: 'CLIENT', startMs: 1000, endMs: 2000, text: 'My export is broken' },
      { speakerName: 'Sam', role: 'CONSULTANT', startMs: 2500, endMs: 3500, text: 'Click the settings icon' },
    ]);
  });

  it('keeps both lines when people talk over each other, in time order', () => {
    const out = mergeTranscript([
      client(0, [{ start: 5, end: 8, text: 'I already tried restarting it' }]),
      consultant(0, [{ start: 5.5, end: 7, text: 'Okay so first open settings' }]),
    ]);
    expect(out.map((s) => s.speakerName)).toEqual(['Alice', 'Sam']);
  });

  it('places a second voice piece (after a refresh) later on the timeline', () => {
    const out = mergeTranscript([
      client(0, [{ start: 1, end: 2, text: 'before refresh' }]),
      client(60_000, [{ start: 1, end: 2, text: 'after refresh' }]),
    ]);
    expect(out.map((s) => [s.startMs, s.text])).toEqual([
      [1000, 'before refresh'],
      [61000, 'after refresh'],
    ]);
  });

  it("drops client lines that are just the consultant's voice echoing into the client's mic", () => {
    const out = mergeTranscript([
      consultant(0, [{ start: 10, end: 12, text: 'Open the reports tab please' }]),
      client(0, [
        { start: 10.4, end: 12.2, text: 'open the reports tab, please' }, // echo
        { start: 14, end: 15, text: 'Done, I see it now' }, // real speech
      ]),
    ]);
    expect(out.map((s) => `${s.speakerName}: ${s.text}`)).toEqual(['Sam: Open the reports tab please', 'Alice: Done, I see it now']);
  });

  it('does not treat similar words far apart in time as echo', () => {
    const out = mergeTranscript([
      consultant(0, [{ start: 10, end: 11, text: 'yes that works' }]),
      client(0, [{ start: 40, end: 41, text: 'yes that works' }]),
    ]);
    expect(out).toHaveLength(2);
  });

  it('ignores empty utterances and never produces negative times', () => {
    const out = mergeTranscript([client(-2000, [{ start: 0, end: 1, text: 'hi' }, { start: 2, end: 3, text: '   ' }])]);
    expect(out).toEqual([{ speakerName: 'Alice', role: 'CLIENT', startMs: 0, endMs: 0, text: 'hi' }]);
  });
});

describe('wordSimilarity', () => {
  it('ignores case and punctuation', () => {
    expect(wordSimilarity('Open the tab, please!', 'open the tab please')).toBe(1);
  });
  it('is low for different sentences', () => {
    expect(wordSimilarity('the export works now', 'can you share your screen')).toBeLessThan(0.2);
  });
});
