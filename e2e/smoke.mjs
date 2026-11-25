#!/usr/bin/env node
/**
 * Real-media smoke test: drives two browser windows through the actual UI, LiveKit and Egress.
 *
 * Uses the installed Google Chrome (no browser download) with fake devices:
 *   - fake microphone (a beep tone) for both people
 *   - the client "shares" a demo tab, auto-selected by its title
 *
 * Prereqs: Docker services up (`npm run setup`) and `npm run dev` running.
 * Usage:   npm run e2e:smoke   (HEADED=1 to watch it)
 *          SPEECH=1 npm run e2e:smoke   (macOS: each person "speaks" a scripted support dialog
 *          generated with `say`, so Deepgram and Claude get real speech; also checks that transcript
 *          times match the video)
 *          ENDED_BY=client npm run e2e:smoke   (the client ends the call instead of the consultant)
 *          KEEP=1 npm run e2e:smoke   (keep the test accounts + call afterwards to look at them in the UI)
 *
 * It uses its own temporary consultant + client, so nothing appears in the demo accounts' dashboards,
 * and deletes them (and the call + recording) at the end. Don't run it while recording a demo: it
 * uses the machine's only recorder for its call.
 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = join(root, 'e2e', 'output');
const RECORDINGS = join(root, 'data', 'recordings');
const CHROME =
  process.env.CHROME_PATH ??
  (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const SHARED_TAB_TITLE = 'Shared Demo Screen';
const RECORD_SECONDS = Number(process.env.RECORD_SECONDS ?? 15);
const ENDED_BY = process.env.ENDED_BY === 'client' ? 'client' : 'consultant';
const { createTempPair, prisma } = await import('./temp-accounts.mjs');
const pair = await createTempPair('smoke');
const PASSWORD = pair.password;

mkdirSync(OUT, { recursive: true });
const step = (msg) => console.log(`\x1b[36m▸\x1b[0m ${msg}`);
const ok = (msg) => console.log(`  \x1b[32m✔\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`  \x1b[31m✖ ${msg}\x1b[0m`);
  process.exitCode = 1;
};

const SPEECH = !!process.env.SPEECH;
const speech = SPEECH ? makeSpeech() : null;
const baseArgs = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--auto-select-tab-capture-source-by-title=${SHARED_TAB_TITLE}`,
  '--autoplay-policy=no-user-gesture-required',
];
// One browser per person: the fake microphone file is a per-browser setting.
const launch = (audioFile) =>
  chromium.launch({
    executablePath: CHROME,
    headless: !process.env.HEADED,
    args: [...baseArgs, ...(audioFile ? [`--use-file-for-fake-audio-capture=${audioFile}`] : [])],
  });
const consultantBrowser = await launch(speech?.consultant);
const clientBrowser = await launch(speech?.client);

// Separate browsers = two separate users (like two windows/profiles).
const consultantCtx = await consultantBrowser.newContext({ viewport: { width: 1280, height: 860 } });
const clientCtx = await clientBrowser.newContext({ viewport: { width: 1280, height: 860 } });
for (const ctx of [consultantCtx, clientCtx]) await ctx.grantPermissions(['microphone'], { origin: BASE });

const consultant = await consultantCtx.newPage();
const client = await clientCtx.newPage();
const errors = [];
for (const [who, page] of [['consultant', consultant], ['client', client]]) {
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
}

// The tab the client will share: something visibly moving.
const demoTab = await clientCtx.newPage();
await demoTab.setContent(
  `<title>${SHARED_TAB_TITLE}</title><body style="margin:0;background:#1e293b;color:white;font:48px sans-serif">
   <div id=t style="padding:40px">Client's screen</div>
   <script>setInterval(()=>t.textContent='Client screen · '+new Date().toLocaleTimeString(),200)</script></body>`,
);

const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`) });

try {
  step('Log in: temporary consultant (window A) and temporary client (window B)');
  await loginPage(consultant, pair.consultant.email);
  await consultant.waitForURL('**/consultant');
  await loginPage(client, pair.client.email);
  await client.waitForURL('**/client');
  ok('both logged in, each in their own session');

  step('Client raises a request; it must appear on the consultant dashboard without a refresh');
  const title = `Smoke test ${new Date().toLocaleTimeString()}`;
  await client.fill('#title', title);
  await client.fill('#desc', 'The export button does nothing');
  await client.getByRole('button', { name: 'Raise request' }).click();
  const row = consultant.locator('li', { hasText: title });
  await row.waitFor({ timeout: 10_000 });
  ok('request appeared instantly on the consultant dashboard');

  step('Consultant starts the call; client joins');
  await row.getByRole('button', { name: 'Start call' }).click();
  await consultant.waitForURL('**/call/**');
  await client.getByRole('button', { name: 'Join call' }).click({ timeout: 10_000 });
  await client.waitForURL('**/call/**');
  await client.getByText('Connected', { exact: true }).waitFor({ timeout: 20_000 });
  await consultant.getByText('Connected', { exact: true }).waitFor({ timeout: 20_000 });
  ok('both connected to the LiveKit room');

  step('Client is asked for consent as soon as they join, and agrees');
  await client.getByRole('button', { name: 'Yes, record' }).click({ timeout: 10_000 });
  await consultant.getByText('Recording', { exact: true }).waitFor({ timeout: 30_000 });
  ok('"● Recording" shown to the consultant');

  step('Client shares a screen; consultant must see it');
  await client.getByRole('button', { name: 'Share screen' }).click();
  await client.getByText(/You are sharing your screen/).waitFor({ timeout: 15_000 });
  await consultant.waitForFunction(() => {
    const v = document.querySelector('video');
    return !!v && v.videoWidth > 0;
  }, null, { timeout: 20_000 });
  ok('consultant receives the client screen');

  step(`Talking for ${RECORD_SECONDS}s (fake mic tones) while Egress records`);
  await consultant.waitForTimeout(RECORD_SECONDS * 1000);
  await shot(consultant, '1-consultant-in-call');
  await shot(client, '2-client-in-call');

  // The composite recorder starts a headless Chrome first (~7-9 s), then writes a 4 s segment at a time.
  const recDir = newestDir(RECORDINGS);
  if (!recDir) fail('no recording folder was created in data/recordings');
  else {
    let segs = [];
    for (let i = 0; i < 20 && !segs.length; i++) {
      segs = listFiles(join(recDir, 'composite')).filter((f) => f.endsWith('.ts'));
      if (!segs.length) await consultant.waitForTimeout(1000);
    }
    segs.length ? ok(`composite video segments written DURING the call: ${segs.length}`) : fail('no composite segments after 20 s');
  }

  if (ENDED_BY === 'client') {
    step('Client ends the call (in-app dialog); both windows must leave the call page');
    await client.getByRole('button', { name: 'End call' }).first().click();
    await client.getByRole('dialog').getByRole('button', { name: 'End call' }).click();
  } else {
    step('Consultant ends the call and marks it resolved');
    await consultant.getByRole('button', { name: 'End call' }).first().click();
    await consultant.getByRole('dialog').getByRole('button', { name: /mark resolved/ }).click();
  }
  await consultant.waitForURL('**/history/**', { timeout: 15_000 });
  await client.waitForURL('**/history/**', { timeout: 15_000 });
  ok('both moved to the call history page');

  // Voice recorders move their .ogg into the folder when they finish (right after the call).
  if (recDir) {
    await consultant.waitForTimeout(3000);
    const voices = listFiles(join(recDir, 'audio')).filter((f) => f.endsWith('.ogg'));
    voices.length >= 2 ? ok(`one voice file per person: ${voices.join(', ')}`) : fail(`expected 2 voice files, found: ${voices.join(', ') || 'none'}`);
  }

  step('Waiting for background processing (video, transcript, summary)');
  const result = await consultant
    .waitForFunction(
      () => {
        const text = document.body.innerText;
        if (text.includes('Processing failed')) return 'failed: ' + (text.match(/Processing failed: (.*)/)?.[1] ?? '');
        if (/Summary\s/.test(text) && document.querySelector('video')) return 'done';
        return false;
      },
      null,
      { timeout: 120_000, polling: 1000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => 'timeout');
  await shot(consultant, '3-history');
  if (result === 'done') {
    ok('video, transcript and summary are shown');
    const lines = await consultant.locator('ol li').count();
    const overview = await consultant.locator('section', { hasText: 'Summary' }).locator('p').first().innerText();
    console.log(`  transcript lines: ${lines}\n  summary: ${overview}`);
  } else console.log(`  \x1b[33m!\x1b[0m processing result: ${result}`);

  if (recDir && existsSync(join(recDir, 'final', 'composite.mp4'))) {
    ok(`final video: ${Math.round(statSync(join(recDir, 'final', 'composite.mp4')).size / 1024)} KB`);
    if (SPEECH && result === 'done') await checkAlignment(recDir);
  }
} catch (err) {
  fail(err.message.split('\n')[0]);
  await shot(consultant, 'error-consultant').catch(() => undefined);
  await shot(client, 'error-client').catch(() => undefined);
} finally {
  if (errors.length) console.log(`  page errors:\n   ${errors.join('\n   ')}`);
  console.log(`\nScreenshots: ${OUT}`);
  await Promise.all([consultantBrowser.close(), clientBrowser.close()]);
  if (process.env.KEEP) {
    console.log(`Kept the test call. Log in as ${pair.consultant.email} / ${PASSWORD} to see it.`);
  } else {
    const n = await pair.cleanup().catch((e) => console.error(`clean-up failed: ${e.message}`));
    if (n) console.log(`Cleaned up the temporary accounts, ${n.calls} call(s) and ${n.recordings} recording(s).`);
  }
  await prisma.$disconnect();
}

/** macOS only: two voices read a short support conversation; pauses leave room for the other person. */
function makeSpeech() {
  const pause = (ms) => `[[slnc ${ms}]]`;
  const lines = {
    client: [
      'Hi Sam, thanks for joining.',
      pause(3000),
      'When I click export on the monthly report, nothing happens at all.',
      pause(4500),
      'Okay, I can see the settings icon now. I cleared the export cache.',
      pause(4000),
      'It downloaded. That fixed it, thank you so much.',
      pause(8000),
    ],
    consultant: [
      pause(2000),
      'Hi Alice, I can see your screen.',
      pause(3500),
      'Please open the settings icon at the top right and clear the export cache.',
      pause(4000),
      'Great. Now click export again.',
      pause(4000),
      'Perfect. I will also email you a short guide, and please update the app this week.',
      pause(6000),
    ],
  };
  const voices = { client: 'Samantha', consultant: 'Daniel' };
  const out = {};
  for (const who of ['client', 'consultant']) {
    out[who] = join(OUT, `${who}-speech.wav`);
    execFileSync('say', ['-v', voices[who], '-o', out[who], '--data-format=LEI16@48000', lines[who].join(' ')]);
  }
  return out;
}

async function loginPage(page, email) {
  await page.goto(`${BASE}/login`);
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
}

/**
 * Transcript ↔ video alignment: transcribe the final video's own (mixed) audio with Deepgram and
 * compare when the same sentence starts there and in our merged transcript. They should match.
 */
async function checkAlignment(recDir) {
  const require = createRequire(join(root, 'apps/api/package.json'));
  const env = require('dotenv').parse(readFileSync(join(root, 'apps/api/.env')));
  if (!env.DEEPGRAM_API_KEY) return console.log('  (alignment check skipped: no DEEPGRAM_API_KEY)');
  const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-3&language=en&utterances=true&smart_format=true', {
    method: 'POST',
    headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'Content-Type': 'video/mp4' },
    body: readFileSync(join(recDir, 'final', 'composite.mp4')),
  }).then((r) => r.json());
  const phrase = /monthly report/i;
  const inVideo = (res.results?.utterances ?? []).find((u) => phrase.test(u.transcript));
  const lines = await consultant.locator('ol li').allInnerTexts();
  const line = lines.find((l) => phrase.test(l));
  if (!inVideo || !line) return console.log('  (alignment check skipped: phrase not found in both)');
  const [m, sec] = line.trim().split(/\s+/)[0].split(':').map(Number);
  const diff = m * 60 + sec - inVideo.start;
  const msg = `transcript vs video for "monthly report": ${(m * 60 + sec).toFixed(0)} s vs ${inVideo.start.toFixed(1)} s (diff ${diff.toFixed(1)} s)`;
  Math.abs(diff) <= 2 ? ok(msg) : fail(msg);
}

function newestDir(dir) {
  if (!existsSync(dir)) return null;
  const dirs = readdirSync(dir)
    .map((d) => join(dir, d))
    .filter((d) => statSync(d).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return dirs[0] ?? null;
}

function listFiles(dir) {
  return existsSync(dir) ? readdirSync(dir) : [];
}
