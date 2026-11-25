#!/usr/bin/env node
// Wipes all local data (database rows and recordings), then re-seeds the demo accounts.
// Asks first; pass --yes to skip the question.
import { execSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('This deletes ALL local calls, requests and recordings. Type "reset" to continue: ');
  rl.close();
  if (answer.trim() !== 'reset') {
    console.log('Cancelled.');
    process.exit(0);
  }
}

execSync('npx prisma migrate reset --force --skip-seed', { stdio: 'inherit', cwd: join(root, 'apps/api') });
// Empty the folder but keep the folder itself: Egress has it mounted, and a deleted-and-recreated
// folder would leave Egress writing into the old (deleted) one, so every recording would fail.
const recordings = join(root, 'data/recordings');
mkdirSync(recordings, { recursive: true });
for (const entry of readdirSync(recordings)) rmSync(join(recordings, entry), { recursive: true, force: true });
execSync('npm run db:seed -w apps/api', { stdio: 'inherit', cwd: root });
console.log('\n✔ Local data reset. Demo accounts re-created.');
