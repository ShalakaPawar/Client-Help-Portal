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
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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

mkdirSync(OUT, { recursive: true });
const step = (msg) => console.log(`\x1b[36m▸\x1b[0m ${msg}`);
const ok = (msg) => console.log(`  \x1b[32m✔\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`  \x1b[31m✖ ${msg}\x1b[0m`);
  process.exitCode = 1;
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: !process.env.HEADED,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--auto-select-tab-capture-source-by-title=${SHARED_TAB_TITLE}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

// Two separate browser contexts = two separate users (like two windows/profiles).
const consultantCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const clientCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
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
  await endLeftoverCall();
  step('Log in: Sam Consultant (window A) and Alice Client (window B)');
  await consultant.goto(`${BASE}/login`);
  await consultant.getByRole('button', { name: /Sam Consultant/ }).click();
  await consultant.waitForURL('**/consultant');
  await client.goto(`${BASE}/login`);
  await client.getByRole('button', { name: /Alice Client/ }).click();
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

  step('Consultant ends the call and marks it resolved');
  await consultant.getByRole('button', { name: 'End call' }).click();
  await consultant.getByRole('button', { name: 'Yes, mark resolved' }).click();
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
  if (result === 'done') ok('video, transcript and summary are shown');
  else console.log(`  \x1b[33m!\x1b[0m processing result: ${result}`);

  if (recDir && existsSync(join(recDir, 'final', 'composite.mp4'))) {
    ok(`final video: ${Math.round(statSync(join(recDir, 'final', 'composite.mp4')).size / 1024)} KB`);
  }
} catch (err) {
  fail(err.message.split('\n')[0]);
  await shot(consultant, 'error-consultant').catch(() => undefined);
  await shot(client, 'error-client').catch(() => undefined);
} finally {
  if (errors.length) console.log(`  page errors:\n   ${errors.join('\n   ')}`);
  console.log(`\nScreenshots: ${OUT}`);
  await browser.close();
}

/** A previous interrupted run can leave the consultant in a live call ("busy"); end it first. */
async function endLeftoverCall() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'consultant@demo.com', password: 'Demo1234!' }),
  }).then((r) => r.json());
  const headers = { authorization: `Bearer ${login.accessToken}`, 'content-type': 'application/json' };
  const { call } = await fetch(`${BASE}/api/calls/active`, { headers }).then((r) => r.json());
  if (call) {
    await fetch(`${BASE}/api/calls/${call.id}/end`, { method: 'POST', headers, body: '{}' });
    console.log(`  (ended a leftover call from an earlier run)`);
  }
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
