import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import Redis from 'ioredis';
import type { ServerToClientEvents } from '@chp/shared';
import { APP_CONFIG, AppConfig } from '../config/env';
import { RealtimeGateway, userRoom } from './realtime.gateway';
import { socketIoRedisKey } from './redis-key';

/**
 * Push a typed notification to one or more users (always after the DB commit).
 * Two implementations behind one API:
 *  - in the API process: straight to the WebSocket server
 *  - in the worker process: through Redis to whichever API process holds the sockets
 */
export abstract class RealtimeService {
  abstract emitTo<E extends keyof ServerToClientEvents>(
    userIds: string | string[],
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void;
}

const rooms = (userIds: string | string[]) => (Array.isArray(userIds) ? userIds : [userIds]).map(userRoom);

@Injectable()
export class GatewayRealtimeService extends RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {
    super();
  }

  emitTo<E extends keyof ServerToClientEvents>(userIds: string | string[], event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    const server = this.gateway.server;
    if (!server) return; // not initialised (e.g. some unit tests)
    server.to(rooms(userIds)).emit(event, ...args);
  }
}

/** Worker side: has no sockets of its own, so it publishes via Redis (Socket.IO Redis emitter). */
@Injectable()
export class RedisRealtimeService extends RealtimeService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly emitter: Emitter<ServerToClientEvents>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.redis = new Redis(config.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: null });
    this.emitter = new Emitter<ServerToClientEvents>(this.redis, { key: socketIoRedisKey(config) });
  }

  emitTo<E extends keyof ServerToClientEvents>(userIds: string | string[], event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    // The emitter's typing is stricter than our generic helper; the payload type is checked above.
    (this.emitter.to(rooms(userIds)) as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit(event, ...args);
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
