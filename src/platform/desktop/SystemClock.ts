import type { IClock } from '@core/ports/IClock';

export class SystemClock implements IClock {
  now(): number {
    return Date.now();
  }
}
