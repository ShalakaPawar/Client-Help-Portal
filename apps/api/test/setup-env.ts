// Test environment: a separate database (portal_test), a separate Redis key prefix,
// and dummy secrets. LiveKit and the AI providers are replaced by test doubles.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://portal:portal@127.0.0.1:5433/portal_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef';
process.env.MEDIA_TOKEN_SECRET = 'test-media-secret-0123456789abcdef';
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret';
process.env.LOGIN_RATE_LIMIT_PER_MINUTE = '1000';
process.env.RECORDINGS_DIR = mkdtempSync(join(tmpdir(), 'chp-test-'));
delete process.env.DEEPGRAM_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
