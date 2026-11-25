import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { Prisma } from '@prisma/client';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { ProcessingStatus, RecordingStatus, Role, SocketEvent, TranscriptSegmentDto } from '@chp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { RealtimeService } from '../realtime/realtime.service';
import { QueueService } from '../queue/queue.service';
import { PROCESSING_QUEUE, ProcessRecordingData, TimerJob } from '../queue/queues';
import { APP_CONFIG, AppConfig } from '../config/env';
import { ffmpegBinary, hlsToMp4Args, playlistDurationMs, runFfmpeg } from './ffmpeg';
import { mergeTranscript, VoicePiece } from './transcript-merge';
import { TRANSCRIPTION_PROVIDER, TranscriptionProvider } from './deepgram.adapter';
import { SUMMARY_PROVIDER, SummaryProvider } from './claude.adapter';
import { ProviderError } from './provider-errors';

const TRANSCRIBE_CONCURRENCY = 2;

/**
 * One job per recording, in checkpointed steps (a retry skips finished steps):
 *   FINALIZE    HLS segments -> composite.mp4 (video playable from here on)
 *   TRANSCRIBE  each voice file -> Deepgram -> merged, speaker-labelled transcript
 *   SUMMARIZE   transcript -> Claude -> structured summary
 * Playback never depends on AI success; a failed summary keeps the transcript.
 */
@Processor(PROCESSING_QUEUE, { concurrency: 2 })
export class ProcessingProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProcessingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly queue: QueueService,
    @Inject(TRANSCRIPTION_PROVIDER) private readonly stt: TranscriptionProvider,
    @Inject(SUMMARY_PROVIDER) private readonly llm: SummaryProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  /** Startup check: re-add work that was interrupted (e.g. the server stopped mid-job). */
  async onApplicationBootstrap() {
    if (this.config.NODE_ENV === 'test') return;
    const stuck = await this.prisma.recording.findMany({
      where: {
        OR: [
          { status: RecordingStatus.FINALIZING },
          { status: RecordingStatus.AVAILABLE, processingStatus: { in: ['PENDING', 'TRANSCRIBING', 'SUMMARIZING'] } },
        ],
      },
      select: { id: true },
    });
    for (const r of stuck) await this.queue.enqueueProcessing(r.id);
    const stopping = await this.prisma.recording.findMany({ where: { status: RecordingStatus.STOPPING }, select: { id: true } });
    for (const r of stopping) await this.queue.schedule(TimerJob.EGRESS_CHECK, r.id, 5_000);
    if (stuck.length + stopping.length) this.logger.log(`re-queued ${stuck.length} processing and ${stopping.length} stop checks`);
  }

  async process(job: Job<ProcessRecordingData>) {
    const { recordingId } = job.data;
    try {
      await this.finalize(recordingId);
      const transcript = await this.transcribe(recordingId);
      await this.summarize(recordingId, transcript);
      await this.setProcessing(recordingId, ProcessingStatus.DONE, null);
    } catch (err) {
      // Permanent errors stop retries immediately; others are retried by BullMQ with backoff.
      if (err instanceof ProviderError && !err.retryable) throw new UnrecoverableError(err.message);
      throw err;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProcessRecordingData> | undefined, err: Error) {
    if (!job) return;
    const finalAttempt = err instanceof UnrecoverableError || err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.warn(`processing ${job.data.recordingId} failed (attempt ${job.attemptsMade}): ${err.message}`);
    if (finalAttempt) await this.setProcessing(job.data.recordingId, ProcessingStatus.FAILED, err.message);
  }

  // ---- steps ----

  private async finalize(recordingId: string) {
    const rec = await this.prisma.recording.findUniqueOrThrow({ where: { id: recordingId }, include: { egresses: true } });
    if (rec.status !== RecordingStatus.FINALIZING) return; // already done (checkpoint)

    const playlistRel = this.storage.playlist(recordingId);
    if (!(await this.storage.exists(playlistRel))) {
      // No video at all; voices may still produce a transcript.
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: { status: RecordingStatus.FAILED, partial: true, lastError: 'The video recording is missing' },
      });
      await this.emitCallUpdate(recordingId);
      return;
    }

    const outRel = this.storage.finalVideo(recordingId);
    await mkdir(dirname(this.storage.abs(outRel)), { recursive: true });
    try {
      await runFfmpeg(ffmpegBinary(this.config.FFMPEG_PATH), hlsToMp4Args(this.storage.abs(playlistRel), this.storage.abs(outRel)));
    } catch (err) {
      await this.prisma.recording.update({
        where: { id: recordingId },
        data: { status: RecordingStatus.FAILED, lastError: (err as Error).message },
      });
      await this.emitCallUpdate(recordingId);
      throw new UnrecoverableError((err as Error).message);
    }

    const durationMs = playlistDurationMs(await readFile(this.storage.abs(playlistRel), 'utf8'));
    await this.prisma.recording.update({ where: { id: recordingId }, data: { status: RecordingStatus.AVAILABLE, durationMs } });
    // The MP4 now holds everything; the raw segments are no longer needed.
    await rm(this.storage.abs(this.storage.compositeDir(recordingId)), { recursive: true, force: true });
    await this.emitCallUpdate(recordingId);
    this.logger.log(`recording ${recordingId} finalized (${Math.round(durationMs / 1000)}s)`);
  }

  private async transcribe(recordingId: string): Promise<TranscriptSegmentDto[]> {
    const existing = await this.prisma.transcript.findUnique({ where: { recordingId } });
    if (existing) return existing.segments as unknown as TranscriptSegmentDto[]; // checkpoint

    await this.setProcessing(recordingId, ProcessingStatus.TRANSCRIBING, null);
    const rec = await this.prisma.recording.findUniqueOrThrow({
      where: { id: recordingId },
      include: { egresses: true, call: { include: { client: true, consultant: true } } },
    });
    const voices = rec.egresses.filter((e) => e.kind === 'VOICE' && e.role);
    const composite = rec.egresses.find((e) => e.kind === 'COMPOSITE');
    const timeZero = rec.compositeStartedAt ?? composite?.startedAt ?? earliest(voices.map((v) => v.startedAt));

    const usable = [];
    for (const v of voices) if (await this.storage.exists(v.filePath)) usable.push(v);
    if (usable.length < voices.length) await this.prisma.recording.update({ where: { id: recordingId }, data: { partial: true } });

    const pieces: VoicePiece[] = [];
    for (let i = 0; i < usable.length; i += TRANSCRIBE_CONCURRENCY) {
      const batch = usable.slice(i, i + TRANSCRIBE_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (v) => {
          const audio = await this.storage.readFile(v.filePath);
          const utterances = await this.stt.transcribe(audio, 'audio/ogg');
          const role = v.role as Role;
          const speaker = role === Role.CLIENT ? rec.call.client : rec.call.consultant;
          const offsetMs = v.startedAt && timeZero ? v.startedAt.getTime() - timeZero.getTime() : 0;
          return { role, speakerName: speaker.name, offsetMs, utterances } satisfies VoicePiece;
        }),
      );
      pieces.push(...results);
    }

    const segments = mergeTranscript(pieces);
    await this.prisma.transcript.create({
      data: { recordingId, segments: segments as unknown as Prisma.InputJsonValue },
    });
    return segments;
  }

  private async summarize(recordingId: string, segments: TranscriptSegmentDto[]) {
    if (await this.prisma.summary.findUnique({ where: { recordingId } })) return; // checkpoint
    await this.setProcessing(recordingId, ProcessingStatus.SUMMARIZING, null);

    if (segments.length === 0) {
      // Nothing was said: no need to call Claude.
      await this.prisma.summary.create({
        data: {
          recordingId,
          overview: 'No speech was detected in this call, so there is nothing to summarise.',
          issuesDiscussed: [],
          resolution: null,
          actionItems: [],
          outcome: 'UNCLEAR',
          model: 'none',
        },
      });
      return;
    }

    const rec = await this.prisma.recording.findUniqueOrThrow({
      where: { id: recordingId },
      include: { call: { include: { request: true } } },
    });
    const result = await this.llm.summarize(segments, rec.call.request.title);
    await this.prisma.summary.create({
      data: {
        recordingId,
        overview: result.overview,
        issuesDiscussed: result.issuesDiscussed,
        resolution: result.resolution.trim() || null,
        actionItems: result.actionItems,
        outcome: result.outcome,
        model: result.model,
      },
    });
  }

  // ---- helpers ----

  private async setProcessing(recordingId: string, status: ProcessingStatus, lastError: string | null) {
    const rec = await this.prisma.recording.update({
      where: { id: recordingId },
      // Errors are only cleared by an explicit Retry, so a finished job keeps e.g. "video missing".
      data: { processingStatus: status, ...(lastError !== null ? { lastError } : {}) },
      include: { call: true },
    });
    this.realtime.emitTo([rec.call.clientId, rec.call.consultantId], SocketEvent.PROCESSING_UPDATED, {
      callId: rec.callId,
      recordingId,
      processingStatus: status,
      lastError: rec.lastError,
    });
  }

  private async emitCallUpdate(recordingId: string) {
    const rec = await this.prisma.recording.findUniqueOrThrow({ where: { id: recordingId }, include: { call: true } });
    this.realtime.emitTo([rec.call.clientId, rec.call.consultantId], SocketEvent.RECORDING_STATUS, {
      callId: rec.callId,
      recordingId,
      status: rec.status,
    });
  }
}

function earliest(dates: (Date | null)[]): Date | null {
  const valid = dates.filter((d): d is Date => !!d);
  return valid.length ? new Date(Math.min(...valid.map((d) => d.getTime()))) : null;
}
