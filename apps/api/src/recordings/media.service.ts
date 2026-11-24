import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode, MediaTokenDto, RecordingStatus } from '@chp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app-exception';
import { StorageService } from '../storage/storage.service';
import { APP_CONFIG, AppConfig } from '../config/env';
import type { AuthUser } from '../common/auth.decorators';

const MEDIA_TOKEN_TTL_SECONDS = 5 * 60;

interface MediaTokenPayload {
  rid: string; // recording id
  uid: string; // who asked (for logs)
  typ: 'media';
}

/**
 * <video src> cannot send our Authorization header, so playback uses a short-lived
 * signed URL scoped to ONE recording. Access is checked when the URL is issued.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly storage: StorageService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async issueToken(user: AuthUser, recordingId: string): Promise<MediaTokenDto> {
    const recording = await this.prisma.recording.findFirst({ where: { id: recordingId, ...this.scope.recordingWhere(user) } });
    if (!recording) throw AppException.notFound('Recording');
    if (recording.status !== RecordingStatus.AVAILABLE) {
      throw AppException.invalidState('The video is not ready yet');
    }
    const payload: MediaTokenPayload = { rid: recording.id, uid: user.id, typ: 'media' };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.MEDIA_TOKEN_SECRET,
      expiresIn: MEDIA_TOKEN_TTL_SECONDS,
    });
    return {
      url: `/api/media/${token}`,
      expiresAt: new Date(Date.now() + MEDIA_TOKEN_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Returns the absolute file path for a valid token, or throws 401/404. */
  async resolve(token: string): Promise<string> {
    let payload: MediaTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<MediaTokenPayload>(token, { secret: this.config.MEDIA_TOKEN_SECRET });
    } catch {
      throw new AppException(ErrorCode.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, 'This video link has expired');
    }
    if (payload.typ !== 'media') throw AppException.notFound('Recording');
    const rel = this.storage.finalVideo(payload.rid);
    if (!(await this.storage.exists(rel))) throw AppException.notFound('Recording file');
    return this.storage.abs(rel);
  }
}
