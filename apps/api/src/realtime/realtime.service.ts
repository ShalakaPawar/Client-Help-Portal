import { Injectable } from '@nestjs/common';
import type { ServerToClientEvents } from '@chp/shared';
import { RealtimeGateway, userRoom } from './realtime.gateway';

/** Push a typed notification to one or more users (call only after the DB commit). */
@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  emitTo<E extends keyof ServerToClientEvents>(
    userIds: string | string[],
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ) {
    const server = this.gateway.server;
    if (!server) return; // not initialised (e.g. some unit tests)
    const rooms = (Array.isArray(userIds) ? userIds : [userIds]).map(userRoom);
    server.to(rooms).emit(event, ...args);
  }
}
