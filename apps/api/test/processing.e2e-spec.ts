/**
 * Processing job (transcribe + summarize) against the real test database,
 * with the speech-to-text and summary providers replaced by test doubles.
 * The FINALIZE (ffmpeg) step is skipped by starting from an AVAILABLE recording.
 */
import { Job, UnrecoverableError } from 'bullmq';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { ProcessingProcessor } from '../src/processing/processing.processor';
import { ProviderError } from '../src/processing/provider-errors';
import { loadConfig } from '../src/config/env';
import type { TranscriptionProvider } from '../src/processing/deepgram.adapter';
import type { SummaryProvider } from '../src/processing/claude.adapter';
import { resetDatabase } from './helpers';

describe('Processing job', () => {
  const config = loadConfig();
  const prisma = new PrismaService();
  const storage = new StorageService(config);
  const realtime = { emitTo: jest.fn() };
  const queue = { enqueueProcessing: jest.fn(), schedule: jest.fn() };
  const stt: jest.Mocked<TranscriptionProvider> = { transcribe: jest.fn() };
  const llm: jest.Mocked<SummaryProvider> = { summarize: jest.fn() };
  const processor = new ProcessingProcessor(prisma, storage, realtime as never, queue as never, stt, llm, config);
  const job = (recordingId: string) => ({ data: { recordingId }, attemptsMade: 3, opts: { attempts: 3 } }) as unknown as Job<{ recordingId: string }>;
  let ids: Record<string, string>;

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());
  beforeEach(async () => {
    ids = await resetDatabase(prisma);
    jest.resetAllMocks();
  });

  /** A finished call whose video is ready and whose two voice files exist on disk. */
  async function recordedCall() {
    const request = await prisma.helpRequest.create({
      data: { clientId: ids['client1@demo.com'], consultantId: ids['consultant@demo.com'], title: 'Export broken', description: 'x' },
    });
    const t0 = new Date('2026-01-01T10:00:00Z');
    const call = await prisma.call.create({
      data: {
        requestId: request.id,
        roomName: `call-${request.id}`,
        clientId: ids['client1@demo.com'],
        consultantId: ids['consultant@demo.com'],
        status: 'ENDED',
        consent: 'GRANTED',
        recording: { create: { status: 'AVAILABLE', compositeStartedAt: t0 } },
      },
      include: { recording: true },
    });
    const rec = call.recording!;
    const voices = [
      { role: 'CLIENT' as const, startedAt: new Date(t0.getTime() + 1000) },
      { role: 'CONSULTANT' as const, startedAt: new Date(t0.getTime() + 3000) },
    ];
    for (const v of voices) {
      const filePath = storage.voiceFile(rec.id, v.role, 1);
      mkdirSync(dirname(join(config.recordingsDirAbs, filePath)), { recursive: true });
      writeFileSync(join(config.recordingsDirAbs, filePath), Buffer.from(`fake-ogg-${v.role}`));
      await prisma.recordingEgress.create({
        data: { recordingId: rec.id, kind: 'VOICE', role: v.role, trackSid: `TR_${v.role}`, egressId: `EG_${v.role}_${rec.id}`, status: 'ENDED', startedAt: v.startedAt, filePath },
      });
    }
    return rec.id;
  }

  it('builds a speaker-labelled transcript on the video timeline, then a summary', async () => {
    const recordingId = await recordedCall();
    stt.transcribe.mockImplementation(async (audio) =>
      audio.toString().includes('CLIENT')
        ? [{ start: 0.5, end: 2, text: 'My export button does nothing' }]
        : [{ start: 0.2, end: 1, text: 'Try clearing the cache' }],
    );
    llm.summarize.mockResolvedValue({
      overview: 'Alice could not export; Sam suggested clearing the cache.',
      issuesDiscussed: ['Export button'],
      resolution: '',
      actionItems: [{ owner: 'CLIENT', task: 'Clear the cache' }],
      outcome: 'UNCLEAR',
      model: 'claude-test',
    });

    await processor.process(job(recordingId));

    const transcript = await prisma.transcript.findUniqueOrThrow({ where: { recordingId } });
    expect(transcript.segments).toEqual([
      { speakerName: 'Alice Client', role: 'CLIENT', startMs: 1500, endMs: 3000, text: 'My export button does nothing' },
      { speakerName: 'Sam Consultant', role: 'CONSULTANT', startMs: 3200, endMs: 4000, text: 'Try clearing the cache' },
    ]);
    const summary = await prisma.summary.findUniqueOrThrow({ where: { recordingId } });
    expect(summary.resolution).toBeNull(); // empty string from the model -> no resolution
    expect(summary.model).toBe('claude-test');
    expect(llm.summarize).toHaveBeenCalledWith(expect.any(Array), 'Export broken');
    expect((await prisma.recording.findUniqueOrThrow({ where: { id: recordingId } })).processingStatus).toBe('DONE');
  });

  it('a missing API key fails immediately (no retries) with a clear message', async () => {
    const recordingId = await recordedCall();
    stt.transcribe.mockRejectedValue(ProviderError.notConfigured('Deepgram', 'DEEPGRAM_API_KEY'));
    await expect(processor.process(job(recordingId))).rejects.toBeInstanceOf(UnrecoverableError);
    await processor.onFailed(job(recordingId), new UnrecoverableError('Deepgram is not configured: add DEEPGRAM_API_KEY'));
    const rec = await prisma.recording.findUniqueOrThrow({ where: { id: recordingId } });
    expect(rec.processingStatus).toBe('FAILED');
    expect(rec.lastError).toContain('DEEPGRAM_API_KEY');
  });

  it('a temporary provider error is retried (not unrecoverable)', async () => {
    const recordingId = await recordedCall();
    stt.transcribe.mockRejectedValue(new ProviderError('Deepgram error 503', true));
    await expect(processor.process(job(recordingId))).rejects.not.toBeInstanceOf(UnrecoverableError);
  });

  it('if the summary fails, the transcript is kept and a retry only redoes the summary', async () => {
    const recordingId = await recordedCall();
    stt.transcribe.mockResolvedValue([{ start: 0, end: 1, text: 'hello' }]);
    llm.summarize.mockRejectedValueOnce(new ProviderError('Claude declined to summarise this call', false));
    await expect(processor.process(job(recordingId))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await prisma.transcript.findUnique({ where: { recordingId } })).not.toBeNull();

    llm.summarize.mockResolvedValue({ overview: 'ok', issuesDiscussed: [], resolution: 'done', actionItems: [], outcome: 'RESOLVED', model: 'm' });
    stt.transcribe.mockClear();
    await processor.process(job(recordingId));
    expect(stt.transcribe).not.toHaveBeenCalled(); // checkpoint: transcript reused
    expect(await prisma.summary.findUnique({ where: { recordingId } })).not.toBeNull();
  });

  it('finalize: a broken video stops processing with FAILED and a readable error (Retry possible)', async () => {
    const recordingId = await recordedCall();
    await prisma.recording.update({ where: { id: recordingId }, data: { status: 'FINALIZING' } });
    const playlist = join(config.recordingsDirAbs, storage.playlist(recordingId));
    mkdirSync(dirname(playlist), { recursive: true });
    writeFileSync(playlist, '#EXTM3U\n#EXTINF:4.0,\nmissing-segment.ts\n#EXT-X-ENDLIST\n');

    await expect(processor.process(job(recordingId))).rejects.toBeInstanceOf(UnrecoverableError);
    const rec = await prisma.recording.findUniqueOrThrow({ where: { id: recordingId } });
    expect(rec.status).toBe('FAILED');
    expect(rec.lastError).toMatch(/ffmpeg/);
    expect(stt.transcribe).not.toHaveBeenCalled();
  });

  it('finalize: if the video is missing entirely, the transcript is still made from the voice files', async () => {
    const recordingId = await recordedCall();
    await prisma.recording.update({ where: { id: recordingId }, data: { status: 'FINALIZING' } });
    stt.transcribe.mockResolvedValue([{ start: 0, end: 1, text: 'hello' }]);
    llm.summarize.mockResolvedValue({ overview: 'ok', issuesDiscussed: [], resolution: '', actionItems: [], outcome: 'UNCLEAR', model: 'm' });

    await processor.process(job(recordingId));
    const rec = await prisma.recording.findUniqueOrThrow({ where: { id: recordingId } });
    expect(rec).toMatchObject({ status: 'FAILED', partial: true, lastError: 'The video recording is missing', processingStatus: 'DONE' });
    expect(await prisma.transcript.findUnique({ where: { recordingId } })).not.toBeNull();
  });

  it('silence: no Claude call, an honest "no speech" summary', async () => {
    const recordingId = await recordedCall();
    stt.transcribe.mockResolvedValue([]);
    await processor.process(job(recordingId));
    expect(llm.summarize).not.toHaveBeenCalled();
    expect((await prisma.summary.findUniqueOrThrow({ where: { recordingId } })).outcome).toBe('UNCLEAR');
  });
});
