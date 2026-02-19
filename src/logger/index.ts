import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.SHIPKIT_LOG_LEVEL ?? 'info';

export const logger = pino({
  level,
  ...(!isProduction && {
    transport: {
      target: 'pino-pretty',
    },
  }),
});

export function createLogger(name: string) {
  return logger.child({ component: name });
}
