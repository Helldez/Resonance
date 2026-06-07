import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { PlatformContainer } from '@platform/PlatformContainer';
import type { RecordAddress, ReactionType, ScoredPost } from '@core/domain/types';
import { draftResponse } from '@core/responses/DraftResponse';
import { publishResponse } from '@core/responses/PublishResponse';
import { publishReaction } from '@core/reactions/PublishReaction';
import { cosineOnUnit } from '@core/matching/CosineSimilarity';
import { addressOf } from '@core/utils/AddressOf';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { EMPTY_REACTION_COUNTS, type ReactionCounts } from '@ui/reactionCounts';

export interface ThreadPost {
  readonly address: string;
  readonly author: string;
  readonly text: string;
  readonly createdAt: number;
  readonly embedding: Uint8Array | null;
}

export interface ThreadResponse {
  readonly address: string;
  readonly author: string;
  readonly text: string;
  readonly createdAt: number;
}

export interface ReactionEntry {
  readonly counts: ReactionCounts;
  readonly mine: ReactionType | null;
}

export interface Thread {
  readonly post: ThreadPost | null;
  readonly responses: ThreadResponse[];
  readonly reactions: ReadonlyMap<string, ReactionEntry>;
  readonly loading: boolean;
  reload(): Promise<void>;
  reactTo(target: string, type: ReactionType): Promise<void>;
  deleteResponse(address: string): Promise<void>;
  /** Publish `text` as a reply to the root post. Throws on the per-post cap. */
  publishReply(text: string): Promise<void>;
  /** LLM-draft a reply to the root post. Throws if no embedding/model. */
  draftWithAi(receiverContext: string): Promise<string>;
}

/**
 * Thread data + actions: the root post, its responses, batch reaction
 * state, reaction toggling, reply publishing (with the one-response-per-
 * peer-per-post product rule) and the on-demand AI draft. The screen stays
 * presentational.
 */
export function useThread(container: PlatformContainer, id: string): Thread {
  const [post, setPost] = useState<ThreadPost | null>(null);
  const [responses, setResponses] = useState<ThreadResponse[]>([]);
  const [reactions, setReactions] = useState<Map<string, ReactionEntry>>(new Map());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    const postRows = await container.database.query<{
      address: string;
      author: string;
      text: string;
      created_at: number;
      embedding: Uint8Array | null;
    }>(
      'SELECT address, author, text, created_at, embedding FROM posts WHERE address = ? LIMIT 1',
      [id],
    );
    if (postRows.length > 0) {
      const r = postRows[0];
      setPost({
        address: r.address,
        author: r.author,
        text: r.text,
        createdAt: r.created_at,
        embedding: r.embedding,
      });
    }
    const respRows = await container.database.query<{
      address: string;
      author: string;
      text: string;
      created_at: number;
    }>(
      'SELECT address, author, text, created_at FROM responses WHERE in_reply_to = ? ORDER BY created_at ASC',
      [id],
    );
    setResponses(
      respRows.map((r) => ({
        address: r.address,
        author: r.author,
        text: r.text,
        createdAt: r.created_at,
      })),
    );

    const addresses = [id, ...respRows.map((r) => r.address)] as RecordAddress[];
    const [countRows, mineRows] = await Promise.all([
      container.reactions.countsForTargets(addresses),
      container.reactions.myReactionsForTargets(container.self, addresses),
    ]);
    const byTarget = new Map<string, ReactionEntry>();
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
    setLoading(false);
  }, [container, id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      void reload();
      const timer = setInterval(() => {
        void reload();
      }, MatchingConfig.uiRefreshIntervalMs);
      return () => {
        clearInterval(timer);
      };
    }, [reload]),
  );

  const reactTo = useCallback(
    async (target: string, type: ReactionType): Promise<void> => {
      const mine = reactions.get(target)?.mine ?? null;
      if (mine === type) {
        // Tapping your current reaction clears it locally (cross-peer retract
        // over an append-only feed is a later refinement).
        await container.reactions.clear(container.self, target as RecordAddress);
      } else {
        const record = await publishReaction(
          {
            mailbox: container.mailbox,
            network: container.network,
            identity: container.identity,
            clock: container.clock,
            self: container.self,
          },
          { inReplyTo: target as RecordAddress, reaction: type },
        );
        if (record.body.kind === 'reaction') {
          await container.reactions.applyFromRecord(
            addressOf(record.author, record.feedIndex),
            record.author,
            record.feedIndex,
            record.body,
          );
        }
      }
      await reload();
    },
    [container, reactions, reload],
  );

  const deleteResponse = useCallback(
    async (address: string): Promise<void> => {
      await container.responses.delete(address as RecordAddress);
      await reload();
    },
    [container, reload],
  );

  const publishReply = useCallback(
    async (text: string): Promise<void> => {
      if (post === null) {
        return;
      }
      const existing = await container.responses.countByAuthorAndPost(
        container.self,
        post.address as RecordAddress,
      );
      if (existing >= MatchingConfig.maxResponsesPerPeerPerPost) {
        throw new Error(
          'You already responded to this post. Delete your existing response before publishing a new one.',
        );
      }
      const record = await publishResponse(
        {
          mailbox: container.mailbox,
          network: container.network,
          identity: container.identity,
          clock: container.clock,
          self: container.self,
        },
        { text, inReplyTo: post.address as RecordAddress },
      );
      if (record.body.kind === 'response') {
        await container.responses.upsert(
          addressOf(record.author, record.feedIndex),
          record.author,
          record.feedIndex,
          record.body,
        );
      }
      await reload();
    },
    [container, post, reload],
  );

  const draftWithAi = useCallback(
    async (receiverContext: string): Promise<string> => {
      if (post === null || post.embedding === null) {
        throw new Error('Post has no embedding stored locally; cannot draft.');
      }
      const embedding = new Float32Array(
        post.embedding.buffer,
        post.embedding.byteOffset,
        post.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT,
      );
      const scored: ScoredPost = {
        address: post.address as RecordAddress,
        author: post.author as ScoredPost['author'],
        post: {
          kind: 'post',
          text: post.text,
          embedding,
          createdAt: post.createdAt,
        },
        similarity: cosineOnUnit(embedding, embedding),
      };
      const { draftText } = await draftResponse(
        { llm: container.llm },
        { post: scored, receiverContext },
      );
      return draftText;
    },
    [container, post],
  );

  return { post, responses, reactions, loading, reload, reactTo, deleteResponse, publishReply, draftWithAi };
}
