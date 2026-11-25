import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PROCESSING_QUEUE, TIMERS_QUEUE } from './queues';

/** Dev-only dashboard to watch jobs: http://localhost:4610/api/admin/queues */
export function setupQueueBoard(app: INestApplication) {
  const adapter = new ExpressAdapter();
  adapter.setBasePath('/api/admin/queues');
  createBullBoard({
    queues: [PROCESSING_QUEUE, TIMERS_QUEUE].map((name) => new BullMQAdapter(app.get<Queue>(getQueueToken(name)))),
    serverAdapter: adapter,
  });
  app.use('/api/admin/queues', adapter.getRouter());
}
