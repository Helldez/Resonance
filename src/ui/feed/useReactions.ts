import { useCallback } from 'react';
import type { PlatformContainer } from '@platform/PlatformContainer';
import type { RecordAddress, ReactionType } from '@core/domain/types';
import { publishReaction } from '@core/reactions/PublishReaction';
import { addressOf } from '@core/utils/AddressOf';
import { confirmDestructive } from '@ui/confirmDestructive';
import type { ReactionState } from './useFeed';

export interface FeedActions {
  /** Toggle my reaction on `target` (re-tapping the active one clears it). */
  reactTo(target: string, type: ReactionType): Promise<void>;
  /** Confirm-then-delete a post from the local DB. */
  askDelete(address: string, isOwn: boolean): void;
}

/**
 * User actions on feed posts: optimistic-free reaction publishing through
 * the room (record + local projection) and confirmed local deletes. Both
 * call `reload` so the screen reflects the new state immediately.
 */
export function useReactions(
  container: PlatformContainer,
  reactions: ReadonlyMap<string, ReactionState>,
  reload: () => Promise<void>,
): FeedActions {
  const reactTo = useCallback(
    async (target: string, type: ReactionType): Promise<void> => {
      const mine = reactions.get(target)?.mine ?? null;
      if (mine === type) {
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

  const askDelete = useCallback(
    (address: string, isOwn: boolean) => {
      const detail = isOwn
        ? 'Removes the post from your local DB. Peers who already replicated it still have a copy in their Hypercore.'
        : 'Removes from your feed. The author still has it; it may show again on next replication if the threshold allows.';
      confirmDestructive('Delete this post?', detail, () => {
        void (async () => {
          await container.posts.delete(address as RecordAddress);
          await reload();
        })();
      });
    },
    [container, reload],
  );

  return { reactTo, askDelete };
}
