import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { TimersProcessor } from './timers.processor';
import { RequestsModule } from '../requests/requests.module';
import { RecordingsModule } from '../recordings/recordings.module';
import { WebhookController } from '../livekit/webhook.controller';
import { WebhookService } from '../livekit/webhook.service';

@Module({
  imports: [RequestsModule, RecordingsModule],
  controllers: [CallsController, WebhookController],
  providers: [CallsService, TimersProcessor, WebhookService],
  exports: [CallsService],
})
export class CallsModule {}
