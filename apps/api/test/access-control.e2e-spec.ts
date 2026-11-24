/**
 * REQUIRED TEST: users only see their own data.
 *
 * Real NestJS app + real Postgres (test database) + real guards and queries.
 * Only LiveKit is replaced by a test double. Setup:
 *   consultant@demo.com  -> client1 (Alice), client2 (Bob), client3
 *   consultant2@demo.com -> client4
 * Client 1 owns a request and a finished, recorded call with a transcript and summary.
 * Every other user must get 404 (not 403, so existence isn't revealed).
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createTestApp, loginAs, resetDatabase } from './helpers';

describe('Access control: users only see their own data', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: Record<'client1' | 'client2' | 'consultant' | 'consultant2', string>;
  let requestId: string;
  let callId: string;
  let recordingId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    const ids = await resetDatabase(prisma);
    tokens = {
      client1: await loginAs(app, 'client1@demo.com'),
      client2: await loginAs(app, 'client2@demo.com'),
      consultant: await loginAs(app, 'consultant@demo.com'),
      consultant2: await loginAs(app, 'consultant2@demo.com'),
    };

    // Client 1 raises a request through the API.
    const created = await request(app.getHttpServer())
      .post('/api/requests')
      .set(auth(tokens.client1))
      .send({ title: 'Cannot export report', description: 'Export button does nothing' })
      .expect(201);
    requestId = created.body.id;

    // A finished, recorded call for that request (inserted directly: no media needed here).
    const call = await prisma.call.create({
      data: {
        requestId,
        roomName: `call-test-${requestId}`,
        clientId: ids['client1@demo.com'],
        consultantId: ids['consultant@demo.com'],
        status: 'ENDED',
        consent: 'GRANTED',
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(),
        recording: {
          create: {
            status: 'AVAILABLE',
            processingStatus: 'DONE',
            durationMs: 60_000,
            transcript: { create: { segments: [{ speakerName: 'Alice Client', role: 'CLIENT', startMs: 0, endMs: 2000, text: 'My export is broken' }] } },
            summary: {
              create: { overview: 'Export fixed.', issuesDiscussed: [], actionItems: [], outcome: 'RESOLVED', model: 'test' },
            },
          },
        },
      },
      include: { recording: true },
    });
    callId = call.id;
    recordingId = call.recording!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('the owner (client 1) can see their request, call history, transcript and video link', async () => {
    await http().get(`/api/requests/${requestId}`).set(auth(tokens.client1)).expect(200);
    const detail = await http().get(`/api/history/${callId}`).set(auth(tokens.client1)).expect(200);
    expect(detail.body.transcript[0].text).toBe('My export is broken');
    expect(detail.body.summary.overview).toBe('Export fixed.');
    await http().get(`/api/recordings/${recordingId}/media-token`).set(auth(tokens.client1)).expect(200);
  });

  it("the assigned consultant can see their client's data", async () => {
    await http().get(`/api/requests/${requestId}`).set(auth(tokens.consultant)).expect(200);
    await http().get(`/api/history/${callId}`).set(auth(tokens.consultant)).expect(200);
  });

  it("another client (client 2) gets 404 for every one of client 1's resources", async () => {
    const t = auth(tokens.client2);
    const res = await http().get(`/api/requests/${requestId}`).set(t).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    await http().get(`/api/calls/${callId}`).set(t).expect(404);
    await http().get(`/api/history/${callId}`).set(t).expect(404);
    await http().get(`/api/recordings/${recordingId}/media-token`).set(t).expect(404);
    await http().get(`/api/calls/${callId}/livekit-token`).set(t).expect(404);
    await http().post(`/api/recordings/${recordingId}/retry`).set(t).expect(404);
  });

  it("another client's lists never include client 1's data", async () => {
    const requests = await http().get('/api/requests').set(auth(tokens.client2)).expect(200);
    expect(requests.body.map((r: { id: string }) => r.id)).not.toContain(requestId);
    const history = await http().get('/api/history').set(auth(tokens.client2)).expect(200);
    expect(history.body.items.map((c: { id: string }) => c.id)).not.toContain(callId);
  });

  it('a consultant who is not assigned to client 1 gets 404 and empty lists', async () => {
    const t = auth(tokens.consultant2);
    await http().get(`/api/requests/${requestId}`).set(t).expect(404);
    await http().get(`/api/history/${callId}`).set(t).expect(404);
    await http().post(`/api/requests/${requestId}/calls`).set(t).expect(404);
    const list = await http().get('/api/requests').set(t).expect(200);
    expect(list.body).toEqual([]);
  });

  it('requests without a valid login get 401', async () => {
    await http().get('/api/requests').expect(401);
    await http().get(`/api/history/${callId}`).set(auth('not-a-real-token')).expect(401);
  });

  it('roles are enforced: a client cannot start a call', async () => {
    const res = await http().post(`/api/requests/${requestId}/calls`).set(auth(tokens.client1)).expect(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
  });

  it('LiveKit webhooks with a bad signature are rejected', async () => {
    const res = await http()
      .post('/api/livekit/webhook')
      .set('Content-Type', 'application/webhook+json')
      .set('Authorization', 'forged')
      .send('{"event":"room_finished"}')
      .expect(401);
    expect(res.body.code).toBe('INVALID_WEBHOOK_SIGNATURE');
  });
});
