import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@chp/shared';
import { JwtPayload, userFromPayload } from '../common/guards';

export const userRoom = (userId: string) => `user:${userId}`;

/**
 * WebSocket (Socket.IO) channel for app notifications only.
 * The JWT is checked once during the handshake; each socket joins only its own `user:{id}` room,
 * so a user can never receive another user's events.
 * RedisIoAdapter (main.ts) lets the separate worker process (and future API replicas) emit to these rooms.
 * Browsers never send events: every change goes through REST.
 */
@WebSocketGateway({ path: '/socket.io', transports: ['websocket'], cors: { origin: true } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer()
  server: Server<ClientToServerEvents, ServerToClientEvents>;

  constructor(private readonly jwt: JwtService) {}

  afterInit(server: Server) {
    server.use(async (socket, next) => {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('UNAUTHENTICATED'));
      try {
        socket.data.user = userFromPayload(await this.jwt.verifyAsync<JwtPayload>(token));
        next();
      } catch {
        next(new Error('UNAUTHENTICATED'));
      }
    });
  }

  async handleConnection(socket: Socket) {
    const user = socket.data.user;
    await socket.join(userRoom(user.id));
    this.logger.debug(`socket connected for user ${user.id}`);
  }
}
