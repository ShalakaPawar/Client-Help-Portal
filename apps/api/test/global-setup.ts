import { execSync } from 'node:child_process';

/** Apply migrations to the test database once before all tests. */
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://portal:portal@127.0.0.1:5433/portal_test';
  execSync('npx prisma migrate deploy', { stdio: 'ignore', env: { ...process.env, DATABASE_URL: url } });
}
