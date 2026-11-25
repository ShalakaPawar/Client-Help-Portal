import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CallsService } from '../calls/calls.service';
import { RecordingsService } from '../recordings/recordings.service';
import type { LiveKitEvent } from './livekit.types';

/** Turns LiveKit events into state changes. Each event id is handled at most once. */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calls: CallsService,
    private readonly recordings: RecordingsService,
  ) {}

  async handle(e: LiveKitEvent) {
    if (!(await this.firstTime(e))) return;
    this.logger.debug(`webhook ${e.event} room=${e.roomName ?? '-'}`);

    switch (e.event) {
      case 'participant_joined':
        if (e.roomName && e.participant && !e.participant.isRecorder) {
          await this.calls.onParticipantJoined(e.roomName, e.participant.identity);
        }
        break;
      case 'participant_left':
        if (e.roomName && e.participant && !e.participant.isRecorder) {
          await this.calls.onParticipantLeft(e.roomName, e.participant.identity);
        }
        break;
      case 'track_published':
        if (e.roomName && e.participant && e.track?.isMicrophone && !e.participant.isRecorder) {
          await this.calls.onMicPublished(e.roomName, e.participant.identity, e.track.sid);
        }
        break;
      case 'room_finished':
        if (e.roomName) await this.calls.onRoomFinished(e.roomName);
        break;
      case 'egress_started':
      case 'egress_updated':
      case 'egress_ended':
        if (e.egress) await this.recordings.applyEgressUpdate(e.egress);
        break;
      default:
        break;
    }
  }

  /** Store the event id; a duplicate insert means LiveKit redelivered it. */
  private async firstTime(e: LiveKitEvent) {
    if (!e.id) return true;
    try {
      await this.prisma.webhookEvent.create({ data: { id: e.id, type: e.event } });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }
}
