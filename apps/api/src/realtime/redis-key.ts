import type { AppConfig } from '../config/env';

/** Redis channel prefix shared by the API's Socket.IO adapter and the worker's emitter. */
export const socketIoRedisKey = (config: Pick<AppConfig, 'NODE_ENV'>) =>
  config.NODE_ENV === 'test' ? 'chp-test#socket.io' : 'chp#socket.io';
