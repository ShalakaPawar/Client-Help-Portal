import { Global, Module } from '@nestjs/common';
import { LiveKitService } from './livekit/livekit.service';
import { StorageService } from './storage/storage.service';

/** Shared infrastructure clients used across feature modules. */
@Global()
@Module({
  providers: [LiveKitService, StorageService],
  exports: [LiveKitService, StorageService],
})
export class InfraModule {}
