/**
 * Process isolation: the API process never processes recordings; the worker process does,
 * has no HTTP/WebSocket server, and still reaches users' browsers through Redis.
 */
import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { io, Socket } from 'socket.io-client';
import { ProcessingProcessor } from '../src/processing/processing.processor';
import { RealtimeService, RedisRealtimeService } from '../src/realtime/realtime.service';
import { WorkerModule } from '../src/worker.module';
import { createTestApp, loginAs, resetDatabase } from './helpers';

describe('Process isolation (API vs worker)', () => {
  let api: INestApplication;
  let worker: INestApplicationContext;
  let url: string;

  beforeAll(async () => {
    const t = await createTestApp();
    api = t.app;
    await resetDatabase(t.prisma);
    await api.listen(0);
    url = await api.getUrl();
    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  });

  afterAll(async () => {
    await worker?.close();
    await api?.close();
  });

  it('the API process does not run the recording processor', () => {
    expect(() => api.get(ProcessingProcessor)).toThrow();
  });

  it('the worker process runs the processor and has no HTTP server', () => {
    expect(worker.get(ProcessingProcessor)).toBeInstanceOf(ProcessingProcessor);
    expect((worker as unknown as { getHttpServer?: unknown }).getHttpServer).toBeUndefined();
    expect(worker.get(RealtimeService)).toBeInstanceOf(RedisRealtimeService);
  });

  it("a worker notification reaches only the intended user's browser, via Redis", async () => {
    const [alice, bob] = await Promise.all([connect('client1@demo.com'), connect('client2@demo.com')]);
    const me = (await (await fetch(`${url}/api/auth/me`, { headers: { Authorization: `Bearer ${alice.token}` } })).json()) as { id: string };
    const aliceId = me.id;
    const bobGot: unknown[] = [];
    bob.socket.on('processing:updated', (p) => bobGot.push(p));

    const received = new Promise((resolve) => alice.socket.once('processing:updated', resolve));
    worker.get(RealtimeService).emitTo(aliceId, 'processing:updated', {
      callId: 'c1',
      recordingId: 'r1',
      processingStatus: 'DONE',
      lastError: null,
    });

    await expect(received).resolves.toMatchObject({ recordingId: 'r1', processingStatus: 'DONE' });
    await new Promise((r) => setTimeout(r, 300));
    expect(bobGot).toEqual([]); // other users never see it
    alice.socket.close();
    bob.socket.close();
  });

  async function connect(email: string): Promise<{ token: string; socket: Socket }> {
    const token = await loginAs(api, email);
    const socket = io(url, { path: '/socket.io', transports: ['websocket'], auth: { token } });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return { token, socket };
  }
});
