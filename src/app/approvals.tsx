import { useCallback, useState } from 'react';
import { View, ScrollView, RefreshControl } from 'react-native';
import {
  Text,
  Card,
  Button,
  Chip,
  useTheme,
  ActivityIndicator,
} from 'react-native-paper';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireContainer } from '@ui/AppContainerContext';
import { appendOwnEmbedding, rescoreInboxAgainstOwnPosts } from '@services/NetworkIngestion';
import type { PendingAction } from '@data/PendingActionRepository';
import type { ReactionType, RecordAddress } from '@core/domain/types';
import { createPost } from '@core/posts/CreatePost';
import { publishResponse } from '@core/responses/PublishResponse';
import { publishReaction } from '@core/reactions/PublishReaction';
import { addressOf } from '@core/utils/AddressOf';
import { AgentConfig } from '@core/config/AgentConfig';

/**
 * The "To approve" queue (Suggest mode). Each item is a draft the agent
 * prepared; the user approves (which publishes it through the same use cases a
 * human action uses) or dismisses (which deletes it). Nothing here was ever
 * published autonomously.
 */
export default function ApprovalsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const container = useRequireContainer();
  const [items, setItems] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setItems(await container.pending.list());
    setLoading(false);
  }, [container]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const publishDeps = {
    mailbox: container.mailbox,
    network: container.network,
    identity: container.identity,
    clock: container.clock,
    self: container.self,
  };

  const approve = useCallback(
    async (item: PendingAction): Promise<void> => {
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
        await load();
      } finally {
        setBusy(null);
      }
    },
    [container, load],
  );

  const dismiss = useCallback(
    async (item: PendingAction): Promise<void> => {
      setBusy(item.id);
      try {
        await container.pending.delete(item.id);
        await load();
      } finally {
        setBusy(null);
      }
    },
    [container, load],
  );

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24 }}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={theme.colors.primary} />
      }
    >
      {items.length === 0 && (
        <Text style={{ opacity: 0.6, marginTop: 24, textAlign: 'center', color: theme.colors.onSurfaceVariant }}>
          Nothing to approve. When your agent (in Suggest mode) drafts something,
          it shows up here for your review.
        </Text>
      )}

      {items.map((item) => (
        <Card key={item.id} mode="contained" style={{ marginBottom: 10, backgroundColor: theme.colors.surface }}>
          <Card.Content>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 6 }}>
              <Chip compact icon={iconFor(item.kind)}>{labelFor(item)}</Chip>
            </View>
            {item.text.length > 0 && (
              <Text style={{ color: theme.colors.onSurface }}>{item.text}</Text>
            )}
            {item.rationale.length > 0 && (
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 6 }}>
                {`Why: ${item.rationale}`}
              </Text>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <Button mode="text" onPress={() => void dismiss(item)} disabled={busy === item.id}>
                Dismiss
              </Button>
              <Button
                mode="contained"
                icon="send"
                onPress={() => void approve(item)}
                loading={busy === item.id}
                disabled={busy === item.id}
              >
                Approve
              </Button>
            </View>
          </Card.Content>
        </Card>
      ))}
    </ScrollView>
  );
}

function iconFor(kind: PendingAction['kind']): string {
  if (kind === 'post') {
    return 'pencil';
  }
  if (kind === 'react') {
    return 'thumb-up-outline';
  }
  return 'comment-outline';
}

function labelFor(item: PendingAction): string {
  if (item.kind === 'post') {
    return 'New post';
  }
  if (item.kind === 'react') {
    return `React: ${item.reaction ?? ''}`;
  }
  return 'Reply';
}
