import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  PROCESSING_QUEUE,
  ProcessingJob,
  ProcessRecordingData,
  processingJobId,
  TIMERS_QUEUE,
  TimerData,
  TimerJob,
  timerJobId,
} from './queues';

/**
 * Adds jobs. Always called AFTER the related database change is committed.
 * Fixed job ids make adding the same job twice harmless.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(PROCESSING_QUEUE) private readonly processing: Queue<ProcessRecordingData>,
    @InjectQueue(TIMERS_QUEUE) private readonly timers: Queue<TimerData>,
  ) {}

  async enqueueProcessing(recordingId: string) {
    await this.processing.add(
      ProcessingJob.PROCESS_RECORDING,
      { recordingId },
      {
        jobId: processingJobId(recordingId),
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 200,
        removeOnFail: false,
      },
    );
  }

  /** Retry a failed processing job, or add it if it no longer exists. */
  async retryProcessing(recordingId: string) {
    const job = await this.processing.getJob(processingJobId(recordingId));
    if (job && (await job.isFailed())) {
      await job.retry();
      return;
    }
    if (job) await job.remove().catch(() => undefined);
    await this.enqueueProcessing(recordingId);
  }

  async schedule(name: TimerJob, id: string, delayMs: number) {
    const jobId = timerJobId(name, id);
    await this.cancel(name, id); // replace any earlier timer with the same id
    await this.timers.add(name, { id }, { jobId, delay: delayMs, removeOnComplete: true, removeOnFail: 50 });
  }

  async cancel(name: TimerJob, id: string) {
    const job = await this.timers.getJob(timerJobId(name, id));
    if (job) await job.remove().catch((err) => this.logger.debug(`cancel ${job.id}: ${(err as Error).message}`));
  }

  /** Number of worker processes currently consuming the processing queue. */
  async processingWorkers(): Promise<number> {
    try {
      return (await this.processing.getWorkers()).length;
    } catch {
      return 0;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const client = (await this.processing.client) as unknown as { ping(): Promise<string> };
      return (await client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
