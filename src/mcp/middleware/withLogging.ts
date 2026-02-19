import { randomUUID } from 'node:crypto';
import { createLogger } from '../../logger/index.js';

const log = createLogger('mcp-tools');

export function withLogging<TArgs, TResult>(
  toolName: string,
  handler: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs): Promise<TResult> => {
    const correlationId = randomUUID();
    const start = performance.now();

    log.info({ correlationId, toolName, args }, `tool.start`);

    try {
      const result = await handler(args);
      const durationMs = Math.round(performance.now() - start);
      log.info({ correlationId, toolName, durationMs }, `tool.success`);
      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);
      log.error({ correlationId, toolName, durationMs, error }, `tool.error`);
      throw error;
    }
  };
}
