import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';

const isTest = process.env.NODE_ENV === 'test';

/** pino logger settings shared by the API and the worker process. */
export function loggerParams(processName: 'api' | 'worker'): Params {
  return {
    pinoHttp: {
      name: processName,
      level: isTest ? 'silent' : process.env.LOG_LEVEL || 'info',
      genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      // Media URLs carry a token in the path; don't write it to logs.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: String(req.url).replace(/\/media\/[^/?]+/, '/media/***') }),
      },
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
      transport:
        !isTest && process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
    },
  };
}
