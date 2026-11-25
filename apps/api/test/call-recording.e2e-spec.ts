/**
 * Call lifecycle + server-side recording orchestration, through the real API and DB.
 * LiveKit is a test double; webhooks are fed to WebhookService directly (signature
 * checking is covered in access-control.e2e-spec.ts).
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { QueueService } from '../src/queue/queue.service';
import { WebhookService } from '../src/livekit/webhook.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { CallsService } from '../src/calls/calls.service';
import { RecordingsService } from '../src/recordings/recordings.service';
import type { LiveKitEvent } from '../src/livekit/livekit.types';
import { auth, createLiveKitMock, createTestApp, LiveKitMock, loginAs, resetDatabase } from './helpers';

describe('Calls and recording', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let livekit: LiveKitMock;
  let webhooks: WebhookService;
  let queue: QueueService;
  let ids: Record<string, string>;
  let t: { client1: string; client2: string; consultant: string };
  let eventNo = 0;

  const http = () => request(app.getHttpServer());
  const event = (e: Partial<LiveKitEvent>): LiveKitEvent => ({
    id: `EV_test_${++eventNo}`,
    event: 'unknown',
    roomName: null,
    participant: null,
    track: null,
    egress: null,
    ...e,
  });
  const newRequest = async (token: string, title = 'Need help with export') =>
    (await http().post('/api/requests').set(auth(token)).send({ title, description: 'details' }).expect(201)).body.id as string;

  beforeAll(async () => {
    livekit = createLiveKitMock();
    ({ app, prisma } = await createTestApp(livekit));
    webhooks = app.get(WebhookService);
    queue = app.get(QueueService);
  });

  beforeEach(async () => {
    ids = await resetDatabase(prisma);
    jest.clearAllMocks();
    livekit.participants = [];
    jest.spyOn(queue, 'schedule').mockResolvedValue(undefined);
    jest.spyOn(queue, 'cancel').mockResolvedValue(undefined);
    jest.spyOn(queue, 'enqueueProcessing').mockResolvedValue(undefined);
    t = {
      client1: await loginAs(app, 'client1@demo.com'),
      client2: await loginAs(app, 'client2@demo.com'),
      consultant: await loginAs(app, 'consultant@demo.com'),
    };
  });

  afterAll(async () => {
    await app.close();
  });

  it('start -> join -> end: statuses, room, timers and request status', async () => {
    const requestId = await newRequest(t.client1);
    const started = await http().post(`/api/requests/${requestId}/calls`).set(auth(t.consultant)).expect(201);
    expect(started.body.call.status).toBe('WAITING');
    expect(started.body.token).toContain(ids['consultant@demo.com']);
    expect(livekit.createRoom).toHaveBeenCalledWith(`call-${started.body.call.id}`);
    expect(queue.schedule).toHaveBeenCalledWith('ring-timeout', started.body.call.id, expect.any(Number));

    const callId = started.body.call.id;
    const joined = await http().post(`/api/calls/${callId}/join`).set(auth(t.client1)).expect(200);
    expect(joined.body.call.status).toBe('ACTIVE');
    expect((await http().get(`/api/requests/${requestId}`).set(auth(t.client1))).body.status).toBe('IN_CALL');

    const ended = await http().post(`/api/calls/${callId}/end`).set(auth(t.consultant)).send({ resolved: true }).expect(200);
    expect(ended.body.status).toBe('ENDED');
    expect(livekit.deleteRoom).toHaveBeenCalled();
    expect((await http().get(`/api/requests/${requestId}`).set(auth(t.client1))).body.status).toBe('RESOLVED');

    // Ending twice is harmless; joining an ended call is not allowed.
    await http().post(`/api/calls/${callId}/end`).set(auth(t.client1)).expect(200);
    const late = await http().post(`/api/calls/${callId}/join`).set(auth(t.client1)).expect(409);
    expect(late.body.code).toBe('INVALID_STATE');
  });

  it('two "Start call" clicks at the same moment: exactly one call is created', async () => {
    const r1 = await newRequest(t.client1, 'First problem');
    const r2 = await newRequest(t.client2, 'Second problem');
    const results = await Promise.all([
      http().post(`/api/requests/${r1}/calls`).set(auth(t.consultant)),
      http().post(`/api/requests/${r2}/calls`).set(auth(t.consultant)),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('CONSULTANT_BUSY');
    expect(await prisma.call.count({ where: { status: { in: ['WAITING', 'ACTIVE'] } } })).toBe(1);
  });

  it('declining consent: the call continues and nothing is recorded', async () => {
    const callId = await activeCall();
    const res = await http().post(`/api/calls/${callId}/consent`).set(auth(t.client1)).send({ granted: false }).expect(200);
    expect(res.body.consent).toBe('DECLINED');
    expect(res.body.status).toBe('ACTIVE');
    expect(livekit.startCompositeEgress).not.toHaveBeenCalled();
    // Consent is answered once.
    await http().post(`/api/calls/${callId}/consent`).set(auth(t.client1)).send({ granted: true }).expect(409);
  });

  it('only the client can give consent', async () => {
    const callId = await activeCall();
    await http().post(`/api/calls/${callId}/consent`).set(auth(t.consultant)).send({ granted: true }).expect(403);
  });

  it('granting consent starts 1 composite + 1 voice recorder per microphone; duplicates are ignored', async () => {
    const callId = await activeCall();
    livekit.participants = [
      { identity: ids['client1@demo.com'], isRecorder: false, micTrackSids: ['TR_client_mic'] },
      { identity: ids['consultant@demo.com'], isRecorder: false, micTrackSids: ['TR_consultant_mic'] },
      { identity: 'EG_recorder', isRecorder: true, micTrackSids: [] },
    ];
    const res = await http().post(`/api/calls/${callId}/consent`).set(auth(t.client1)).send({ granted: true }).expect(200);
    expect(res.body.consent).toBe('GRANTED');

    const egresses = await prisma.recordingEgress.findMany({ orderBy: { createdAt: 'asc' } });
    expect(egresses.map((e) => [e.kind, e.role, e.pieceNo])).toEqual([
      ['COMPOSITE', null, 1],
      ['VOICE', 'CLIENT', 1],
      ['VOICE', 'CONSULTANT', 1],
    ]);
    expect(egresses[1].filePath).toMatch(/audio\/client-1\.ogg$/);

    // The same mic published again (webhook) must not start a second recorder.
    const room = `call-${callId}`;
    await webhooks.handle(
      event({ event: 'track_published', roomName: room, participant: { identity: ids['client1@demo.com'], isRecorder: false }, track: { sid: 'TR_client_mic', isMicrophone: true } }),
    );
    expect(await prisma.recordingEgress.count()).toBe(3);

    // After a refresh the client publishes a NEW mic track -> a second voice piece.
    await webhooks.handle(
      event({ event: 'track_published', roomName: room, participant: { identity: ids['client1@demo.com'], isRecorder: false }, track: { sid: 'TR_client_mic_2', isMicrophone: true } }),
    );
    const pieces = await prisma.recordingEgress.findMany({ where: { role: 'CLIENT' }, orderBy: { pieceNo: 'asc' } });
    expect(pieces.map((p) => p.filePath)).toEqual([expect.stringMatching(/client-1\.ogg$/), expect.stringMatching(/client-2\.ogg$/)]);
  });

  it('ending the call stops recorders; when all have ended, processing is queued exactly once', async () => {
    const callId = await activeCall();
    livekit.participants = [{ identity: ids['client1@demo.com'], isRecorder: false, micTrackSids: ['TR_mic'] }];
    await http().post(`/api/calls/${callId}/consent`).set(auth(t.client1)).send({ granted: true }).expect(200);
    const egresses = await prisma.recordingEgress.findMany();
    const start = new Date('2026-01-01T10:00:00Z');

    for (const e of egresses) {
      await webhooks.handle(event({ event: 'egress_started', egress: { egressId: e.egressId, state: 'active', startedAt: start, endedAt: null, error: null } }));
    }
    expect((await prisma.recording.findFirstOrThrow()).status).toBe('RECORDING');

    await http().post(`/api/calls/${callId}/end`).set(auth(t.client1)).expect(200);
    expect(livekit.stopEgress).toHaveBeenCalledTimes(egresses.length);
    expect((await prisma.recording.findFirstOrThrow()).status).toBe('STOPPING');

    const ended = (egressId: string) =>
      event({ event: 'egress_ended', egress: { egressId, state: 'complete', startedAt: start, endedAt: new Date(), error: null } });
    await webhooks.handle(ended(egresses[0].egressId));
    expect(queue.enqueueProcessing).not.toHaveBeenCalled(); // still waiting for the other recorder

    const last = ended(egresses[1].egressId);
    await webhooks.handle(last);
    await webhooks.handle(last); // LiveKit redelivers the same event: ignored
    const rec = await prisma.recording.findFirstOrThrow();
    expect(rec.status).toBe('FINALIZING');
    expect(rec.compositeStartedAt?.toISOString()).toBe(start.toISOString());
    expect(queue.enqueueProcessing).toHaveBeenCalledTimes(1);
  });

  it('a failed recorder marks the recording partial but processing still runs', async () => {
    const callId = await activeCall();
    livekit.participants = [{ identity: ids['client1@demo.com'], isRecorder: false, micTrackSids: ['TR_mic'] }];
    await http().post(`/api/calls/${callId}/consent`).set(auth(t.client1)).send({ granted: true }).expect(200);
    const [composite, voice] = await prisma.recordingEgress.findMany({ orderBy: { createdAt: 'asc' } });
    await webhooks.handle(event({ event: 'egress_ended', egress: { egressId: voice.egressId, state: 'failed', startedAt: null, endedAt: new Date(), error: 'boom' } }));
    await http().post(`/api/calls/${callId}/end`).set(auth(t.consultant)).send({}).expect(200);
    await webhooks.handle(event({ event: 'egress_ended', egress: { egressId: composite.egressId, state: 'complete', startedAt: new Date(), endedAt: new Date(), error: null } }));
    const rec = await prisma.recording.findFirstOrThrow();
    expect(rec.partial).toBe(true);
    expect(rec.status).toBe('FINALIZING');
    expect(queue.enqueueProcessing).toHaveBeenCalledTimes(1);
  });

  it('a disconnect is announced only if the person is still gone after the grace period', async () => {
    const callId = await activeCall();
    const realtime = app.get(RealtimeService);
    const emit = jest.spyOn(realtime, 'emitTo');
    const calls = app.get(CallsService);
    const clientId = ids['client1@demo.com'];
    const left = event({ event: 'participant_left', roomName: `call-${callId}`, participant: { identity: clientId, isRecorder: false } });

    await webhooks.handle(left);
    expect(queue.schedule).toHaveBeenCalledWith('presence-grace', `${callId}.${clientId}`, 60_000);
    expect(queue.schedule).toHaveBeenCalledWith('auto-end-check', callId, 180_000);
    expect(emit).not.toHaveBeenCalledWith(expect.anything(), 'participant:left', expect.anything()); // not yet

    // Came back within the grace period (e.g. a quick refresh): nothing is announced.
    livekit.participants = [{ identity: clientId, isRecorder: false, micTrackSids: [] }];
    await calls.presenceGraceExpired(callId, clientId);
    expect(emit).not.toHaveBeenCalledWith(expect.anything(), 'participant:left', expect.anything());

    // Still gone when the grace period ends: the consultant is told.
    livekit.participants = [];
    await calls.presenceGraceExpired(callId, clientId);
    expect(emit).toHaveBeenCalledWith(ids['consultant@demo.com'], 'participant:left', expect.objectContaining({ callId, role: 'CLIENT' }));

    // Rejoining cancels the timers.
    await webhooks.handle(event({ event: 'participant_joined', roomName: `call-${callId}`, participant: { identity: clientId, isRecorder: false } }));
    expect(queue.cancel).toHaveBeenCalledWith('presence-grace', `${callId}.${clientId}`);
    expect(queue.cancel).toHaveBeenCalledWith('auto-end-check', callId);
  });

  it('room_finished from LiveKit ends a call we still think is live (safety net)', async () => {
    const callId = await activeCall();
    await webhooks.handle(event({ event: 'room_finished', roomName: `call-${callId}` }));
    expect((await prisma.call.findUniqueOrThrow({ where: { id: callId } })).status).toBe('ENDED');
  });

  it('if an "egress ended" event is lost, the fallback check asks LiveKit and still finalizes', async () => {
    const callId = await activeCall();
    livekit.participants = [{ identity: ids['client1@demo.com'], isRecorder: false, micTrackSids: ['TR_mic'] }];
    await http().post(`/api/calls/${callId}/consent`).set(auth(t.client1)).send({ granted: true }).expect(200);
    await http().post(`/api/calls/${callId}/end`).set(auth(t.client1)).expect(200);
    expect(queue.schedule).toHaveBeenCalledWith('egress-check', expect.any(String), 120_000);

    const [composite, voice] = await prisma.recordingEgress.findMany({ orderBy: { createdAt: 'asc' } });
    // LiveKit reports the composite as complete; the voice recorder is unknown (no answer).
    livekit.getEgress.mockImplementation(async (id: string) =>
      id === composite.egressId ? { egressId: id, state: 'complete', startedAt: new Date(), endedAt: new Date(), error: null } : null,
    );
    const recording = await prisma.recording.findFirstOrThrow();
    await app.get(RecordingsService).checkEgress(recording.id);

    const after = await prisma.recordingEgress.findMany();
    expect(after.find((e) => e.id === composite.id)!.status).toBe('ENDED');
    expect(after.find((e) => e.id === voice.id)!.status).toBe('FAILED');
    const rec = await prisma.recording.findFirstOrThrow();
    expect(rec).toMatchObject({ status: 'FINALIZING', partial: true });
    expect(queue.enqueueProcessing).toHaveBeenCalledTimes(1);
  });

  it('LiveKit being down gives a clear 503 and saves nothing', async () => {
    const requestId = await newRequest(t.client1);
    // LiveKitService maps network failures to this exception (see LiveKitService.call).
    const { AppException } = await import('../src/common/app-exception');
    livekit.createRoom.mockRejectedValueOnce(AppException.mediaUnavailable(new Error('ECONNREFUSED')));
    const res = await http().post(`/api/requests/${requestId}/calls`).set(auth(t.consultant)).expect(503);
    expect(res.body.code).toBe('MEDIA_SERVER_UNAVAILABLE');
    expect(await prisma.call.count()).toBe(0);
    livekit.createRoom.mockResolvedValue(undefined);
  });

  async function activeCall() {
    const requestId = await newRequest(t.client1);
    const started = await http().post(`/api/requests/${requestId}/calls`).set(auth(t.consultant)).expect(201);
    await http().post(`/api/calls/${started.body.call.id}/join`).set(auth(t.client1)).expect(200);
    return started.body.call.id as string;
  }
});
