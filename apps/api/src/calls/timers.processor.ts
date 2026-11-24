import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { TIMERS_QUEUE, TimerData, TimerJob } from '../queue/queues';
import { CallsService } from './calls.service';
import { RecordingsService } from '../recordings/recordings.service';

/** Delayed jobs that replace in-memory timers, so they survive restarts. */
@Processor(TIMERS_QUEUE)
export class TimersProcessor extends WorkerHost {
  private readonly logger = new Logger(TimersProcessor.name);

  constructor(
    private readonly calls: CallsService,
    private readonly recordings: RecordingsService,
  ) {
    super();
  }

  async process(job: Job<TimerData>) {
    this.logger.log(`timer ${job.name} for ${job.data.id}`);
    switch (job.name) {
      case TimerJob.RING_TIMEOUT:
        return this.calls.markMissed(job.data.id);
      case TimerJob.AUTO_END_CHECK:
        return this.calls.autoEndIfEmpty(job.data.id);
      case TimerJob.CALL_CAP:
        return this.calls.endCall(job.data.id, 'time-cap');
      case TimerJob.EGRESS_CHECK:
        return this.recordings.checkEgress(job.data.id);
      default:
        this.logger.warn(`unknown timer job ${job.name}`);
    }
  }
}
