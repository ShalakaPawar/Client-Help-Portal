/**
 * Temporary accounts for test scripts, so they never touch the demo accounts or show up in their
 * dashboards. Each run gets its own consultant + client; cleanup() deletes them and everything they
 * created (requests, calls, recordings + their files).
 */
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(root, 'apps/api');
const require = createRequire(join(apiDir, 'package.json'));
require('dotenv').config({ path: join(apiDir, '.env'), quiet: true });
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

export const prisma = new PrismaClient();
export const RECORDINGS = join(apiDir, process.env.RECORDINGS_DIR || '../../data/recordings');

export async function createTempPair(tag) {
  const suffix = randomBytes(4).toString('hex');
  const password = `Tmp-${randomBytes(6).toString('hex')}`;
  const passwordHash = await bcrypt.hash(password, 10);
  const consultant = await prisma.user.create({
    data: { email: `${tag}-consultant-${suffix}@test.local`, name: `${tag} consultant`, role: 'CONSULTANT', passwordHash },
  });
  const client = await prisma.user.create({
    data: { email: `${tag}-client-${suffix}@test.local`, name: `${tag} client`, role: 'CLIENT', passwordHash, consultantId: consultant.id },
  });

  async function cleanup() {
    const userIds = [consultant.id, client.id];
    const calls = await prisma.call.findMany({ where: { OR: [{ clientId: { in: userIds } }, { consultantId: { in: userIds } }] }, select: { id: true } });
    const recordings = await prisma.recording.findMany({ where: { callId: { in: calls.map((c) => c.id) } }, select: { id: true } });
    await prisma.recording.deleteMany({ where: { id: { in: recordings.map((r) => r.id) } } });
    await prisma.call.deleteMany({ where: { id: { in: calls.map((c) => c.id) } } });
    await prisma.helpRequest.deleteMany({ where: { OR: [{ clientId: { in: userIds } }, { consultantId: { in: userIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: [client.id, consultant.id] } } });
    for (const r of recordings) rmSync(join(RECORDINGS, r.id), { recursive: true, force: true });
    return { calls: calls.length, recordings: recordings.length };
  }

  return { consultant, client, password, cleanup };
}
