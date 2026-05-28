import type { ILogger, LogLevel } from '@core/ports/ILogger';

export class ConsoleLogger implements ILogger {
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const extra = context === undefined ? '' : ` ${JSON.stringify(context)}`;
    switch (level) {
      case 'debug':
        console.debug(message + extra);
        return;
      case 'info':
        console.info(message + extra);
        return;
      case 'warn':
        console.warn(message + extra);
        return;
      case 'error':
        console.error(message + extra);
        return;
    }
  }
}
