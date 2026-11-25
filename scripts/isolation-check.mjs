#!/usr/bin/env node
/**
 * Process-isolation check: users keep getting fast API answers while recordings are being
 * processed, and even when the worker process is dead.
 *
 *   Phase 1  baseline API latency
 *   Phase 2  API latency while the worker processes N long synthetic recordings
 *   Phase 3  kill the worker: API still answers, /health shows worker=false
 *   Phase 4  start a replacement worker: the interrupted job is picked up and finishes
 *
 * Needs `npm run dev` running. Usage: node scripts/isolation-check.mjs [--minutes 3] [--jobs 3]
 * Uses its own temporary consultant + client (deleted at the end), so nothing appears in the demo
 * accounts' dashboards. Don't run it while recording a demo: it keeps the worker busy for a minute.
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import { mkdirSync, utimesSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(root, 'apps/api');
const require = createRequire(join(apiDir, 'package.json'));
const { Queue } = require('bullmq');
const { prisma, RECORDINGS, createTempPair } = await import('../e2e/temp-accounts.mjs');
const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');

const API = 'http://localhost:4610/api';
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const MINUTES = arg('minutes', 3);
const JOBS = arg('jobs', 3);
const queue = new Queue('processing', { connection: { url: process.env.REDIS_URL }, prefix: 'chp' });

const log = (m) => console.log(`\x1b[36m▸\x1b[0m ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(email, password) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (await r.json()).accessToken;
}

/** p50 / p95 / max of `n` alternating "raise request" + "list requests" calls, as a client would do. */
async function measure(label, token, n = 60) {
  const times = [];
  let errors = 0;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const res =
      i % 2 === 0
        ? await fetch(`${API}/requests`, {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ title: `Isolation check ${i}`, description: 'latency probe' }),
          })
        : await fetch(`${API}/requests`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) errors++;
    await res.arrayBuffer();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const pct = (p) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))].toFixed(1);
  const row = { phase: label, requests: n, errors, p50_ms: pct(50), p95_ms: pct(95), max_ms: times.at(-1).toFixed(1) };
  console.table([row]);
  return row;
}

const health = async () => (await (await fetch(`${API}/health`)).json()).checks;

/** A finished call whose composite is a long HLS recording waiting to be finalized by the worker. */
async function syntheticRecording(ids, seconds) {
  const request = await prisma.helpRequest.create({
    data: { clientId: ids.client, consultantId: ids.consultant, title: 'Isolation check (synthetic)', description: 'x', status: 'RESOLVED' },
  });
  const call = await prisma.call.create({
    data: {
      requestId: request.id,
      roomName: `call-iso-${randomUUID()}`,
      clientId: ids.client,
      consultantId: ids.consultant,
      status: 'ENDED',
      consent: 'GRANTED',
      startedAt: new Date(),
      endedAt: new Date(),
      recording: { create: { status: 'FINALIZING', processingStatus: 'PENDING', compositeStartedAt: new Date() } },
    },
    include: { recording: true },
  });
  const rec = call.recording.id;
  const dir = join(RECORDINGS, rec, 'composite');
  mkdirSync(dir, { recursive: true });
  // 720p test pattern + tone, cut into 4 s HLS segments like Egress produces.
  execFileSync(ffmpeg, [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '1500k', '-c:a', 'aac',
    '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_segment_filename', join(dir, 'seg_%05d.ts'),
    join(dir, 'index.m3u8'),
  ]);
  await prisma.recordingEgress.create({
    data: { recordingId: rec, kind: 'COMPOSITE', egressId: `EG_iso_${randomUUID()}`, status: 'ENDED', startedAt: new Date(), filePath: `${rec}/composite/index.m3u8` },
  });
  return rec;
}

const workerPids = () => {
  try {
    // The worker process itself (dev: apps/api/dist-worker/worker, prod: apps/api/dist/worker.js),
    // not the `nest start --watch` process that supervises it.
    return execSync("pgrep -f 'apps/api/dist(-worker)?/worker'").toString().trim().split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
};

async function waitFor(fn, timeoutMs, what) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await fn()) return true;
    await sleep(500);
  }
  console.log(`  (timed out waiting for ${what})`);
  return false;
}

const results = [];
// Temporary accounts: everything they create is deleted at the end (requests, calls, recordings, files).
const pair = await createTempPair('isolation');
try {
  if (!(await health()).worker) throw new Error('No worker running. Start `npm run dev` first.');
  const token = await login(pair.client.email, pair.password);
  const ids = { client: pair.client.id, consultant: pair.consultant.id };

  log('Phase 1: baseline (worker idle)');
  results.push(await measure('1. worker idle', token));

  log(`Preparing ${JOBS} synthetic ${MINUTES}-minute recordings (ffmpeg)…`);
  const recs = [];
  for (let i = 0; i < JOBS; i++) recs.push(await syntheticRecording(ids, MINUTES * 60));

  log('Phase 2: API latency while the worker processes them');
  for (const r of recs) await queue.add('process-recording', { recordingId: r }, { jobId: `rec-${r}`, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true });
  await sleep(300);
  results.push(await measure('2. worker busy', token));
  await waitFor(async () => (await prisma.recording.count({ where: { id: { in: recs }, status: 'AVAILABLE' } })) === recs.length, 300_000, 'processing');
  const done = await prisma.recording.findMany({ where: { id: { in: recs } }, select: { durationMs: true, updatedAt: true, createdAt: true } });
  console.log(`  processed ${done.length} × ${MINUTES} min recordings; finalize time each ≈ ${(done.map((d) => d.updatedAt - d.createdAt).reduce((a, b) => a + b, 0) / done.length / 1000).toFixed(1)} s (incl. queue wait)`);

  log('Phase 3: kill the worker process');
  const pids = workerPids();
  pids.forEach((p) => process.kill(p, 'SIGKILL'));
  console.log(`  killed worker pid(s): ${pids.join(', ') || 'none found'}`);
  await waitFor(async () => !(await health()).worker, 30_000, 'health.worker=false');
  console.log(`  health.worker = ${(await health()).worker}`);
  // A call ends while no worker is running: its job must wait safely in the queue.
  const extra = await syntheticRecording(ids, 60);
  await queue.add('process-recording', { recordingId: extra }, { jobId: `rec-${extra}`, attempts: 3, removeOnComplete: true });
  results.push(await measure('3. worker dead', token));
  const waiting = await prisma.recording.findUnique({ where: { id: extra } });
  console.log(`  recording queued while the worker is dead: status=${waiting.status} (waits in the queue)`);

  log('Phase 4: start a replacement worker; the waiting/interrupted job must finish');
  const replacement = spawn('node', ['dist-worker/worker.js'], { cwd: apiDir, stdio: 'ignore' });
  const t0 = Date.now();
  const finished = await waitFor(
    async () => (await prisma.recording.findUnique({ where: { id: extra } }))?.status === 'AVAILABLE',
    120_000,
    'the job to finish on the new worker',
  );
  console.log(`  job finished on the replacement worker: ${finished} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  replacement.kill('SIGTERM');
  // Nudge `npm run dev`'s worker watcher to start its own worker again.
  const now = new Date();
  utimesSync(join(apiDir, 'src/worker.ts'), now, now);

  console.log('\nSummary');
  console.table(results);
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exitCode = 1;
} finally {
  await pair
    .cleanup()
    .then((n) => console.log(`\nCleaned up the temporary accounts, their requests, ${n.calls} calls and ${n.recordings} recordings.`))
    .catch((e) => console.error(`  clean-up failed: ${e.message}`));
  await queue.close();
  await prisma.$disconnect();
}
