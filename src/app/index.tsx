import { useCallback, useEffect, useState } from 'react';
import { View, FlatList } from 'react-native';
import { Text, Button, Card, useTheme } from 'react-native-paper';
import { Link, useFocusEffect } from 'expo-router';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';

interface InboxRow {
  readonly address: string;
  readonly text: string;
  readonly similarity: number | null;
  readonly createdAt: number;
}

export default function InboxScreen() {
  const container = useRequireContainer();
  const theme = useTheme();
  const threshold = useSettingsStore((s) => s.similarityThreshold);
  const [rows, setRows] = useState<InboxRow[]>([]);

  const load = useCallback(async (): Promise<void> => {
    // Own posts have similarity NULL and are always shown. Remote posts are
    // gated by the user-tunable threshold from the Settings store.
    const data = await container.database.query<{
      address: string;
      text: string;
      similarity: number | null;
      created_at: number;
    }>(
      'SELECT address, text, similarity, created_at FROM posts WHERE similarity IS NULL OR similarity >= ? ORDER BY created_at DESC LIMIT 100',
      [threshold],
    );
    setRows(
      data.map((d) => ({
        address: d.address,
        text: d.text,
        similarity: d.similarity,
        createdAt: d.created_at,
      })),
    );
  }, [container, threshold]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
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

      {rows.length === 0 ? (
        <Text style={{ opacity: 0.6, marginTop: 24, textAlign: 'center' }}>
          No posts yet. Tap "New post" to write your first one — it will be
          embedded on-device and (in M3) broadcast to peers in the same
          semantic bucket.
        </Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(it) => it.address}
          renderItem={({ item }) => (
            <Link
              href={{ pathname: '/thread/[id]', params: { id: item.address } }}
              asChild
            >
              <Card style={{ marginBottom: 8 }}>
                <Card.Content>
                  <Text numberOfLines={3}>{item.text}</Text>
                  <Text style={{ marginTop: 4, opacity: 0.6, fontSize: 12 }}>
                    {item.similarity === null
                      ? 'your post'
                      : `similarity ${item.similarity.toFixed(2)}`}
                    {' · '}
                    {new Date(item.createdAt).toLocaleString()}
                  </Text>
                </Card.Content>
              </Card>
            </Link>
          )}
        />
      )}
    </View>
  );
}
