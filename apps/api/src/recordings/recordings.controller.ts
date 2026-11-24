import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ProcessingStatus, RecordingStatus, SocketEvent } from '@chp/shared';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../common/scope.service';
import { QueueService } from '../queue/queue.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MediaService } from './media.service';

@Controller()
export class RecordingsController {
  constructor(
    private readonly media: MediaService,
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly queue: QueueService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('recordings/:id/media-token')
  mediaToken(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.issueToken(user, id);
  }

  /** Streams the MP4. Express sendFile supports Range requests (206), which seeking needs. */
  @Public()
  @Get('media/:token')
  async stream(@Param('token') token: string, @Res() res: Response) {
    const path = await this.media.resolve(token);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(path, { acceptRanges: true, headers: { 'Content-Type': 'video/mp4' } });
  }

  /** Retry failed processing (or a failed finalize) for a recording you can see. */
  @Post('recordings/:id/retry')
  @HttpCode(200)
  async retry(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const rec = await this.prisma.recording.findFirst({ where: { id, ...this.scope.recordingWhere(user) }, include: { call: true } });
    if (!rec) throw AppException.notFound('Recording');
    const canRetry = rec.processingStatus === ProcessingStatus.FAILED || rec.status === RecordingStatus.FAILED;
    if (!canRetry) throw AppException.invalidState('Only failed processing can be retried');

    await this.prisma.recording.update({
      where: { id },
      data: {
        processingStatus: ProcessingStatus.PENDING,
        lastError: null,
        // A failed finalize goes back to FINALIZING so the job redoes ffmpeg.
        ...(rec.status === RecordingStatus.FAILED ? { status: RecordingStatus.FINALIZING } : {}),
      },
    });
    await this.queue.retryProcessing(id);
    this.realtime.emitTo([rec.call.clientId, rec.call.consultantId], SocketEvent.PROCESSING_UPDATED, {
      callId: rec.callId,
      recordingId: id,
      processingStatus: ProcessingStatus.PENDING,
      lastError: null,
    });
    return { ok: true };
  }
}
