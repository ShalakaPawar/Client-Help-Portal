import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';
import { loadConfig } from './config/env';

/** Entry point of the background worker process (no HTTP server). */
async function bootstrap() {
  loadConfig(); // fail fast with a readable message
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks(); // finish/stall the current job cleanly on Ctrl+C or SIGTERM
  app.get(Logger).log('Worker started: processing recordings (ffmpeg, Deepgram, Claude)');
}

bootstrap().catch((err) => {
  console.error(`\n✖ worker: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
