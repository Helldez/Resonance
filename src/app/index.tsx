import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, FlatList, Pressable, RefreshControl } from 'react-native';
import { confirmDestructive } from '@ui/confirmDestructive';
import {
  Text,
  IconButton,
  Icon,
  Card,
  Surface,
  Button,
  useTheme,
} from 'react-native-paper';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { RoomConfig } from '@core/config/RoomConfig';
import { ThemeConfig } from '@core/config/ThemeConfig';
import { formatAuthor, shortPeer } from '@domain/AuthorFormatting';
import { clamp01, interpolateColor } from '@ui/colorMath';
import type { RecordAddress, ReactionType } from '@core/domain/types';
import { publishReaction } from '@core/reactions/PublishReaction';
import { addressOf } from '@core/utils/AddressOf';
import {
  ReactionRow,
  EMPTY_REACTION_COUNTS,
  type ReactionCounts,
} from '@ui/components/ReactionRow';

interface FeedRow {
  readonly address: string;
  readonly author: string;
  readonly text: string;
  readonly similarity: number | null;
  readonly matchedOwnAddress: string | null;
  readonly createdAt: number;
}

/**
 * Flattened render units for the grouped feed. Each of the user's own posts
 * is an anchor; the remote posts that matched it (their MAX cosine) are
 * nested beneath it, most-similar first. Remote posts with no own match
 * (cold start, or a match to an own post not in view) fall into the
 * "Based on your interests" group.
 */
type FeedItem =
  | { readonly kind: 'own'; readonly row: FeedRow; readonly childCount: number }
  | { readonly kind: 'child'; readonly row: FeedRow }
  | { readonly kind: 'orphan-header'; readonly count: number }
  | { readonly kind: 'orphan'; readonly row: FeedRow };

export default function FeedScreen() {
  const container = useRequireContainer();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const threshold = useSettingsStore((s) => s.similarityThreshold);
  const receiverContext = useSettingsStore((s) => s.receiverContext);
  const displayName = useSettingsStore((s) => s.displayName);

  const [rows, setRows] = useState<FeedRow[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Addresses of own posts whose resonances are expanded. Collapsed by default
  // — the user taps the "N resonances" row to reveal the matched remote posts.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [reactions, setReactions] = useState<
    Map<string, { counts: ReactionCounts; mine: ReactionType | null }>
  >(new Map());
  const [commentCounts, setCommentCounts] = useState<Map<string, number>>(new Map());

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

  const load = useCallback(async (): Promise<void> => {
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
      await load();
    },
    [container, reactions, load],
  );

  // Group the flat rows into anchors (own posts) + their matched remote posts,
  // with a trailing "Based on your interests" group for unmatched remotes.
  const items = useMemo<FeedItem[]>(() => {
    const ownPosts: FeedRow[] = [];
    const ownAddresses = new Set<string>();
    for (const r of rows) {
      if (r.author === container.self) {
        ownPosts.push(r);
        ownAddresses.add(r.address);
      }
    }

    const childrenByOwn = new Map<string, FeedRow[]>();
    const orphans: FeedRow[] = [];
    for (const r of rows) {
      if (r.author === container.self) {
        continue;
      }
      const parent = r.matchedOwnAddress;
      if (parent !== null && ownAddresses.has(parent)) {
        const list = childrenByOwn.get(parent);
        if (list === undefined) {
          childrenByOwn.set(parent, [r]);
        } else {
          list.push(r);
        }
      } else {
        orphans.push(r);
      }
    }

    const bySimilarityDesc = (a: FeedRow, b: FeedRow): number =>
      (b.similarity ?? -Infinity) - (a.similarity ?? -Infinity);

    const out: FeedItem[] = [];
    // Own posts are already in created_at DESC order from the query.
    for (const own of ownPosts) {
      const children = (childrenByOwn.get(own.address) ?? []).sort(bySimilarityDesc);
      out.push({ kind: 'own', row: own, childCount: children.length });
      // Resonances are collapsed by default; only expanded groups emit them.
      if (expanded.has(own.address)) {
        for (const child of children) {
          out.push({ kind: 'child', row: child });
        }
      }
    }
    if (orphans.length > 0) {
      orphans.sort(bySimilarityDesc);
      out.push({ kind: 'orphan-header', count: orphans.length });
      for (const o of orphans) {
        out.push({ kind: 'orphan', row: o });
      }
    }
    return out;
  }, [rows, container.self, expanded]);

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
            {isOwn && (
              <IconButton
                icon="graph"
                size={18}
                accessibilityLabel="View this post on the semantic map"
                style={{ margin: 0 }}
                onPress={() =>
                  router.push({ pathname: '/map', params: { anchor: item.address } })
                }
              />
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
