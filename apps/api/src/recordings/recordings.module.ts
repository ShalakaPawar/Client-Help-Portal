import { Module } from '@nestjs/common';
import { RecordingsService } from './recordings.service';
import { MediaService } from './media.service';
import { RecordingsController } from './recordings.controller';

@Module({
  controllers: [RecordingsController],
  providers: [RecordingsService, MediaService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
