import { Inject, Injectable } from '@nestjs/common';
import { existsSync, mkdirSync } from 'node:fs';
import { access, readFile, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, posix } from 'node:path';
import type { Role } from '@chp/shared';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * Knows where recording files live. Paths are always built here from ids
 * (never from user input). The same folder is mounted into the Egress container,
 * so every file has a host path and an "Egress path".
 *
 *   {recordingId}/composite/index.m3u8 + seg_*.ts   (written live by Egress)
 *   {recordingId}/audio/client-1.ogg, consultant-1.ogg ...
 *   {recordingId}/final/composite.mp4               (made after the call)
 */
@Injectable()
export class StorageService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    mkdirSync(config.recordingsDirAbs, { recursive: true });
  }

  compositeDir = (recordingId: string) => posix.join(recordingId, 'composite');
  playlist = (recordingId: string) => posix.join(recordingId, 'composite', 'index.m3u8');
  voiceFile = (recordingId: string, role: Role, pieceNo: number) =>
    posix.join(recordingId, 'audio', `${role.toLowerCase()}-${pieceNo}.ogg`);
  finalVideo = (recordingId: string) => posix.join(recordingId, 'final', 'composite.mp4');

  /** Absolute path on this machine. */
  abs(rel: string) {
    return join(this.config.recordingsDirAbs, rel);
  }

  /** Same file as seen inside the Egress container. */
  egressPath(rel: string) {
    return posix.join(this.config.EGRESS_OUTPUT_DIR, rel);
  }

  /** Create folders before Egress writes into them. */
  prepareRecordingDirs(recordingId: string) {
    for (const sub of ['composite', 'audio', 'final']) {
      const dir = this.abs(posix.join(recordingId, sub));
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o777 });
    }
  }

  async exists(rel: string) {
    try {
      const s = await stat(this.abs(rel));
      return s.size > 0;
    } catch {
      return false;
    }
  }

  readFile(rel: string) {
    return readFile(this.abs(rel));
  }

  async remove(rel: string) {
    await rm(this.abs(rel), { recursive: true, force: true });
  }

  async isWritable() {
    try {
      await access(this.config.recordingsDirAbs, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}
