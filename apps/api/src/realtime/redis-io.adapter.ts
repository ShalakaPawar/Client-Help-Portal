import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { AppConfig } from '../config/env';
import { socketIoRedisKey } from './redis-key';

/**
 * Socket.IO with the Redis adapter, so notifications published by the separate worker
 * process (or other API replicas) reach the sockets held by this process.
 * Owns its Redis clients and closes them AFTER the socket server, in the right order.
 */
export class RedisIoAdapter extends IoAdapter {
  private pub?: Redis;
  private sub?: Redis;

  constructor(
    app: INestApplicationContext,
    private readonly config: Pick<AppConfig, 'REDIS_URL' | 'NODE_ENV'>,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, options);
    this.pub = new Redis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
    this.sub = this.pub.duplicate();
    server.adapter(createAdapter(this.pub, this.sub, { key: socketIoRedisKey(this.config) }));
    return server;
  }

  async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all([this.pub?.quit(), this.sub?.quit()].map((p) => p?.catch(() => undefined)));
  }
}
