import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { ProviderError } from './provider-errors';
import type { Utterance } from './transcript-merge';

export interface TranscriptionProvider {
  transcribe(audio: Buffer, mimeType: string): Promise<Utterance[]>;
}

export const TRANSCRIPTION_PROVIDER = Symbol('TRANSCRIPTION_PROVIDER');

interface DeepgramResponse {
  results?: { utterances?: { start: number; end: number; transcript: string }[] };
}

/**
 * Deepgram prerecorded API (nova-3). Each voice file holds one speaker, so we ask
 * for utterances (sentence-level timestamps) and do not need diarization.
 */
@Injectable()
export class DeepgramAdapter implements TranscriptionProvider {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async transcribe(audio: Buffer, mimeType: string): Promise<Utterance[]> {
    const key = this.config.DEEPGRAM_API_KEY;
    if (!key) throw ProviderError.notConfigured('Deepgram', 'DEEPGRAM_API_KEY');
    if (audio.length === 0) return [];

    const params = new URLSearchParams({
      model: 'nova-3',
      language: 'en',
      smart_format: 'true',
      punctuate: 'true',
      utterances: 'true',
    });

    let res: Response;
    try {
      res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
        method: 'POST',
        headers: { Authorization: `Token ${key}`, 'Content-Type': mimeType },
        body: new Uint8Array(audio),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      throw new ProviderError(`Deepgram request failed: ${(err as Error).message}`, true);
    }
    if (!res.ok) throw ProviderError.fromHttpStatus('Deepgram', res.status, await res.text().catch(() => ''));

    const body = (await res.json()) as DeepgramResponse;
    return mapDeepgramUtterances(body);
  }
}

export function mapDeepgramUtterances(body: DeepgramResponse): Utterance[] {
  return (body.results?.utterances ?? []).map((u) => ({ start: u.start, end: u.end, text: u.transcript }));
}
