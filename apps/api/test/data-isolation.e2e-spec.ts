/**
 * Data isolation cross-check: client A (Bob) must not reach client B's (Alice's)
 *   help requests · active calls · LiveKit room tokens · recordings · transcripts/summaries · notifications.
 * (Requests, history, transcripts and summaries are also covered in access-control.e2e-spec.ts.)
 */
import { INestApplication } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { auth, createTestApp, LiveKitMock, loginAs, resetDatabase } from './helpers';

describe("Data isolation: Bob cannot reach Alice's data", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let livekit: LiveKitMock;
  let url: string;
  let t: Record<'alice' | 'bob' | 'consultant' | 'consultant2', string>;
  let ids: Record<string, string>;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma, livekit } = await createTestApp());
    await app.listen(0);
    url = await app.getUrl();
  });

  beforeEach(async () => {
    ids = await resetDatabase(prisma);
    t = {
      alice: await loginAs(app, 'client1@demo.com'),
      bob: await loginAs(app, 'client2@demo.com'),
      consultant: await loginAs(app, 'consultant@demo.com'),
      consultant2: await loginAs(app, 'consultant2@demo.com'),
    };
  });

  afterAll(async () => {
    await app.close();
  });

  async function aliceLiveCall() {
    const req = await http().post('/api/requests').set(auth(t.alice)).send({ title: 'Alice needs help', description: 'x' }).expect(201);
    const started = await http().post(`/api/requests/${req.body.id}/calls`).set(auth(t.consultant)).expect(201);
    return started.body.call.id as string;
  }

  describe('active calls and LiveKit room tokens', () => {
    it("Bob cannot join, get a token for, answer consent on, stop or end Alice's call", async () => {
      const callId = await aliceLiveCall();
      livekit.createToken.mockClear();
      for (const [method, path, body] of [
        ['post', `/api/calls/${callId}/join`, {}],
        ['get', `/api/calls/${callId}/livekit-token`, undefined],
        ['get', `/api/calls/${callId}`, undefined],
        ['post', `/api/calls/${callId}/consent`, { granted: true }],
        ['post', `/api/calls/${callId}/recording/stop`, {}],
        ['post', `/api/calls/${callId}/end`, {}],
      ] as const) {
        const res = await (method === 'get' ? http().get(path) : http().post(path).send(body)).set(auth(t.bob));
        expect({ path, status: res.status }).toEqual({ path, status: 404 });
      }
      // No LiveKit token was ever created for Bob, and the call is untouched.
      expect(livekit.createToken).not.toHaveBeenCalled();
      expect((await prisma.call.findUniqueOrThrow({ where: { id: callId } })).status).toBe('WAITING');
    });

    it("Bob's 'active call' lookup never returns Alice's call", async () => {
      await aliceLiveCall();
      const res = await http().get('/api/calls/active').set(auth(t.bob)).expect(200);
      expect(res.body.call).toBeNull();
      const alice = await http().get('/api/calls/active').set(auth(t.alice)).expect(200);
      expect(alice.body.call).not.toBeNull();
    });

    it("an unassigned consultant cannot get a token for Alice's call", async () => {
      const callId = await aliceLiveCall();
      await http().get(`/api/calls/${callId}/livekit-token`).set(auth(t.consultant2)).expect(404);
    });
  });

  describe('recordings', () => {
    it('a video link only ever serves the one recording it was issued for, and cannot be forged', async () => {
      const storage = app.get(StorageService);
      const [recA, recB] = await Promise.all([finishedRecording('A'), finishedRecording('B')]);
      for (const [rec, content] of [[recA, 'VIDEO-A'], [recB, 'VIDEO-B']] as const) {
        const file = storage.abs(storage.finalVideo(rec));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
      // Bob cannot get a link for Alice's recording at all.
      await http().get(`/api/recordings/${recA}/media-token`).set(auth(t.bob)).expect(404);

      const link = (await http().get(`/api/recordings/${recA}/media-token`).set(auth(t.alice)).expect(200)).body.url as string;
      const res = await http().get(link).buffer(true).parse((r, cb) => {
        let data = '';
        r.on('data', (c: Buffer) => (data += c.toString()));
        r.on('end', () => cb(null, data));
      });
      expect(res.status).toBe(200);
      expect(res.body).toBe('VIDEO-A'); // the token is bound to recording A; there is no way to ask for B

      const forged = link.slice(0, -4) + 'abcd';
      await http().get(forged).expect(401);
    });

    async function finishedRecording(tag: string) {
      const owner = tag === 'A' ? ids['client1@demo.com'] : ids['client2@demo.com'];
      const req = await prisma.helpRequest.create({
        data: { clientId: owner, consultantId: ids['consultant@demo.com'], title: `Req ${tag}`, description: 'x' },
      });
      const call = await prisma.call.create({
        data: {
          requestId: req.id,
          roomName: `call-${req.id}`,
          clientId: owner,
          consultantId: ids['consultant@demo.com'],
          status: 'ENDED',
          consent: 'GRANTED',
          recording: { create: { status: 'AVAILABLE', processingStatus: 'DONE' } },
        },
        include: { recording: true },
      });
      return call.recording!.id;
    }
  });

  describe('notifications', () => {
    it("Bob and an unassigned consultant receive none of Alice's events", async () => {
      const [alice, bob, consultant, consultant2] = await Promise.all([
        connect(t.alice),
        connect(t.bob),
        connect(t.consultant),
        connect(t.consultant2),
      ]);
      const seen = { alice: [] as string[], bob: [] as string[], consultant: [] as string[], consultant2: [] as string[] };
      for (const [name, s] of Object.entries({ alice, bob, consultant, consultant2 })) {
        s.onAny((event: string) => seen[name as keyof typeof seen].push(event));
      }

      // Alice raises a request, the consultant calls her, then ends the call.
      const callId = await aliceLiveCall();
      await http().post(`/api/calls/${callId}/end`).set(auth(t.consultant)).send({}).expect(200);
      await new Promise((r) => setTimeout(r, 500));

      expect(seen.consultant).toEqual(expect.arrayContaining(['request:created', 'call:ended']));
      expect(seen.alice).toEqual(expect.arrayContaining(['call:incoming', 'call:ended']));
      expect(seen.bob).toEqual([]);
      expect(seen.consultant2).toEqual([]);
      [alice, bob, consultant, consultant2].forEach((s) => s.close());
    });

    it('a socket without a valid login is refused', async () => {
      await expect(connect('forged-token')).rejects.toThrow('UNAUTHENTICATED');
    });
  });

  function connect(token: string): Promise<Socket> {
    const socket = io(url, { path: '/socket.io', transports: ['websocket'], auth: { token }, reconnection: false });
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', (err) => {
        socket.close();
        reject(err);
      });
    });
  }
});
