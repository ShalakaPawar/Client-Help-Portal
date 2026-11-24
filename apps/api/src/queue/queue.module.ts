import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PROCESSING_QUEUE, TIMERS_QUEUE } from './queues';
import { QueueService } from './queue.service';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        connection: { url: config.REDIS_URL },
        prefix: config.NODE_ENV === 'test' ? 'chp-test' : 'chp',
      }),
    }),
    BullModule.registerQueue({ name: PROCESSING_QUEUE }, { name: TIMERS_QUEUE }),
  ],
  providers: [QueueService],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
