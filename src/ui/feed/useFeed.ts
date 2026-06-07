import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { PlatformContainer } from '@platform/PlatformContainer';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { RoomConfig } from '@core/config/RoomConfig';
import type { RecordAddress, ReactionType } from '@core/domain/types';
import { EMPTY_REACTION_COUNTS, type ReactionCounts } from '@ui/components/ReactionRow';
import type { FeedRow } from './groupFeed';

export interface ReactionState {
  readonly counts: ReactionCounts;
  readonly mine: ReactionType | null;
}

export interface FeedData {
  readonly rows: FeedRow[];
  readonly hiddenCount: number;
  /**
   * Tier-1 post announcements seen so far. Lets the empty state explain
   * WHY the feed is empty ("X seen on the network, none close enough")
   * instead of looking dead.
   */
  readonly seenCount: number;
  readonly refreshing: boolean;
  readonly reactions: ReadonlyMap<string, ReactionState>;
  readonly commentCounts: ReadonlyMap<string, number>;
  reload(): Promise<void>;
  onPullRefresh(): Promise<void>;
}

/**
 * Feed data layer: the inbox query (threshold-filtered, capacity-bounded),
 * the hidden-by-threshold count, batch reaction/comment counts (three
 * queries, no N+1 per card), focus-driven polling, and pull-to-refresh.
 * Rendering stays in the screen.
 */
export function useFeed(container: PlatformContainer, threshold: number): FeedData {
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [seenCount, setSeenCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [reactions, setReactions] = useState<Map<string, ReactionState>>(new Map());
  const [commentCounts, setCommentCounts] = useState<Map<string, number>>(new Map());

  const reload = useCallback(async (): Promise<void> => {
    const data = await container.database.query<{
      address: string;
      author: string;
      text: string;
      similarity: number | null;
      matched_own_address: string | null;
      created_at: number;
    }>(
      'SELECT address, author, text, similarity, matched_own_address, created_at FROM posts WHERE author = ? OR similarity IS NULL OR similarity >= ? ORDER BY created_at DESC LIMIT ?',
      [container.self, threshold, RoomConfig.inboxCapacity],
    );
    setRows(
      data.map((d) => ({
        address: d.address,
        author: d.author,
        text: d.text,
        similarity: d.similarity,
        matchedOwnAddress: d.matched_own_address,
        createdAt: d.created_at,
      })),
    );

    const hidden = await container.database.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM posts WHERE author != ? AND similarity IS NOT NULL AND similarity < ?',
      [container.self, threshold],
    );
    setHiddenCount(hidden[0]?.n ?? 0);

    const seen = await container.database.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM announcements WHERE kind = 'post' AND author != ?",
      [container.self],
    );
    setSeenCount(seen[0]?.n ?? 0);

    // Batch-load reaction counts + my reaction + comment counts for every
    // visible post, in three queries (no N+1 per card).
    const addresses = data.map((d) => d.address) as RecordAddress[];
    const [countRows, mineRows] = await Promise.all([
      container.reactions.countsForTargets(addresses),
      container.reactions.myReactionsForTargets(container.self, addresses),
    ]);
    const byTarget = new Map<string, { counts: ReactionCounts; mine: ReactionType | null }>();
    for (const a of addresses) {
      byTarget.set(a, { counts: { ...EMPTY_REACTION_COUNTS }, mine: null });
    }
    for (const cr of countRows) {
      const e = byTarget.get(cr.target);
      if (e !== undefined) {
        e.counts[cr.reaction] = cr.count;
      }
    }
    for (const mr of mineRows) {
      const e = byTarget.get(mr.target);
      if (e !== undefined) {
        byTarget.set(mr.target, { counts: e.counts, mine: mr.reaction });
      }
    }
    setReactions(byTarget);

    const commentRows =
      addresses.length === 0
        ? []
        : await container.database.query<{ in_reply_to: string; n: number }>(
            `SELECT in_reply_to, COUNT(*) AS n FROM responses
             WHERE in_reply_to IN (${addresses.map(() => '?').join(', ')})
             GROUP BY in_reply_to`,
            addresses,
          );
    const commentMap = new Map<string, number>();
    for (const cr of commentRows) {
      commentMap.set(cr.in_reply_to, cr.n);
    }
    setCommentCounts(commentMap);
  }, [container, threshold]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      const id = setInterval(() => {
        void reload();
      }, MatchingConfig.uiRefreshIntervalMs);
      return () => {
        clearInterval(id);
      };
    }, [reload]),
  );

  const onPullRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);

  return { rows, hiddenCount, seenCount, refreshing, reactions, commentCounts, reload, onPullRefresh };
}
