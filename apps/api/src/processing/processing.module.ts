import { Module } from '@nestjs/common';
import { ProcessingProcessor } from './processing.processor';
import { DeepgramAdapter, TRANSCRIPTION_PROVIDER } from './deepgram.adapter';
import { ClaudeAdapter, SUMMARY_PROVIDER } from './claude.adapter';

@Module({
  providers: [
    ProcessingProcessor,
    { provide: TRANSCRIPTION_PROVIDER, useClass: DeepgramAdapter },
    { provide: SUMMARY_PROVIDER, useClass: ClaudeAdapter },
  ],
})
export class ProcessingModule {}
