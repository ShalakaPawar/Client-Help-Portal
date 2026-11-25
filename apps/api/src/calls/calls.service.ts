import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CallDto, CallStatus, ErrorCode, LiveKitJoinDto, RequestStatus, Role, SocketEvent } from '@chp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app-exception';
import { callInclude, toCallDto } from '../common/mappers';
import type { AuthUser } from '../common/auth.decorators';
import { LiveKitService } from '../livekit/livekit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RequestsService } from '../requests/requests.service';
import { RecordingsService } from '../recordings/recordings.service';
import { QueueService } from '../queue/queue.service';
import { TimerJob } from '../queue/queues';
import { APP_CONFIG, AppConfig } from '../config/env';
import { canChangeConsent, canTransition, LIVE_CALL_STATUSES, roomNameFor } from './call-rules';

const RING_TIMEOUT_MS = 2 * 60_000;
const PRESENCE_GRACE_MS = 60_000;
const AUTO_END_AFTER_MS = 3 * 60_000;

export type EndReason = 'user' | 'auto-end' | 'time-cap' | 'room-finished';

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly livekit: LiveKitService,
    private readonly realtime: RealtimeService,
    private readonly requests: RequestsService,
    private readonly recordings: RecordingsService,
    private readonly queue: QueueService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Consultant starts a call from an open request. */
  async start(consultant: AuthUser, requestId: string): Promise<LiveKitJoinDto> {
    const request = await this.prisma.helpRequest.findFirst({ where: { id: requestId, ...this.scope.requestWhere(consultant) } });
    if (!request) throw AppException.notFound('Request');
    if (request.status !== RequestStatus.OPEN) throw AppException.invalidState('Calls can only be started for open requests');

    const busy = await this.prisma.call.findFirst({ where: { consultantId: consultant.id, status: { in: LIVE_CALL_STATUSES } } });
    if (busy) throw new AppException(ErrorCode.CONSULTANT_BUSY, HttpStatus.CONFLICT, "You're already in a call");

    const id = randomUUID();
    const roomName = roomNameFor(id);
    await this.livekit.createRoom(roomName); // 503 if LiveKit is down, before anything is saved

    let callId: string;
    try {
      const call = await this.prisma.$transaction(async (tx) => {
        const created = await tx.call.create({
          data: { id, requestId, roomName, clientId: request.clientId, consultantId: consultant.id },
        });
        await tx.helpRequest.update({ where: { id: requestId }, data: { status: RequestStatus.IN_CALL } });
        return created;
      });
      callId = call.id;
    } catch (err) {
      await this.livekit.deleteRoom(roomName);
      // The partial unique indexes are the real guarantee against two live calls.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = String(err.meta?.target ?? '');
        if (target.includes('consultant')) {
          throw new AppException(ErrorCode.CONSULTANT_BUSY, HttpStatus.CONFLICT, "You're already in a call");
        }
        throw new AppException(ErrorCode.CALL_ALREADY_ACTIVE, HttpStatus.CONFLICT, 'A call is already running for this request');
      }
      throw err;
    }

    await this.queue.schedule(TimerJob.RING_TIMEOUT, callId, RING_TIMEOUT_MS);
    const dto = await this.getDto(callId);
    this.realtime.emitTo(dto.client.id, SocketEvent.CALL_INCOMING, dto);
    await this.requests.notifyUpdatedById(requestId);
    return this.joinInfo(consultant, dto);
  }

  /** Client joins: WAITING -> ACTIVE. Also used by the client to rejoin after a refresh. */
  async join(client: AuthUser, callId: string): Promise<LiveKitJoinDto> {
    const call = await this.findOwn(client, callId);
    if (call.status === CallStatus.WAITING) {
      const { count } = await this.prisma.call.updateMany({
        where: { id: callId, status: CallStatus.WAITING },
        data: { status: CallStatus.ACTIVE, startedAt: new Date() },
      });
      if (count === 1) {
        await this.queue.cancel(TimerJob.RING_TIMEOUT, callId);
        await this.queue.schedule(TimerJob.CALL_CAP, callId, this.config.MAX_CALL_MINUTES * 60_000);
        await this.broadcast(callId, SocketEvent.CALL_UPDATED);
      }
    } else if (call.status !== CallStatus.ACTIVE) {
      throw AppException.invalidState('This call has already ended');
    }
    return this.joinInfo(client, await this.getDto(callId));
  }

  /** Fresh LiveKit token for a participant (consultant joining, or rejoin after refresh). */
  async token(user: AuthUser, callId: string): Promise<LiveKitJoinDto> {
    const call = await this.findOwn(user, callId);
    if (!LIVE_CALL_STATUSES.includes(call.status)) throw AppException.invalidState('This call has already ended');
    return this.joinInfo(user, await this.getDto(callId));
  }

  async active(user: AuthUser): Promise<CallDto | null> {
    const call = await this.prisma.call.findFirst({
      where: { ...this.scope.callWhere(user), status: { in: LIVE_CALL_STATUSES } },
      include: callInclude,
      orderBy: { createdAt: 'desc' },
    });
    return call ? toCallDto(call) : null;
  }

  async get(user: AuthUser, callId: string): Promise<CallDto> {
    await this.findOwn(user, callId);
    return this.getDto(callId);
  }

  /** Client agrees (or not) to recording. Recording starts only after GRANTED is saved. */
  async consent(client: AuthUser, callId: string, granted: boolean): Promise<CallDto> {
    const call = await this.findOwn(client, callId);
    if (call.status !== CallStatus.ACTIVE) throw AppException.invalidState('Consent can only be given during an active call');
    const next = granted ? 'GRANTED' : 'DECLINED';
    if (!canChangeConsent(call.consent, next)) throw AppException.invalidState('Recording consent was already answered');

    const { count } = await this.prisma.call.updateMany({
      where: { id: callId, consent: 'PENDING' },
      data: { consent: next, consentAt: new Date() },
    });
    if (count === 0) throw AppException.invalidState('Recording consent was already answered');

    if (granted) {
      await this.recordings.startForCall({ ...call, consent: 'GRANTED' });
    } else {
      await this.prisma.recording.create({ data: { callId, status: 'NONE', processingStatus: 'DONE' } });
    }
    return this.broadcast(callId, SocketEvent.CALL_UPDATED);
  }

  /** Client withdraws consent mid-call: recorders stop, what was recorded is kept and processed. */
  async stopRecording(client: AuthUser, callId: string): Promise<CallDto> {
    const call = await this.findOwn(client, callId);
    if (!canChangeConsent(call.consent, 'WITHDRAWN')) throw AppException.invalidState('Recording is not running');
    await this.prisma.call.update({ where: { id: callId }, data: { consent: 'WITHDRAWN' } });
    await this.recordings.stopForCall(callId);
    return this.broadcast(callId, SocketEvent.CALL_UPDATED);
  }

  /** A participant ends the call. The consultant may mark the request resolved at the same time. */
  async end(user: AuthUser, callId: string, resolved?: boolean): Promise<CallDto> {
    await this.findOwn(user, callId);
    const markResolved = user.role === Role.CONSULTANT && resolved === true;
    return this.endCall(callId, 'user', markResolved);
  }

  /** Shared by the End button, auto-end and the time cap. Idempotent. */
  async endCall(callId: string, reason: EndReason, markResolved = false): Promise<CallDto> {
    const call = await this.prisma.call.findUniqueOrThrow({ where: { id: callId } });
    if (!canTransition(call.status, CallStatus.ENDED)) return this.getDto(callId);

    const { count } = await this.prisma.call.updateMany({
      where: { id: callId, status: { in: LIVE_CALL_STATUSES } },
      data: { status: CallStatus.ENDED, endedAt: new Date() },
    });
    if (count === 0) return this.getDto(callId);
    await this.prisma.helpRequest.updateMany({
      where: { id: call.requestId, status: RequestStatus.IN_CALL },
      data: { status: markResolved ? RequestStatus.RESOLVED : RequestStatus.OPEN },
    });
    this.logger.log(`call ${callId} ended (${reason})`);

    await Promise.all([
      this.queue.cancel(TimerJob.RING_TIMEOUT, callId),
      this.queue.cancel(TimerJob.CALL_CAP, callId),
      this.queue.cancel(TimerJob.AUTO_END_CHECK, callId),
    ]);
    await this.recordings.stopForCall(callId);
    await this.livekit.deleteRoom(call.roomName); // disconnects both browsers

    const dto = await this.broadcast(callId, SocketEvent.CALL_ENDED);
    await this.requests.notifyUpdatedById(call.requestId);
    return dto;
  }

  /** Ring timeout fired: if the client never joined, the call is MISSED and the request reopens. */
  async markMissed(callId: string) {
    const { count } = await this.prisma.call.updateMany({
      where: { id: callId, status: CallStatus.WAITING },
      data: { status: CallStatus.MISSED, endedAt: new Date() },
    });
    if (count === 0) return;
    const call = await this.prisma.call.findUniqueOrThrow({ where: { id: callId } });
    await this.prisma.helpRequest.updateMany({
      where: { id: call.requestId, status: RequestStatus.IN_CALL },
      data: { status: RequestStatus.OPEN },
    });
    await this.livekit.deleteRoom(call.roomName);
    await this.broadcast(callId, SocketEvent.CALL_ENDED);
    await this.requests.notifyUpdatedById(call.requestId);
  }

  /**
   * LiveKit says a participant left. A quick refresh or network blip should not alarm the
   * other person, so they are told only if the person is still gone after a grace period.
   * If both are gone for longer, the call ends automatically.
   */
  async onParticipantLeft(roomName: string, identity: string) {
    const call = await this.prisma.call.findUnique({ where: { roomName } });
    if (!call || call.status !== CallStatus.ACTIVE) return;
    if (identity !== call.clientId && identity !== call.consultantId) return;
    await this.queue.schedule(TimerJob.PRESENCE_GRACE, `${call.id}.${identity}`, PRESENCE_GRACE_MS);
    await this.queue.schedule(TimerJob.AUTO_END_CHECK, call.id, AUTO_END_AFTER_MS);
  }

  /** Grace period over: if the person has not come back, tell the other participant. */
  async presenceGraceExpired(callId: string, userId: string) {
    const call = await this.prisma.call.findUnique({ where: { id: callId }, include: { client: true, consultant: true } });
    if (!call || call.status !== CallStatus.ACTIVE) return;
    const people = await this.livekit.listParticipants(call.roomName).catch(() => []);
    if (people.some((p) => p.identity === userId)) return; // came back in time
    const leaver = userId === call.clientId ? call.client : call.consultant;
    const other = userId === call.clientId ? call.consultantId : call.clientId;
    this.realtime.emitTo(other, SocketEvent.PARTICIPANT_LEFT, { callId, role: leaver.role, name: leaver.name });
  }

  async onParticipantJoined(roomName: string, identity: string) {
    const call = await this.prisma.call.findUnique({ where: { roomName }, include: { client: true, consultant: true } });
    if (!call || call.status !== CallStatus.ACTIVE) return;
    const joiner = identity === call.clientId ? call.client : identity === call.consultantId ? call.consultant : null;
    if (!joiner) return;
    await this.queue.cancel(TimerJob.PRESENCE_GRACE, `${call.id}.${identity}`);
    await this.queue.cancel(TimerJob.AUTO_END_CHECK, call.id); // someone is here, so no auto-end
    const other = joiner.id === call.clientId ? call.consultantId : call.clientId;
    this.realtime.emitTo(other, SocketEvent.PARTICIPANT_RETURNED, { callId: call.id, role: joiner.role, name: joiner.name });
  }

  /** Safety net: LiveKit closed the room (e.g. empty for too long) while we still think the call is live. */
  async onRoomFinished(roomName: string) {
    const call = await this.prisma.call.findUnique({ where: { roomName } });
    if (!call) return;
    if (call.status === CallStatus.WAITING) return this.markMissed(call.id);
    if (call.status === CallStatus.ACTIVE) await this.endCall(call.id, 'room-finished');
  }

  /** Auto-end only if neither participant is in the room any more. */
  async autoEndIfEmpty(callId: string) {
    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    if (!call || call.status !== CallStatus.ACTIVE) return;
    const people = await this.livekit.listParticipants(call.roomName).catch(() => []);
    const present = people.filter((p) => !p.isRecorder && (p.identity === call.clientId || p.identity === call.consultantId));
    if (present.length === 0) await this.endCall(callId, 'auto-end');
  }

  /** A microphone was published: record it if recording is on. */
  async onMicPublished(roomName: string, identity: string, trackSid: string) {
    const call = await this.prisma.call.findUnique({ where: { roomName } });
    if (!call || call.status !== CallStatus.ACTIVE || call.consent !== 'GRANTED') return;
    const role = this.recordings.roleOf(call, identity);
    if (role) await this.recordings.startVoicePiece(call, role, trackSid);
  }

  // ---- helpers ----

  private async findOwn(user: AuthUser, callId: string) {
    const call = await this.prisma.call.findFirst({ where: { id: callId, ...this.scope.callWhere(user) } });
    if (!call) throw AppException.notFound('Call');
    return call;
  }

  private async getDto(callId: string): Promise<CallDto> {
    return toCallDto(await this.prisma.call.findUniqueOrThrow({ where: { id: callId }, include: callInclude }));
  }

  private async broadcast(callId: string, event: typeof SocketEvent.CALL_UPDATED | typeof SocketEvent.CALL_ENDED) {
    const dto = await this.getDto(callId);
    this.realtime.emitTo([dto.client.id, dto.consultant.id], event, dto);
    return dto;
  }

  private async joinInfo(user: AuthUser, call: CallDto): Promise<LiveKitJoinDto> {
    const room = (await this.prisma.call.findUniqueOrThrow({ where: { id: call.id }, select: { roomName: true } })).roomName;
    const token = await this.livekit.createToken({ identity: user.id, name: user.name, room, role: user.role });
    return { call, livekitUrl: this.livekit.publicUrl, token, maxCallMinutes: this.config.MAX_CALL_MINUTES };
  }
}
