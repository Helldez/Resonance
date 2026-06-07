/** "just now" / "5m" / "3h" / "2d" / locale date — the feed's time vocabulary. */
export function formatRelative(ts: number): string {
  const deltaSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (deltaSec < 60) {
    return 'just now';
  }
  const minutes = Math.floor(deltaSec / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }
  return new Date(ts).toLocaleDateString();
}
