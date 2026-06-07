import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { PlatformContainer } from '@platform/PlatformContainer';
import type { PendingAction } from '@data/PendingActionRepository';
import type { ReactionType, RecordAddress } from '@core/domain/types';
import { createPost } from '@core/posts/CreatePost';
import { publishResponse } from '@core/responses/PublishResponse';
import { publishReaction } from '@core/reactions/PublishReaction';
import { addressOf } from '@core/utils/AddressOf';
import { AgentConfig } from '@core/config/AgentConfig';
import { appendOwnEmbedding, rescoreInboxAgainstOwnPosts } from '@services/NetworkIngestion';

export interface Approvals {
  readonly items: PendingAction[];
  readonly loading: boolean;
  /** Id of the item currently publishing/deleting, or null. */
  readonly busy: string | null;
  approve(item: PendingAction): Promise<void>;
  dismiss(item: PendingAction): Promise<void>;
  reload(): Promise<void>;
}

/**
 * The Suggest-mode approval queue: drafts the agent prepared, awaiting a
 * human tap. Approving publishes through the same use cases a manual action
 * uses (and records the output in the dedup ledger); dismissing deletes the
 * draft. Nothing in this queue was ever published autonomously.
 */
export function useApprovals(container: PlatformContainer): Approvals {
  const [items, setItems] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setItems(await container.pending.list());
    setLoading(false);
  }, [container]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const approve = useCallback(
    async (item: PendingAction): Promise<void> => {
      const publishDeps = {
        mailbox: container.mailbox,
        network: container.network,
        identity: container.identity,
        clock: container.clock,
        self: container.self,
      };
      setBusy(item.id);
      try {
        if (item.kind === 'post') {
          const { record } = await createPost(
            { ...publishDeps, embedder: container.embedder },
            { text: item.text },
          );
          if (record.body.kind === 'post') {
            const address = addressOf(record.author, record.feedIndex);
            await container.posts.upsert(address, record.author, record.feedIndex, record.body, null);
            appendOwnEmbedding(address as RecordAddress, record.body.embedding);
            await rescoreInboxAgainstOwnPosts(container);
          }
          await container.agentActivity.recordOutput(item.text, container.clock.now(), AgentConfig.dedupHistorySize);
        } else if (item.kind === 'respond' && item.target !== null) {
          const record = await publishResponse(publishDeps, {
            text: item.text,
            inReplyTo: item.target as RecordAddress,
          });
          if (record.body.kind === 'response') {
            await container.responses.upsert(
              addressOf(record.author, record.feedIndex),
              record.author,
              record.feedIndex,
              record.body,
            );
          }
          await container.agentActivity.recordOutput(item.text, container.clock.now(), AgentConfig.dedupHistorySize);
        } else if (item.kind === 'react' && item.target !== null && item.reaction !== null) {
          const record = await publishReaction(publishDeps, {
            inReplyTo: item.target as RecordAddress,
            reaction: item.reaction as ReactionType,
          });
          if (record.body.kind === 'reaction') {
            await container.reactions.applyFromRecord(
              addressOf(record.author, record.feedIndex),
              record.author,
              record.feedIndex,
              record.body,
            );
          }
        }
        await container.pending.delete(item.id);
        await reload();
      } finally {
        setBusy(null);
      }
    },
    [container, reload],
  );

  const dismiss = useCallback(
    async (item: PendingAction): Promise<void> => {
      setBusy(item.id);
      try {
        await container.pending.delete(item.id);
        await reload();
      } finally {
        setBusy(null);
      }
    },
    [container, reload],
  );

  return { items, loading, busy, approve, dismiss, reload };
}
