#!/usr/bin/env node
// One-command, idempotent local setup. Safe to run again at any time.
//  1. Generate LiveKit key/secret + JWT secret (only if missing)
//  2. Write apps/api/.env (never overwrites existing values) and docker/*.yaml
//  3. Start Docker services and wait until healthy
//  4. Build the shared package, generate Prisma client, migrate, seed
//  5. Check ffmpeg and print a summary
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, 'apps/api/.env');
const envExamplePath = join(root, 'apps/api/.env.example');
const skipInfra = process.argv.includes('--skip-infra');

const log = (msg) => console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`);
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });

function readEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

// 1 + 2. Environment file
log('Preparing apps/api/.env');
const example = readFileSync(envExamplePath, 'utf8');
const current = readEnv(envPath);
const generated = {
  JWT_SECRET: current.JWT_SECRET || randomBytes(32).toString('hex'),
  MEDIA_TOKEN_SECRET: current.MEDIA_TOKEN_SECRET || randomBytes(32).toString('hex'),
  LIVEKIT_API_KEY: current.LIVEKIT_API_KEY || `API${randomBytes(6).toString('hex')}`,
  LIVEKIT_API_SECRET: current.LIVEKIT_API_SECRET || randomBytes(24).toString('base64url'),
};
const existed = existsSync(envPath);
const merged = example
  .split('\n')
  .map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) return line;
    const [, key, def] = m;
    const value = current[key] ?? generated[key] ?? def;
    return `${key}=${value}`;
  })
  .join('\n');
writeFileSync(envPath, merged);
const env = readEnv(envPath);
console.log(existed ? '  .env updated (existing values kept)' : '  .env created with generated secrets');

log('Writing docker/livekit.yaml and docker/egress.yaml');
let mediaConfigChanged = false;
for (const name of ['livekit', 'egress']) {
  const target = join(root, `docker/${name}.yaml`);
  const tpl = readFileSync(join(root, `docker/${name}.yaml.template`), 'utf8');
  const next = tpl
    .replaceAll('__LIVEKIT_API_KEY__', env.LIVEKIT_API_KEY)
    .replaceAll('__LIVEKIT_API_SECRET__', env.LIVEKIT_API_SECRET);
  const before = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (before !== next) {
    writeFileSync(target, next);
    mediaConfigChanged = true;
  }
}
mkdirSync(join(root, 'data/recordings'), { recursive: true });

// 3. Docker services
if (!skipInfra) {
  log('Starting Docker services (postgres, redis, livekit, egress)');
  try {
    run('docker info', { stdio: 'ignore' });
  } catch {
    console.error('\n✖ Docker is not running. Start Docker Desktop and run `npm run setup` again.');
    process.exit(1);
  }
  run('docker compose up -d --wait');
  // Config files are mounted, so running containers must restart to pick up new keys.
  if (mediaConfigChanged) run('docker compose up -d --wait --force-recreate livekit egress');
}

// 4. Build + database
log('Building shared package');
run('npm run build -w packages/shared');
log('Generating Prisma client and applying migrations');
run('npx prisma generate', { cwd: join(root, 'apps/api') });
run('npx prisma migrate deploy', { cwd: join(root, 'apps/api') });
log('Seeding demo accounts');
run('npm run db:seed -w apps/api');

// 5. ffmpeg check
log('Checking ffmpeg');
try {
  const ffmpegPath = env.FFMPEG_PATH || (await import('ffmpeg-static')).default;
  execSync(`"${ffmpegPath}" -version`, { stdio: 'ignore' });
  console.log(`  ffmpeg OK (${ffmpegPath})`);
} catch {
  console.warn('  ⚠ ffmpeg not found. Run `npm ci` again or set FFMPEG_PATH in apps/api/.env');
}

const missing = ['DEEPGRAM_API_KEY', 'ANTHROPIC_API_KEY'].filter((k) => !env[k]);
console.log(`
\x1b[32m✔ Setup complete\x1b[0m

  App:          http://localhost:5173   (after \`npm run dev\`)
  Queue board:  http://localhost:3000/api/admin/queues
  Accounts:     consultant@demo.com, client1@demo.com, client2@demo.com, client3@demo.com
  Password:     Demo1234!
${missing.length ? `\n  ⚠ Add ${missing.join(' and ')} to apps/api/.env to enable transcripts and summaries.` : ''}
`);
