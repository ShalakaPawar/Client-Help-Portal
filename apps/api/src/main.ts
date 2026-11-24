import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { raw } from 'express';
import { AppModule } from './app.module';
import { loadConfig } from './config/env';
import { setupQueueBoard } from './queue/queue-board';

async function bootstrap() {
  const config = loadConfig(); // fail fast with a readable message
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  // LiveKit webhook signatures cover the exact bytes, so keep that body raw.
  app.use('/api/livekit/webhook', raw({ type: ['application/webhook+json', 'application/json'] }));
  app.enableShutdownHooks();
  if (config.NODE_ENV !== 'production') setupQueueBoard(app);

  await app.listen(config.PORT);
  app.get(Logger).log(`API listening on http://localhost:${config.PORT}/api`);
}

bootstrap().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
