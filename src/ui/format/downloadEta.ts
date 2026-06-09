/**
 * Formats a rough ETA for an in-flight download from a simple average speed
 * (`downloaded / elapsed`). No moving-average machinery: this is a label, not
 * telemetry, and the simple average is stable enough once a little data is in.
 * Returns null until there is enough signal to avoid a wildly wrong first guess.
 */

/** Minimum elapsed time and bytes before an ETA is trustworthy enough to show. */
const MIN_ELAPSED_MS = 1_500;
const MIN_BYTES = 256 * 1024;

export function formatDownloadEta(
  downloaded: number,
  total: number,
  startedAt: number | null,
  now: number,
): string | null {
  if (startedAt === null || total <= 0 || downloaded < MIN_BYTES) {
    return null;
  }
  const elapsedMs = now - startedAt;
  if (elapsedMs < MIN_ELAPSED_MS) {
    return null;
  }
  const bytesPerMs = downloaded / elapsedMs;
  if (bytesPerMs <= 0) {
    return null;
  }
  const remainingBytes = Math.max(0, total - downloaded);
  const etaSec = Math.round(remainingBytes / bytesPerMs / 1000);
  return formatDuration(etaSec);
}

function formatDuration(totalSec: number): string {
  if (totalSec < 60) {
    return `~${totalSec}s`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return seconds === 0 ? `~${minutes}m` : `~${minutes}m ${seconds}s`;
}
