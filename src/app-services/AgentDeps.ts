import type { PlatformContainer } from '@platform/PlatformContainer';
import type { RecordAddress, SignedRecord } from '@core/domain/types';
import type { AgentProfile } from '@core/agent/AgentProfile';
import type { AgentCandidate, AgentLoopDeps } from '@core/agent/AgentLoop';
import { addressOf } from '@core/utils/AddressOf';
import { appendOwnEmbedding, rescoreInboxAgainstOwnPosts } from './NetworkIngestion';

/**
 * Assemble the agent loop's dependencies from the platform container. The data
 * callbacks below are the only place the loop touches SQLite; the loop itself
 * stays pure and testable. `persistOwn` mirrors `persistRecord`'s own-record
 * handling, because the worker does not echo our own appends back to us.
 */
export function buildAgentDeps(
  c: PlatformContainer,
  profile: AgentProfile,
  killSwitch: boolean,
): AgentLoopDeps {
  return {
    llm: c.llm,
    embedder: c.embedder,
    mailbox: c.mailbox,
    network: c.network,
    identity: c.identity,
    clock: c.clock,
    self: c.self,
    profile,
    killSwitch,
    activity: c.agentActivity,
    pending: c.pending,
    logSink: {
      log: (phase, summary, target, text, refText) =>
        c.agentLog.append(
          c.clock.now(),
          phase,
          summary,
          target ?? null,
          text ?? null,
          refText ?? null,
        ),
    },
    listCandidates: async (limit: number): Promise<AgentCandidate[]> => {
      const rows = await c.database.query<{
        address: string;
        text: string;
        similarity: number | null;
      }>(
        `SELECT address, text, similarity FROM posts
         WHERE author != ?
           AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.in_reply_to = posts.address AND r.author = ?)
           AND NOT EXISTS (SELECT 1 FROM reactions x WHERE x.in_reply_to = posts.address AND x.author = ?)
           AND NOT EXISTS (SELECT 1 FROM agent_pending p WHERE p.target = posts.address)
           AND NOT EXISTS (SELECT 1 FROM agent_skipped s WHERE s.target = posts.address)
         ORDER BY created_at DESC
         LIMIT ?`,
        [c.self, c.self, c.self, limit],
      );
      return rows.map((r) => ({
        address: r.address as RecordAddress,
        text: r.text,
        similarity: r.similarity,
      }));
    },
    listReplyCandidates: async (limit: number): Promise<AgentCandidate[]> => {
      // Posts the user is part of (their own, or ones the agent replied to)
      // that carry an unanswered peer comment — the latest response is not the
      // agent's — and where the agent is still under the per-thread turn cap.
      const rows = await c.database.query<{ address: string; text: string }>(
        `SELECT p.address AS address, p.text AS text
         FROM posts p
         WHERE (
                 p.author = ?
                 OR EXISTS (SELECT 1 FROM responses rs WHERE rs.in_reply_to = p.address AND rs.author = ?)
               )
           AND EXISTS (SELECT 1 FROM responses rp WHERE rp.in_reply_to = p.address AND rp.author != ?)
           AND (
                 SELECT r3.author FROM responses r3
                 WHERE r3.in_reply_to = p.address
                 ORDER BY r3.created_at DESC LIMIT 1
               ) != ?
           AND (
                 SELECT COUNT(*) FROM responses rt WHERE rt.in_reply_to = p.address AND rt.author = ?
               ) < ?
         ORDER BY (
           SELECT MAX(rm.created_at) FROM responses rm WHERE rm.in_reply_to = p.address
         ) DESC
         LIMIT ?`,
        [c.self, c.self, c.self, c.self, c.self, profile.limits.maxTurnsPerThread, limit],
      );
      // similarity is irrelevant for replies — these run in the respond band.
      return rows.map((r) => ({
        address: r.address as RecordAddress,
        text: r.text,
        similarity: null,
      }));
    },
    getThreadContext: async (target: RecordAddress): Promise<string | null> => {
      const resp = await c.database.query<{ author: string; text: string }>(
        'SELECT author, text FROM responses WHERE in_reply_to = ? ORDER BY created_at ASC LIMIT 8',
        [target],
      );
      if (resp.length === 0) {
        return null;
      }
      return resp.map((r) => `${r.author === c.self ? 'you' : 'peer'}: ${r.text}`).join('\n');
    },
    getRecentThreadTexts: async (target: RecordAddress, limit: number): Promise<string[]> => {
      const rows = await c.database.query<{ text: string }>(
        'SELECT text FROM responses WHERE in_reply_to = ? ORDER BY created_at DESC LIMIT ?',
        [target, limit],
      );
      return rows.map((r) => r.text);
    },
    countAgentTurnsInThread: async (target: RecordAddress): Promise<number> => {
      const rows = await c.database.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM responses WHERE in_reply_to = ? AND author = ?',
        [target, c.self],
      );
      return rows[0]?.n ?? 0;
    },
    lastInThreadIsSelfNoHuman: async (target: RecordAddress): Promise<boolean> => {
      const rows = await c.database.query<{ author: string }>(
        'SELECT author FROM responses WHERE in_reply_to = ? ORDER BY created_at DESC LIMIT 1',
        [target],
      );
      return rows.length > 0 && rows[0].author === c.self;
    },
    persistOwn: async (record: SignedRecord): Promise<void> => {
      const address = addressOf(record.author, record.feedIndex);
      if (record.body.kind === 'post') {
        await c.posts.upsert(address, record.author, record.feedIndex, record.body, null);
        // Mirror the manual-publish path (compose.tsx): add the agent's own post
        // to the live matching basis so incoming peers group under it instead of
        // landing in "Based on your interests", and re-group already-received
        // posts — without waiting for an app restart to reload from the DB.
        appendOwnEmbedding(address, record.body.embedding);
        void rescoreInboxAgainstOwnPosts(c).catch(() => {
          /* best-effort: never crash the agent loop on a rescore failure */
        });
      } else if (record.body.kind === 'reaction') {
        await c.reactions.applyFromRecord(address, record.author, record.feedIndex, record.body);
      } else {
        await c.responses.upsert(address, record.author, record.feedIndex, record.body);
      }
    },
  };
}
