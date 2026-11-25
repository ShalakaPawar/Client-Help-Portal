import { spawn } from 'node:child_process';
import { setPriority } from 'node:os';
import ffmpegStatic from 'ffmpeg-static';

export class FfmpegError extends Error {}

export function ffmpegBinary(override?: string): string {
  const bin = override || (ffmpegStatic as unknown as string | null);
  if (!bin) throw new FfmpegError('ffmpeg binary not found (set FFMPEG_PATH)');
  return bin;
}

/**
 * Arguments to turn the live HLS playlist into one seekable MP4 without re-encoding:
 *  -c copy               keep the H.264/AAC streams as they are (fast)
 *  -bsf:a aac_adtstoasc  AAC from MPEG-TS needs this to go into MP4
 *  -movflags +faststart  index at the start, so the browser can seek immediately
 */
export function hlsToMp4Args(playlistPath: string, outputPath: string): string[] {
  return ['-y', '-loglevel', 'error', '-i', playlistPath, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', outputPath];
}

/** Runs ffmpeg; rejects with the last lines of stderr on failure. */
export function runFfmpeg(bin: string, args: string[], timeoutMs = 10 * 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    // Lower CPU priority: a long finalize must not starve the API, LiveKit or the recorders.
    try {
      if (child.pid) setPriority(child.pid, 10);
    } catch {
      /* not permitted on this OS: run at normal priority */
    }
    let stderr = '';
    child.stderr.on('data', (d) => (stderr = (stderr + d.toString()).slice(-4000)));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new FfmpegError('ffmpeg timed out'));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new FfmpegError(`ffmpeg could not start: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new FfmpegError(`ffmpeg failed (exit ${code}): ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

/** Total duration of an HLS playlist (sum of #EXTINF values), in ms. */
export function playlistDurationMs(playlist: string): number {
  let total = 0;
  for (const m of playlist.matchAll(/#EXTINF:([\d.]+)/g)) total += parseFloat(m[1]);
  return Math.round(total * 1000);
}
