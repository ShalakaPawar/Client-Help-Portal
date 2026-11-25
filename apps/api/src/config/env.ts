import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Environment is validated once at boot. A missing or invalid value stops the app
 * with a message naming the variable. AI keys are optional: without them the app
 * runs, and transcript/summary jobs fail with PROVIDER_NOT_CONFIGURED.
 */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4610),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  JWT_SECRET: z.string().min(16, 'run `npm run setup` to generate it'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  MEDIA_TOKEN_SECRET: z.string().min(16, 'run `npm run setup` to generate it'),
  LIVEKIT_URL: z.string().min(1).default('ws://localhost:7880'),
  LIVEKIT_API_URL: z.string().min(1).default('http://127.0.0.1:7880'),
  LIVEKIT_API_KEY: z.string().min(1, 'run `npm run setup` to generate it'),
  LIVEKIT_API_SECRET: z.string().min(1, 'run `npm run setup` to generate it'),
  RECORDINGS_DIR: z.string().default('../../data/recordings'),
  EGRESS_OUTPUT_DIR: z.string().default('/data/recordings'),
  DEEPGRAM_API_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  CLAUDE_MODEL: z.string().default('claude-opus-5-5'),
  MAX_CALL_MINUTES: z.coerce.number().int().positive().default(30),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  FFMPEG_PATH: optionalString,
});

export type AppConfig = z.infer<typeof schema> & { recordingsDirAbs: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration in apps/api/.env:\n${lines.join('\n')}`);
  }
  return { ...parsed.data, recordingsDirAbs: resolve(process.cwd(), parsed.data.RECORDINGS_DIR) };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
