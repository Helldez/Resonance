import { useCallback, useMemo, useState } from 'react';
import { View, FlatList, Pressable, RefreshControl } from 'react-native';
import {
  Text,
  IconButton,
  Icon,
  Card,
  Surface,
  Button,
  useTheme,
} from 'react-native-paper';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';
import { ThemeConfig } from '@core/config/ThemeConfig';
import { formatAuthor, shortPeer } from '@domain/AuthorFormatting';
import { clamp01, interpolateColor } from '@ui/colorMath';
import { groupFeed, type FeedRow } from '@ui/feed/groupFeed';
import { useFeed } from '@ui/feed/useFeed';
import { useReactions } from '@ui/feed/useReactions';
import { formatRelative } from '@ui/format/relativeTime';
import { ReactionRow, EMPTY_REACTION_COUNTS } from '@ui/components/ReactionRow';

export default function FeedScreen() {
  const container = useRequireContainer();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const threshold = useSettingsStore((s) => s.similarityThreshold);
  const receiverContext = useSettingsStore((s) => s.receiverContext);
  const displayName = useSettingsStore((s) => s.displayName);

  // Addresses of own posts whose resonances are expanded. Collapsed by default
  // — the user taps the "N resonances" row to reveal the matched remote posts.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggleExpanded = useCallback((address: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.add(address);
      }
      return next;
    });
  }, []);

  const { rows, hiddenCount, refreshing, reactions, commentCounts, reload, onPullRefresh } =
    useFeed(container, threshold);
  const { reactTo, askDelete } = useReactions(container, reactions, reload);

  const items = useMemo(
    () => groupFeed(rows, container.self, expanded),
    [rows, container.self, expanded],
  );

  const aboutEmpty = receiverContext.trim().length === 0;

  const renderPostCard = (item: FeedRow) => {
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
      router.push({ pathname: '/thread/[id]', params: { id: item.address } });
    };
    return (
      <Card mode="contained" style={{ marginBottom: 10, backgroundColor: theme.colors.surface }}>
        <Card.Content>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: dotColor,
                marginRight: 8,
              }}
            />
            <Text variant="labelMedium" style={{ color: theme.colors.onSurface }}>
              {authorLabel}
            </Text>
            <Text
              variant="bodySmall"
              style={{ marginLeft: 8, color: theme.colors.onSurfaceVariant }}
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
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {`sim ${sim.toFixed(2)}`}
                </Text>
              </Surface>
            )}
            <IconButton
              icon="delete-outline"
              size={18}
              accessibilityLabel={isOwn ? 'Delete this post' : 'Hide this post from inbox'}
              style={{ margin: 0 }}
              onPress={() => askDelete(item.address, isOwn)}
            />
          </View>
          <Pressable onPress={openThread} onLongPress={() => askDelete(item.address, isOwn)}>
            <Text style={{ color: theme.colors.onSurface }} numberOfLines={4}>
              {item.text}
            </Text>
          </Pressable>
          <ReactionRow
            counts={reactions.get(item.address)?.counts ?? EMPTY_REACTION_COUNTS}
            mine={reactions.get(item.address)?.mine ?? null}
            commentCount={commentCounts.get(item.address) ?? 0}
            onReact={(t) => {
              void reactTo(item.address, t);
            }}
            onComment={openThread}
          />
        </Card.Content>
      </Card>
    );
  };

  // A remote card nested under its matched own post: a vertical connector
  // line on the left makes the "belongs to the post above" relationship clear.
  const renderNested = (item: FeedRow) => (
    <View style={{ flexDirection: 'row', marginLeft: 8 }}>
      <View
        style={{
          width: 2,
          backgroundColor: theme.colors.outlineVariant ?? theme.colors.outline,
          borderRadius: 1,
          marginRight: 10,
          marginBottom: 10,
        }}
      />
      <View style={{ flex: 1 }}>{renderPostCard(item)}</View>
    </View>
  );

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
        <Link href="/agent" asChild>
          <IconButton icon="robot-outline" mode="contained-tonal" accessibilityLabel="My agent" />
        </Link>
        <Link href="/map" asChild>
          <IconButton icon="graph" mode="contained-tonal" accessibilityLabel="Semantic map" />
        </Link>
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
                    Tell us what you care about
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}
                  >
                    Everyone shares one room. Your "About you" ranks incoming
                    posts before you've written anything, so your inbox starts
                    with the things closest to you.
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
                embedded on-device and broadcast to everyone in the room.
              </Text>
            )}
          </View>
        }
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 24 }}
        data={items}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void onPullRefresh();
            }}
            tintColor={theme.colors.primary}
          />
        }
        keyExtractor={(it) =>
          it.kind === 'orphan-header' ? 'orphan-header' : `${it.kind}-${it.row.address}`
        }
        renderItem={({ item }) => {
          switch (item.kind) {
            case 'own': {
              const isExpanded = expanded.has(item.row.address);
              return (
                <View>
                  {renderPostCard(item.row)}
                  {item.childCount > 0 && (
                    <Pressable
                      onPress={() => toggleExpanded(item.row.address)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginLeft: 12,
                        marginTop: -4,
                        marginBottom: 8,
                        paddingVertical: 4,
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        isExpanded
                          ? `Hide ${item.childCount} resonances`
                          : `Show ${item.childCount} resonances`
                      }
                    >
                      <View style={{ marginRight: 4 }}>
                        <Icon
                          source={isExpanded ? 'chevron-down' : 'chevron-right'}
                          size={18}
                          color={theme.colors.primary}
                        />
                      </View>
                      <Text
                        variant="labelSmall"
                        style={{ color: theme.colors.primary }}
                      >
                        {item.childCount === 1
                          ? '1 resonance'
                          : `${item.childCount} resonances`}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            }
            case 'child':
              return renderNested(item.row);
            case 'orphan-header':
              return (
                <View style={{ marginTop: 8, marginBottom: 8 }}>
                  <Text variant="labelLarge" style={{ color: theme.colors.onSurface }}>
                    Based on your interests
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant, marginTop: 2 }}
                  >
                    Posts close to your "About you" — they don't yet match one of
                    your own posts. Write a post on the topic to anchor them.
                  </Text>
                </View>
              );
            case 'orphan':
              return renderPostCard(item.row);
            default:
              return null;
          }
        }}
      />
    </View>
  );
}
