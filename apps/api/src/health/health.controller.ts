import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { LiveKitService } from '../livekit/livekit.service';
import { StorageService } from '../storage/storage.service';
import { QueueService } from '../queue/queue.service';
import { APP_CONFIG, AppConfig } from '../config/env';

/** One place to see if everything the app depends on is up. */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LiveKitService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  async check() {
    const database = await this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const [redis, livekit, recordingsFolder] = await Promise.all([this.queue.ping(), this.livekit.ping(), this.storage.isWritable()]);
    const checks = {
      database,
      redis,
      livekit,
      recordingsFolder,
      deepgramKey: !!this.config.DEEPGRAM_API_KEY,
      anthropicKey: !!this.config.ANTHROPIC_API_KEY,
    };
    const ok = database && redis && livekit && recordingsFolder;
    const body = { status: ok ? 'ok' : 'degraded', checks };
    if (!ok) throw new ServiceUnavailableException(body);
    return body;
  }
}
