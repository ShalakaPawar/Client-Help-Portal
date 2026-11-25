import { Global, Module } from '@nestjs/common';
import { LiveKitService } from './livekit/livekit.service';
import { StorageModule } from './storage/storage.module';

/** Shared infrastructure clients for the API process. */
@Global()
@Module({
  imports: [StorageModule],
  providers: [LiveKitService],
  exports: [LiveKitService, StorageModule],
})
export class InfraModule {}
