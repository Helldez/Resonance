import { AgentConfig } from '@core/config/AgentConfig';

/**
 * Pure helpers for the agent's bounded memory: a cheap textual dedup (so the
 * agent does not repeat itself) and the local day key used by the daily
 * counters. No embeddings — word overlap is enough to catch "the same thought
 * twice" on a small model, and avoids an extra embed call per proposal.
 */

/** Local calendar day as `YYYY-MM-DD`, used to key per-day action counters. */
export function dayKey(epochMs: number): string {
  const d = new Date(epochMs);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** True if `text` overlaps any recent output beyond the configured threshold. */
export function isDuplicate(text: string, recent: ReadonlyArray<string>): boolean {
  const a = tokenSet(text);
  if (a.size === 0) {
    return false;
  }
  for (const prev of recent) {
    if (overlapRatio(a, tokenSet(prev)) >= AgentConfig.dedupOverlapThreshold) {
      return true;
    }
  }
  return false;
}

/** Lowercased word set, split on non-alphanumeric runs via a char walk (no regex). */
function tokenSet(text: string): Set<string> {
  const out = new Set<string>();
  let current = '';
  const lower = text.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    const isWord = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    if (isWord) {
      current += ch;
    } else if (current.length > 0) {
      out.add(current);
      current = '';
    }
  }
  if (current.length > 0) {
    out.add(current);
  }
  return out;
}

/** Jaccard overlap of two token sets. */
function overlapRatio(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) {
      inter++;
    }
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
