import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { RealtimePublisherModule } from './realtime/realtime.module';
import { ProcessingModule } from './processing/processing.module';
import { loggerParams } from './logging';

/**
 * The worker process: runs ONLY the processing queue (ffmpeg finalize, Deepgram, Claude).
 * It has no HTTP server and no WebSocket server, so a slow, failing or crashing job
 * can never block users raising requests or joining calls (those live in the API process).
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot(loggerParams('worker')),
    PrismaModule,
    StorageModule,
    QueueModule,
    RealtimePublisherModule,
    ProcessingModule,
  ],
})
export class WorkerModule {}
