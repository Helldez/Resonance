import type { ILogger, LogLevel } from '@core/ports/ILogger';

export class ConsoleLogger implements ILogger {
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const line = context === undefined ? message : `${message} ${JSON.stringify(context)}`;
    if (level === 'debug') {
      console.debug(line);
    } else if (level === 'info') {
      console.info(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.error(line);
    }
  }
}
