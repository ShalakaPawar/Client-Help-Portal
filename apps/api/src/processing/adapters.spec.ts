import Anthropic from '@anthropic-ai/sdk';
import { hlsToMp4Args, playlistDurationMs } from './ffmpeg';
import { mapDeepgramUtterances } from './deepgram.adapter';
import { formatTranscript, summarySchema, toProviderError } from './claude.adapter';
import { ProviderError } from './provider-errors';

describe('ffmpeg helpers', () => {
  it('builds a stream-copy, seekable MP4 command', () => {
    const args = hlsToMp4Args('/in/index.m3u8', '/out/composite.mp4');
    expect(args).toEqual(expect.arrayContaining(['-c', 'copy', '-movflags', '+faststart', '-bsf:a', 'aac_adtstoasc']));
    expect(args.slice(-1)).toEqual(['/out/composite.mp4']);
  });

  it('sums the playlist segment durations', () => {
    const playlist = '#EXTM3U\n#EXTINF:4.000,\nseg_0.ts\n#EXTINF:4.000,\nseg_1.ts\n#EXTINF:2.500,\nseg_2.ts\n#EXT-X-ENDLIST';
    expect(playlistDurationMs(playlist)).toBe(10500);
  });
});

describe('Deepgram adapter', () => {
  it('maps utterances to start/end/text', () => {
    const body = { results: { utterances: [{ start: 1.2, end: 2.5, transcript: 'Hello there' }] } };
    expect(mapDeepgramUtterances(body)).toEqual([{ start: 1.2, end: 2.5, text: 'Hello there' }]);
  });

  it('returns no lines for silence', () => {
    expect(mapDeepgramUtterances({ results: {} })).toEqual([]);
  });

  it('classifies HTTP errors: bad key is permanent, rate limit and 5xx are retried', () => {
    expect(ProviderError.fromHttpStatus('Deepgram', 401, '').retryable).toBe(false);
    expect(ProviderError.fromHttpStatus('Deepgram', 401, '').code).toBe('PROVIDER_AUTH_FAILED');
    expect(ProviderError.fromHttpStatus('Deepgram', 400, 'bad audio').retryable).toBe(false);
    expect(ProviderError.fromHttpStatus('Deepgram', 429, '').retryable).toBe(true);
    expect(ProviderError.fromHttpStatus('Deepgram', 503, '').retryable).toBe(true);
  });
});

describe('Claude adapter', () => {
  it('formats the transcript with timestamps, names and roles', () => {
    expect(
      formatTranscript([
        { speakerName: 'Alice', role: 'CLIENT', startMs: 65_000, endMs: 66_000, text: 'It is broken' },
        { speakerName: 'Sam', role: 'CONSULTANT', startMs: 70_000, endMs: 71_000, text: 'Let me look' },
      ]),
    ).toBe('[01:05] Alice (client): It is broken\n[01:10] Sam (consultant): Let me look');
  });

  it('accepts a valid summary and rejects one with an invented outcome value', () => {
    const ok = { overview: 'Fixed export.', issuesDiscussed: ['export'], resolution: 'Cleared cache', actionItems: [], outcome: 'RESOLVED' };
    expect(summarySchema.safeParse(ok).success).toBe(true);
    expect(summarySchema.safeParse({ ...ok, outcome: 'MAYBE' }).success).toBe(false);
  });

  it('maps SDK errors: auth is permanent, rate limit is retried', () => {
    const headers = new Headers();
    const auth = new Anthropic.AuthenticationError(401, { error: {} }, 'invalid x-api-key', headers);
    const rate = new Anthropic.RateLimitError(429, { error: {} }, 'rate limited', headers);
    expect(toProviderError(auth)).toMatchObject({ retryable: false, code: 'PROVIDER_AUTH_FAILED' });
    expect(toProviderError(rate)).toMatchObject({ retryable: true });
  });
});
