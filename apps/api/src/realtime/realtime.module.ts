import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { GatewayRealtimeService, RealtimeService, RedisRealtimeService } from './realtime.service';

/** API process: owns the WebSocket server. */
@Global()
@Module({
  providers: [RealtimeGateway, { provide: RealtimeService, useClass: GatewayRealtimeService }],
  exports: [RealtimeService],
})
export class RealtimeModule {}

/** Worker process: no sockets; publishes notifications through Redis to the API. */
@Global()
@Module({
  providers: [{ provide: RealtimeService, useClass: RedisRealtimeService }],
  exports: [RealtimeService],
})
export class RealtimePublisherModule {}
