import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AccessToken,
  DirectFileOutput,
  EgressClient,
  EgressInfo,
  EgressStatus,
  EncodingOptionsPreset,
  RoomServiceClient,
  SegmentedFileOutput,
  TrackSource,
  TrackType,
  WebhookReceiver,
} from 'livekit-server-sdk';
import { Role } from '@chp/shared';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AppException } from '../common/app-exception';
import type { EgressSnapshot, EgressState, LiveKitEvent, ParticipantSnapshot, TokenRequest } from './livekit.types';

/**
 * Thin wrapper around the LiveKit server SDK: rooms, access tokens, Egress and webhooks.
 * Network failures are turned into 503 MEDIA_SERVER_UNAVAILABLE.
 */
@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly rooms: RoomServiceClient;
  private readonly egress: EgressClient;
  private readonly receiver: WebhookReceiver;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const { LIVEKIT_API_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = config;
    this.rooms = new RoomServiceClient(LIVEKIT_API_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    this.egress = new EgressClient(LIVEKIT_API_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    this.receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }

  get publicUrl() {
    return this.config.LIVEKIT_URL;
  }

  async createRoom(name: string) {
    await this.call('createRoom', () => this.rooms.createRoom({ name, emptyTimeout: 10 * 60 }));
  }

  /** Best effort: the room may already be gone. Disconnects everyone and ends running egress. */
  async deleteRoom(name: string) {
    try {
      await this.rooms.deleteRoom(name);
    } catch (err) {
      this.logger.warn(`deleteRoom(${name}) failed: ${(err as Error).message}`);
    }
  }

  /**
   * Room-scoped token. Clients may publish screen share + microphone, consultants only
   * their microphone. Identity = user id, so a second tab replaces the first session.
   */
  async createToken(req: TokenRequest): Promise<string> {
    const at = new AccessToken(this.config.LIVEKIT_API_KEY, this.config.LIVEKIT_API_SECRET, {
      identity: req.identity,
      name: req.name,
      ttl: '10m',
      metadata: JSON.stringify({ role: req.role }),
    });
    at.addGrant({
      roomJoin: true,
      room: req.room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources:
        req.role === Role.CLIENT
          ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO, TrackSource.MICROPHONE]
          : [TrackSource.MICROPHONE],
    });
    return at.toJwt();
  }

  async listParticipants(room: string): Promise<ParticipantSnapshot[]> {
    const list = await this.call('listParticipants', () => this.rooms.listParticipants(room));
    return list.map((p) => ({
      identity: p.identity,
      isRecorder: isRecorderIdentity(p.identity),
      micTrackSids: p.tracks
        .filter((t) => t.type === TrackType.AUDIO && t.source === TrackSource.MICROPHONE)
        .map((t) => t.sid),
    }));
  }

  /** Screen share + both voices, written as HLS segments while the call runs. */
  async startCompositeEgress(room: string, outputDirInEgress: string): Promise<EgressSnapshot> {
    const info = await this.call('startRoomCompositeEgress', () =>
      this.egress.startRoomCompositeEgress(
        room,
        {
          segments: new SegmentedFileOutput({
            filenamePrefix: `${outputDirInEgress}/seg`,
            playlistName: 'index.m3u8',
            segmentDuration: 4,
          }),
        },
        { layout: 'speaker', encodingOptions: EncodingOptionsPreset.H264_720P_30 },
      ),
    );
    return toSnapshot(info);
  }

  /** One participant's microphone, written as an .ogg file (no re-encoding). */
  async startTrackEgress(room: string, trackSid: string, filepathInEgress: string): Promise<EgressSnapshot> {
    const info = await this.call('startTrackEgress', () =>
      this.egress.startTrackEgress(room, new DirectFileOutput({ filepath: filepathInEgress }), trackSid),
    );
    return toSnapshot(info);
  }

  async stopEgress(egressId: string): Promise<void> {
    try {
      await this.egress.stopEgress(egressId);
    } catch (err) {
      // Already finished egress cannot be stopped; that's fine.
      this.logger.warn(`stopEgress(${egressId}) failed: ${(err as Error).message}`);
    }
  }

  async getEgress(egressId: string): Promise<EgressSnapshot | null> {
    const list = await this.call('listEgress', () => this.egress.listEgress({ egressId }));
    return list[0] ? toSnapshot(list[0]) : null;
  }

  /** Verifies the signature and returns a normalised event. Throws on a bad signature. */
  async receiveWebhook(rawBody: string, authHeader: string | undefined): Promise<LiveKitEvent> {
    const e = await this.receiver.receive(rawBody, authHeader);
    return {
      id: e.id,
      event: e.event,
      roomName: e.room?.name ?? e.egressInfo?.roomName ?? null,
      participant: e.participant
        ? { identity: e.participant.identity, isRecorder: isRecorderIdentity(e.participant.identity) }
        : null,
      track: e.track
        ? { sid: e.track.sid, isMicrophone: e.track.type === TrackType.AUDIO && e.track.source === TrackSource.MICROPHONE }
        : null,
      egress: e.egressInfo ? toSnapshot(e.egressInfo) : null,
    };
  }

  async ping(): Promise<boolean> {
    try {
      await this.rooms.listRooms();
      return true;
    } catch {
      return false;
    }
  }

  private async call<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(`LiveKit ${what} failed: ${(err as Error).message}`);
      throw AppException.mediaUnavailable(err);
    }
  }
}

const STATE: Record<number, EgressState> = {
  [EgressStatus.EGRESS_STARTING]: 'starting',
  [EgressStatus.EGRESS_ACTIVE]: 'active',
  [EgressStatus.EGRESS_ENDING]: 'ending',
  [EgressStatus.EGRESS_COMPLETE]: 'complete',
  [EgressStatus.EGRESS_FAILED]: 'failed',
  [EgressStatus.EGRESS_ABORTED]: 'aborted',
  [EgressStatus.EGRESS_LIMIT_REACHED]: 'limit_reached',
};

/** Egress joins rooms as a hidden participant whose identity starts with EG_. */
const isRecorderIdentity = (identity: string) => identity.startsWith('EG_');

/** LiveKit timestamps are bigint nanoseconds; 0 means "not set". */
const nsToDate = (ns: bigint | number | undefined) => (ns && BigInt(ns) > 0n ? new Date(Number(BigInt(ns) / 1_000_000n)) : null);

function toSnapshot(info: EgressInfo): EgressSnapshot {
  return {
    egressId: info.egressId,
    state: STATE[info.status] ?? 'starting',
    startedAt: nsToDate(info.startedAt),
    endedAt: nsToDate(info.endedAt),
    error: info.error || null,
  };
}
