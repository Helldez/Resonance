import { useCallback, useEffect, useState } from 'react';
import { View, FlatList, Alert, Pressable } from 'react-native';
import { Text, Button, Card, useTheme } from 'react-native-paper';
import { Link, useFocusEffect } from 'expo-router';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';
import { MatchingConfig } from '@core/config/MatchingConfig';
import type { RecordAddress } from '@core/domain/types';

interface InboxRow {
  readonly address: string;
  readonly author: string;
  readonly text: string;
  readonly similarity: number | null;
  readonly createdAt: number;
}

export default function InboxScreen() {
  const container = useRequireContainer();
  const theme = useTheme();
  const threshold = useSettingsStore((s) => s.similarityThreshold);
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    // Own posts have similarity NULL and are always shown. Remote posts are
    // gated by the user-tunable threshold from the Settings store.
    const data = await container.database.query<{
      address: string;
      author: string;
      text: string;
      similarity: number | null;
      created_at: number;
    }>(
      'SELECT address, author, text, similarity, created_at FROM posts WHERE author = ? OR similarity IS NULL OR similarity >= ? ORDER BY created_at DESC LIMIT 100',
      [container.self, threshold],
    );
    setRows(
      data.map((d) => ({
        address: d.address,
        author: d.author,
        text: d.text,
        similarity: d.similarity,
        createdAt: d.created_at,
      })),
    );

    // Count remote posts below threshold so we can tell the user why their
    // inbox is empty (or sparse).
    const hidden = await container.database.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM posts WHERE author != ? AND similarity IS NOT NULL AND similarity < ?',
      [container.self, threshold],
    );
    setHiddenCount(hidden[0]?.n ?? 0);
  }, [container, threshold]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
      // Auto-refresh while the Inbox is focused so newly-replicated posts
      // surface without the user having to navigate away and back.
      const id = setInterval(() => {
        void load();
      }, MatchingConfig.uiRefreshIntervalMs);
      return () => {
        clearInterval(id);
      };
    }, [load]),
  );

  const askDelete = useCallback(
    (address: string, isOwn: boolean) => {
      const detail = isOwn
        ? 'Removes the post from your local DB. Peers who already replicated it still have a copy in their Hypercore.'
        : 'Removes from your inbox. The author still has it; it may show again on next replication if the threshold allows.';
      Alert.alert('Delete this post?', detail, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await container.posts.delete(address as RecordAddress);
              await load();
            })();
          },
        },
      ]);
    },
    [container, load],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <Link href="/compose" asChild>
          <Button mode="contained">New post</Button>
        </Link>
        <Link href="/settings" asChild>
          <Button mode="outlined">Settings</Button>
        </Link>
      </View>

      {hiddenCount > 0 && (
        <Text style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>
          {hiddenCount === 1
            ? '1 post hidden by your similarity threshold. Lower it in Settings to see it.'
            : `${hiddenCount} posts hidden by your similarity threshold. Lower it in Settings to see them.`}
        </Text>
      )}

      {rows.length === 0 ? (
        <Text style={{ opacity: 0.6, marginTop: 24, textAlign: 'center' }}>
          No posts yet. Tap "New post" to write your first one — it will be
          embedded on-device and broadcast to peers in the same semantic
          bucket.
        </Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(it) => it.address}
          renderItem={({ item }) => {
            const isOwn = item.author === container.self;
            const sim = item.similarity;
            const meta = isOwn
              ? 'your post'
              : `from ${shortPeer(item.author)}${sim !== null ? ` · sim ${sim.toFixed(2)}` : ''}`;
            return (
              <Link
                href={{ pathname: '/thread/[id]', params: { id: item.address } }}
                asChild
              >
                <Pressable onLongPress={() => askDelete(item.address, isOwn)}>
                  <Card style={{ marginBottom: 8 }}>
                    <Card.Content>
                      <Text numberOfLines={3}>{item.text}</Text>
                      <Text style={{ marginTop: 4, opacity: 0.6, fontSize: 12 }}>
                        {meta}
                        {' · '}
                        {new Date(item.createdAt).toLocaleString()}
                        {' · long-press to delete'}
                      </Text>
                    </Card.Content>
                  </Card>
                </Pressable>
              </Link>
            );
          }}
        />
      )}
    </View>
  );
}

function shortPeer(peer: string): string {
  if (peer.length <= 12) {
    return peer;
  }
  return `${peer.slice(0, 6)}…${peer.slice(-4)}`;
}
