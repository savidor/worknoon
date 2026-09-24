import { pino } from 'pino';
import { env } from '../config/env.js';

// Pretty logs are a dev convenience; fall back to JSON when pino-pretty is not installed.
const canPrettyPrint = (() => {
  try {
    import.meta.resolve('pino-pretty');
    return env.NODE_ENV === 'development';
  } catch {
    return false;
  }
})();

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'refund-desk-api' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.apiKey', '*.password'],
    censor: '[redacted]',
  },
  ...(canPrettyPrint && {
    transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
  }),
});
