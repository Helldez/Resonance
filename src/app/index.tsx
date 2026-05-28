import { useCallback, useEffect, useState } from 'react';
import { View, FlatList, Pressable, RefreshControl } from 'react-native';
import { confirmDestructive } from '@ui/confirmDestructive';
import {
  Text,
  IconButton,
  Card,
  Surface,
  Button,
  useTheme,
} from 'react-native-paper';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { ThemeConfig } from '@core/config/ThemeConfig';
import { formatAuthor, shortPeer } from '@domain/AuthorFormatting';
import { clamp01, interpolateColor } from '@ui/colorMath';
import type { RecordAddress } from '@core/domain/types';

interface FeedRow {
  readonly address: string;
  readonly author: string;
  readonly text: string;
  readonly similarity: number | null;
  readonly createdAt: number;
}

export default function FeedScreen() {
  const container = useRequireContainer();
  const router = useRouter();
  const theme = useTheme();
  const threshold = useSettingsStore((s) => s.similarityThreshold);
  const receiverContext = useSettingsStore((s) => s.receiverContext);
  const displayName = useSettingsStore((s) => s.displayName);

  const [rows, setRows] = useState<FeedRow[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
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
      const id = setInterval(() => {
        void load();
      }, MatchingConfig.uiRefreshIntervalMs);
      return () => {
        clearInterval(id);
      };
    }, [load]),
  );

  const onPullRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const askDelete = useCallback(
    (address: string, isOwn: boolean) => {
      const detail = isOwn
        ? 'Removes the post from your local DB. Peers who already replicated it still have a copy in their Hypercore.'
        : 'Removes from your feed. The author still has it; it may show again on next replication if the threshold allows.';
      confirmDestructive('Delete this post?', detail, () => {
        void (async () => {
          await container.posts.delete(address as RecordAddress);
          await load();
        })();
      });
    },
    [container, load],
  );

  const aboutEmpty = receiverContext.trim().length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Surface
        elevation={0}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: theme.colors.surface,
          borderBottomColor: theme.colors.outline,
          borderBottomWidth: 1,
        }}
      >
        <Link href="/compose" asChild>
          <Button mode="contained" icon="plus" compact>
            Post
          </Button>
        </Link>
        <View style={{ flex: 1 }} />
        <Link href="/settings" asChild>
          <IconButton icon="cog" mode="contained-tonal" accessibilityLabel="Settings" />
        </Link>
      </Surface>

      <FlatList
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
            {aboutEmpty && (
              <Card
                mode="contained"
                style={{
                  marginBottom: 12,
                  backgroundColor: theme.colors.surfaceVariant,
                }}
              >
                <Card.Content>
                  <Text variant="titleSmall" style={{ color: theme.colors.onSurface }}>
                    Tell peers what you care about
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}
                  >
                    Your "About you" routes you to peers in the same semantic
                    bucket. Without it, you bucket on a generic fallback and
                    rarely meet anyone.
                  </Text>
                  <Link href="/settings" asChild>
                    <Button
                      mode="contained-tonal"
                      style={{ marginTop: 8, alignSelf: 'flex-start' }}
                    >
                      Set About you
                    </Button>
                  </Link>
                </Card.Content>
              </Card>
            )}

            {hiddenCount > 0 && (
              <Text
                style={{
                  opacity: 0.6,
                  fontSize: 12,
                  marginBottom: 8,
                  color: theme.colors.onSurfaceVariant,
                }}
              >
                {hiddenCount === 1
                  ? '1 post hidden by your similarity threshold. Lower it in Settings to see it.'
                  : `${hiddenCount} posts hidden by your similarity threshold. Lower it in Settings to see them.`}
              </Text>
            )}

            {rows.length === 0 && (
              <Text
                style={{
                  opacity: 0.6,
                  marginTop: 24,
                  textAlign: 'center',
                  color: theme.colors.onSurfaceVariant,
                }}
              >
                No posts yet. Tap "Post" to write your first one — it will be
                embedded on-device and broadcast to peers in the same semantic
                bucket.
              </Text>
            )}
          </View>
        }
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
        data={rows}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void onPullRefresh();
            }}
            tintColor={theme.colors.primary}
          />
        }
        keyExtractor={(it) => it.address}
        renderItem={({ item }) => {
          const isOwn = item.author === container.self;
          const sim = item.similarity;
          const authorLabel = isOwn
            ? formatAuthor({
                self: container.self,
                peer: container.self,
                selfDisplayName: displayName,
              })
            : shortPeer(item.author);
          const dotColor = isOwn
            ? ThemeConfig.map.selfStarColor
            : sim !== null
              ? interpolateColor(
                  ThemeConfig.map.peerStarColorLow,
                  ThemeConfig.map.peerStarColorHigh,
                  clamp01((sim + 1) / 2),
                )
              : ThemeConfig.map.peerStarColorLow;
          const openThread = (): void => {
            router.push({
              pathname: '/thread/[id]',
              params: { id: item.address },
            });
          };
          return (
            <Card
              mode="contained"
              style={{
                marginBottom: 10,
                backgroundColor: theme.colors.surface,
              }}
            >
              <Card.Content>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <View
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: dotColor,
                      marginRight: 8,
                    }}
                  />
                  <Text
                    variant="labelMedium"
                    style={{ color: theme.colors.onSurface }}
                  >
                    {authorLabel}
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{
                      marginLeft: 8,
                      color: theme.colors.onSurfaceVariant,
                    }}
                  >
                    {formatRelative(item.createdAt)}
                  </Text>
                  <View style={{ flex: 1 }} />
                  {!isOwn && sim !== null && (
                    <Surface
                      elevation={0}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 10,
                        backgroundColor: theme.colors.surfaceVariant,
                      }}
                    >
                      <Text
                        variant="labelSmall"
                        style={{ color: theme.colors.onSurfaceVariant }}
                      >
                        {`sim ${sim.toFixed(2)}`}
                      </Text>
                    </Surface>
                  )}
                  {isOwn && (
                    <IconButton
                      icon="graph"
                      size={18}
                      accessibilityLabel="View this post on the semantic map"
                      style={{ margin: 0 }}
                      onPress={() =>
                        router.push({
                          pathname: '/map',
                          params: { anchor: item.address },
                        })
                      }
                    />
                  )}
                  <IconButton
                    icon="delete-outline"
                    size={18}
                    accessibilityLabel={
                      isOwn ? 'Delete this post' : 'Hide this post from inbox'
                    }
                    style={{ margin: 0 }}
                    onPress={() => askDelete(item.address, isOwn)}
                  />
                </View>
                <Pressable
                  onPress={openThread}
                  onLongPress={() => askDelete(item.address, isOwn)}
                >
                  <Text
                    style={{ color: theme.colors.onSurface }}
                    numberOfLines={4}
                  >
                    {item.text}
                  </Text>
                </Pressable>
              </Card.Content>
            </Card>
          );
        }}
      />
    </View>
  );
}

function formatRelative(ts: number): string {
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
