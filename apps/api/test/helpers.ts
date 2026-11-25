import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { raw } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { LiveKitService } from '../src/livekit/livekit.service';
import { seed, DEMO_PASSWORD } from '../prisma/seed';
import { RedisIoAdapter } from '../src/realtime/redis-io.adapter';
import { loadConfig } from '../src/config/env';
import type { EgressSnapshot, ParticipantSnapshot } from '../src/livekit/livekit.types';

/** LiveKit test double: records calls, never touches the network. */
export function createLiveKitMock() {
  let n = 0;
  const snapshot = (egressId: string): EgressSnapshot => ({ egressId, state: 'starting', mediaStartedAt: null, startedAt: null, endedAt: null, error: null });
  return {
    publicUrl: 'ws://livekit.test',
    participants: [] as ParticipantSnapshot[],
    createRoom: jest.fn(async () => undefined),
    deleteRoom: jest.fn(async () => undefined),
    createToken: jest.fn(async (req: { identity: string; room: string; role: string }) => `lk-token:${req.identity}:${req.room}`),
    listParticipants: jest.fn(async function (this: { participants: ParticipantSnapshot[] }) {
      return this.participants;
    }),
    startCompositeEgress: jest.fn(async () => snapshot(`EG_comp_${++n}`)),
    startTrackEgress: jest.fn(async () => snapshot(`EG_voice_${++n}`)),
    stopEgress: jest.fn(async () => undefined),
    getEgress: jest.fn(async (_egressId: string): Promise<EgressSnapshot | null> => null),
    receiveWebhook: jest.fn(async () => {
      throw new Error('invalid signature');
    }),
    ping: jest.fn(async () => true),
  };
}
export type LiveKitMock = ReturnType<typeof createLiveKitMock>;

/** Boots the real AppModule (real DB, real guards) with LiveKit replaced by the mock. */
export async function createTestApp(livekit: LiveKitMock = createLiveKitMock()) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LiveKitService)
    .useValue(livekit)
    .compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  app.useWebSocketAdapter(new RedisIoAdapter(app, loadConfig()));
  app.setGlobalPrefix('api');
  app.use('/api/livekit/webhook', raw({ type: ['application/webhook+json', 'application/json'] }));
  await app.init();
  return { app, prisma: app.get(PrismaService), livekit };
}

/** Empty every table and seed the demo users. Returns their ids by email. */
export async function resetDatabase(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Summary", "Transcript", "RecordingEgress", "Recording", "Call", "HelpRequest", "WebhookEvent", "User" CASCADE',
  );
  return seed(prisma);
}

export async function loginAs(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: DEMO_PASSWORD }).expect(200);
  return res.body.accessToken;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
