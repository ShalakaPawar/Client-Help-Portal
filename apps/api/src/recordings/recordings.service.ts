import { Injectable, Logger } from '@nestjs/common';
import { Call, Prisma, RecordingEgress } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RecordingStatus, Role, SocketEvent } from '@chp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LiveKitService } from '../livekit/livekit.service';
import { EgressSnapshot, isEgressFinished } from '../livekit/livekit.types';
import { StorageService } from '../storage/storage.service';
import { QueueService } from '../queue/queue.service';
import { TimerJob } from '../queue/queues';
import { RealtimeService } from '../realtime/realtime.service';

const EGRESS_CHECK_DELAY_MS = 2 * 60_000;

/**
 * Server-side recording with LiveKit Egress (3 outputs per call):
 *   - 1 composite egress: screen share + both voices -> HLS segments (playback)
 *   - 1 track egress per microphone track -> .ogg (exact speaker labels)
 * Only this service starts/stops recorders, and only after the client's consent.
 */
@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly livekit: LiveKitService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Called once consent is GRANTED. Creates the Recording and starts all recorders. */
  async startForCall(call: Call) {
    const recording = await this.prisma.recording.upsert({
      where: { callId: call.id },
      create: { callId: call.id, status: RecordingStatus.STARTING },
      update: {},
    });
    this.storage.prepareRecordingDirs(recording.id);

    try {
      const composite = await this.livekit.startCompositeEgress(
        call.roomName,
        this.storage.egressPath(this.storage.compositeDir(recording.id)),
      );
      await this.prisma.recordingEgress.create({
        data: {
          recordingId: recording.id,
          kind: 'COMPOSITE',
          egressId: composite.egressId,
          status: 'STARTING',
          filePath: this.storage.playlist(recording.id),
        },
      });
    } catch (err) {
      await this.setStatus(recording.id, call, RecordingStatus.FAILED, `Could not start recording: ${(err as Error).message}`);
      throw err;
    }

    // Record every microphone that is already published; later ones arrive via track_published.
    const participants = await this.livekit.listParticipants(call.roomName).catch(() => []);
    for (const p of participants) {
      const role = this.roleOf(call, p.identity);
      if (!role || p.isRecorder) continue;
      for (const sid of p.micTrackSids) await this.startVoicePiece(call, role, sid);
    }
    this.emitStatus(call, recording.id, RecordingStatus.STARTING);
    return recording;
  }

  /** Start recording one microphone track. Safe to call twice for the same track. */
  async startVoicePiece(call: Call, role: Role, trackSid: string) {
    const recording = await this.prisma.recording.findUnique({ where: { callId: call.id } });
    if (!recording || !this.isRecordingActive(recording.status)) return;

    const pieceNo = (await this.prisma.recordingEgress.count({ where: { recordingId: recording.id, kind: 'VOICE', role } })) + 1;
    const filePath = this.storage.voiceFile(recording.id, role, pieceNo);

    // Claim the track first: the unique (recordingId, trackSid) index stops double-starts.
    let row: RecordingEgress;
    try {
      row = await this.prisma.recordingEgress.create({
        data: { recordingId: recording.id, kind: 'VOICE', role, trackSid, pieceNo, egressId: `pending-${randomUUID()}`, filePath },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return; // already recording
      throw err;
    }

    try {
      const egress = await this.livekit.startTrackEgress(call.roomName, trackSid, this.storage.egressPath(filePath));
      await this.prisma.recordingEgress.update({ where: { id: row.id }, data: { egressId: egress.egressId } });
      this.logger.log(`voice egress started: ${role} piece ${pieceNo} (${egress.egressId})`);
    } catch (err) {
      await this.prisma.recordingEgress.update({
        where: { id: row.id },
        data: { status: 'FAILED', error: (err as Error).message },
      });
      await this.prisma.recording.update({ where: { id: recording.id }, data: { partial: true } });
      this.logger.error(`voice egress failed for ${role}: ${(err as Error).message}`);
    }
  }

  /** Apply an egress status change (from a webhook or the fallback check). */
  async applyEgressUpdate(snapshot: EgressSnapshot) {
    const row = await this.prisma.recordingEgress.findUnique({
      where: { egressId: snapshot.egressId },
      include: { recording: { include: { call: true } } },
    });
    if (!row) return; // not ours (or the start call has not returned yet)
    const { recording } = row;
    const finished = isEgressFinished(snapshot.state);
    const failed = snapshot.state === 'failed' || snapshot.state === 'aborted' || snapshot.state === 'limit_reached';

    await this.prisma.recordingEgress.update({
      where: { id: row.id },
      data: {
        status: finished ? (failed ? 'FAILED' : 'ENDED') : 'ACTIVE',
        startedAt: snapshot.startedAt ?? row.startedAt,
        endedAt: snapshot.endedAt ?? (finished ? new Date() : row.endedAt),
        error: snapshot.error ?? row.error,
      },
    });

    if (row.kind === 'COMPOSITE' && snapshot.startedAt && !recording.compositeStartedAt) {
      await this.prisma.recording.update({ where: { id: recording.id }, data: { compositeStartedAt: snapshot.startedAt } });
    }
    if (row.kind === 'COMPOSITE' && !finished && recording.status === RecordingStatus.STARTING) {
      await this.setStatus(recording.id, recording.call, RecordingStatus.RECORDING);
    }
    if (failed) {
      await this.prisma.recording.update({ where: { id: recording.id }, data: { partial: true } });
    }
    if (finished) await this.maybeFinalize(recording.id);
  }

  /** Stop all recorders (call ended, consent withdrawn, or time cap). */
  async stopForCall(callId: string) {
    const recording = await this.prisma.recording.findUnique({ where: { callId }, include: { egresses: true, call: true } });
    if (!recording || !this.isRecordingActive(recording.status)) return;

    await this.setStatus(recording.id, recording.call, RecordingStatus.STOPPING);
    const running = recording.egresses.filter((e) => e.status === 'STARTING' || e.status === 'ACTIVE');
    await Promise.all(running.filter((e) => !e.egressId.startsWith('pending-')).map((e) => this.livekit.stopEgress(e.egressId)));
    await this.queue.schedule(TimerJob.EGRESS_CHECK, recording.id, EGRESS_CHECK_DELAY_MS);
    await this.maybeFinalize(recording.id);
  }

  /** Safety net: ask LiveKit directly for egresses whose "ended" webhook never came. */
  async checkEgress(recordingId: string) {
    const recording = await this.prisma.recording.findUnique({ where: { id: recordingId }, include: { egresses: true } });
    if (!recording || recording.status !== RecordingStatus.STOPPING) return;
    for (const e of recording.egresses.filter((x) => x.status === 'STARTING' || x.status === 'ACTIVE')) {
      const snap = e.egressId.startsWith('pending-') ? null : await this.livekit.getEgress(e.egressId).catch(() => null);
      if (snap && isEgressFinished(snap.state)) {
        await this.applyEgressUpdate(snap);
      } else {
        // Still not finished after the grace period: give up on it and process what we have.
        await this.prisma.recordingEgress.update({
          where: { id: e.id },
          data: { status: 'FAILED', error: 'No end event received from LiveKit', endedAt: new Date() },
        });
        await this.prisma.recording.update({ where: { id: recordingId }, data: { partial: true } });
        if (!e.egressId.startsWith('pending-')) await this.livekit.stopEgress(e.egressId);
      }
    }
    await this.maybeFinalize(recordingId);
  }

  /** When the call is over and every recorder has finished: hand over to processing. */
  async maybeFinalize(recordingId: string) {
    const recording = await this.prisma.recording.findUnique({ where: { id: recordingId }, include: { egresses: true, call: true } });
    if (!recording || recording.status !== RecordingStatus.STOPPING) return;
    const allDone = recording.egresses.every((e) => e.status === 'ENDED' || e.status === 'FAILED');
    if (!allDone) return;

    // Only one caller wins the STOPPING -> FINALIZING change.
    const { count } = await this.prisma.recording.updateMany({
      where: { id: recordingId, status: RecordingStatus.STOPPING },
      data: { status: RecordingStatus.FINALIZING },
    });
    if (count === 0) return;
    await this.queue.cancel(TimerJob.EGRESS_CHECK, recordingId);
    await this.queue.enqueueProcessing(recordingId);
    this.emitStatus(recording.call, recordingId, RecordingStatus.FINALIZING);
  }

  roleOf(call: Pick<Call, 'clientId' | 'consultantId'>, identity: string): Role | null {
    if (identity === call.clientId) return Role.CLIENT;
    if (identity === call.consultantId) return Role.CONSULTANT;
    return null;
  }

  private isRecordingActive(status: string) {
    return status === RecordingStatus.STARTING || status === RecordingStatus.RECORDING;
  }

  private async setStatus(recordingId: string, call: Call, status: RecordingStatus, lastError?: string) {
    await this.prisma.recording.update({ where: { id: recordingId }, data: { status, ...(lastError ? { lastError } : {}) } });
    this.emitStatus(call, recordingId, status);
  }

  private emitStatus(call: Pick<Call, 'id' | 'clientId' | 'consultantId'>, recordingId: string, status: RecordingStatus) {
    this.realtime.emitTo([call.clientId, call.consultantId], SocketEvent.RECORDING_STATUS, {
      callId: call.id,
      recordingId,
      status,
    });
  }
}
