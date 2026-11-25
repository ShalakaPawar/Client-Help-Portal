/**
 * Idempotent seed: safe to run any number of times.
 *   admin@demo.com       (Admin)           manages consultants + client assignments only
 *   consultant@demo.com  (Sam Consultant)  -> client1, client2, client3  (default consultant for new signups)
 *   consultant2@demo.com (Riya Consultant) -> client4  (only used to prove data isolation)
 * Password for everyone: Demo1234!
 */
import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

export const DEMO_PASSWORD = 'Demo1234!';

export const DEMO_USERS = [
  { email: 'admin@demo.com', name: 'Admin', role: Role.ADMIN, consultant: null },
  { email: 'consultant@demo.com', name: 'Sam Consultant', role: Role.CONSULTANT, consultant: null },
  { email: 'consultant2@demo.com', name: 'Riya Consultant', role: Role.CONSULTANT, consultant: null },
  { email: 'client1@demo.com', name: 'Alice Client', role: Role.CLIENT, consultant: 'consultant@demo.com' },
  { email: 'client2@demo.com', name: 'Bob Client', role: Role.CLIENT, consultant: 'consultant@demo.com' },
  { email: 'client3@demo.com', name: 'Carol Client', role: Role.CLIENT, consultant: 'consultant@demo.com' },
  { email: 'client4@demo.com', name: 'Dan Client', role: Role.CLIENT, consultant: 'consultant2@demo.com' },
] as const;

export async function seed(prisma: PrismaClient) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const ids: Record<string, string> = {};
  // Consultants first, so clients can point at them.
  const consultantsFirst = [...DEMO_USERS].sort((a, b) => Number(a.role === Role.CLIENT) - Number(b.role === Role.CLIENT));
  for (const u of consultantsFirst) {
    const consultantId = u.consultant ? ids[u.consultant] : null;
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, name: u.name, role: u.role, passwordHash, consultantId },
      update: { name: u.name, role: u.role, consultantId },
    });
    ids[u.email] = user.id;
  }
  // New client signups go to the default consultant. Only set it if the admin hasn't chosen one.
  const hasDefault = await prisma.user.count({ where: { role: Role.CONSULTANT, isDefaultConsultant: true } });
  if (!hasDefault) await prisma.user.update({ where: { email: 'consultant@demo.com' }, data: { isDefaultConsultant: true } });
  return ids;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then((ids) => console.log(`  seeded ${Object.keys(ids).length} demo users (password: ${DEMO_PASSWORD})`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
