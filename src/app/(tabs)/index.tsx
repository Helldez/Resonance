import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';
import { useAgentProfileStore } from '@domain/AgentProfileStore';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { formatAuthor, shortPeer } from '@domain/AuthorFormatting';
import { groupFeed, type FeedRow } from '@ui/feed/groupFeed';
import { useFeed } from '@ui/feed/useFeed';
import { useReactions } from '@ui/feed/useReactions';
import { formatRelative } from '@ui/format/relativeTime';
import {
  ActionBar,
  Avatar,
  Button,
  EmptyState,
  Icon,
  Row,
  Text,
} from '@ui/design-system';

/**
 * Home — the X-style timeline. The user's own posts anchor their matched
 * resonances (collapsed behind an inline expander); unmatched remotes land
 * under "Based on your interests". Empty states explain themselves with the
 * Tier-1 numbers instead of dead-ending.
 */
export default function FeedScreen() {
  const container = useRequireContainer();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const threshold = useSettingsStore((s) => s.similarityThreshold);
  const receiverContext = useSettingsStore((s) => s.receiverContext);
  const displayName = useSettingsStore((s) => s.displayName);
  const agentProfile = useAgentProfileStore((s) => s.profile);

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

  const { rows, hiddenCount, seenCount, refreshing, reactions, commentCounts, reload, onPullRefresh } =
    useFeed(container, threshold);
  const { reactTo, askDelete } = useReactions(container, reactions, reload);

  const items = useMemo(
    () => groupFeed(rows, container.self, expanded),
    [rows, container.self, expanded],
  );

  const aboutEmpty = receiverContext.trim().length === 0;
  const hasOwnPosts = rows.some((r) => r.author === container.self);

  const openThread = (address: string): void => {
    router.push({ pathname: '/thread/[id]', params: { id: address } });
  };

  const renderPost = (item: FeedRow, inset: boolean) => {
    const isOwn = item.author === container.self;
    const authorLabel = isOwn
      ? formatAuthor({ self: container.self, peer: container.self, selfDisplayName: displayName })
      : shortPeer(item.author);
    return (
      <Row
        inset={inset}
        left={
          <Avatar
            peerId={item.author}
            label={isOwn ? displayName : undefined}
            size={inset ? T.size.avatarSmall + T.space.sm : T.size.avatar}
          />
        }
        onPress={() => openThread(item.address)}
        onLongPress={() => askDelete(item.address, isOwn)}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
          <Text variant="bodyBold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {authorLabel}
          </Text>
          <Text variant="small">{formatRelative(item.createdAt)}</Text>
          <View style={{ flex: 1 }} />
          {!isOwn && item.similarity !== null && (
            <Text variant="caption" color={T.color.accent}>
              {`${Math.round(item.similarity * 100)}% match`}
            </Text>
          )}
        </View>
        <Text variant="body" numberOfLines={4} style={{ marginTop: T.space.xxs }}>
          {item.text}
        </Text>
        <ActionBar
          likeCount={reactions.get(item.address)?.counts.like ?? 0}
          liked={reactions.get(item.address)?.mine === 'like'}
          onLike={() => void reactTo(item.address, 'like')}
          commentCount={commentCounts.get(item.address) ?? 0}
          onComment={() => openThread(item.address)}
        />
      </Row>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: T.color.bg }}>
      {/* Home header: the mark, like X's logo bar. */}
      <View
        style={{
          paddingTop: insets.top,
          height: T.size.topBarHeight + insets.top,
          alignItems: 'center',
          justifyContent: 'center',
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: T.color.border,
        }}
      >
        <Icon name="resonance" size={T.size.iconLarge} color={T.color.accent} />
      </View>

      <FlatList
        data={items}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void onPullRefresh();
            }}
            tintColor={T.color.accent}
          />
        }
        keyExtractor={(it) =>
          it.kind === 'orphan-header' ? 'orphan-header' : `${it.kind}-${it.row.address}`
        }
        ListHeaderComponent={
          <View>
            {aboutEmpty && rows.length > 0 && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: T.space.md,
                  paddingHorizontal: T.space.lg,
                  paddingVertical: T.space.md,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: T.color.border,
                }}
              >
                <Icon name="user" size={T.size.icon} color={T.color.accent} />
                <Text variant="small" style={{ flex: 1 }}>
                  Set “About you” so your inbox starts with the things closest
                  to you.
                </Text>
                <Button
                  label="Set it"
                  small
                  variant="secondary"
                  onPress={() => router.push('/settings')}
                />
              </View>
            )}
            {hiddenCount > 0 && (
              <Pressable onPress={() => router.push('/settings')}>
                <Text
                  variant="caption"
                  style={{ paddingHorizontal: T.space.lg, paddingVertical: T.space.sm }}
                >
                  {hiddenCount === 1
                    ? '1 post hidden by your similarity threshold — tap to adjust.'
                    : `${hiddenCount} posts hidden by your similarity threshold — tap to adjust.`}
                </Text>
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          aboutEmpty && !hasOwnPosts ? (
            <View>
              <EmptyState
                icon="resonance"
                title="Your feed builds itself from what you write"
                body="There is no follow button. Write a post — or describe yourself — and the posts that resonate with it find you."
                actionLabel="Write your first post"
                onAction={() => router.push('/compose')}
              />
              <View style={{ alignItems: 'center' }}>
                <Button
                  label="Or set “About you”"
                  variant="ghost"
                  onPress={() => router.push('/settings')}
                />
              </View>
            </View>
          ) : (
            <View>
              <EmptyState
                icon="search"
                title="Listening to the network…"
                body={
                  seenCount > 0
                    ? `${seenCount} ${seenCount === 1 ? 'post' : 'posts'} seen so far — none close enough to your interests yet. Lower the threshold, or explore the Atlas.`
                    : 'No announcements received yet. Leave the app open while peers connect.'
                }
                actionLabel={seenCount > 0 ? 'Adjust threshold' : undefined}
                onAction={seenCount > 0 ? () => router.push('/settings') : undefined}
              />
              {agentProfile.enabled && agentProfile.autonomy !== 'off' && (
                <View style={{ alignItems: 'center', marginTop: T.space.sm }}>
                  <Text variant="caption">Your agent is reading for you — check the ⚡ tab.</Text>
                </View>
              )}
            </View>
          )
        }
        renderItem={({ item }) => {
          switch (item.kind) {
            case 'own': {
              const isExpanded = expanded.has(item.row.address);
              return (
                <View>
                  {renderPost(item.row, false)}
                  {item.childCount > 0 && (
                    <Pressable
                      onPress={() => toggleExpanded(item.row.address)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        isExpanded
                          ? `Hide ${item.childCount} resonances`
                          : `Show ${item.childCount} resonances`
                      }
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: T.space.xs,
                        paddingHorizontal: T.space.lg + T.size.avatar + T.space.md,
                        paddingVertical: T.space.sm,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: T.color.border,
                        backgroundColor: pressed ? T.color.bgPressed : 'transparent',
                      })}
                    >
                      <Icon
                        name={isExpanded ? 'chevron-down' : 'chevron-right'}
                        size={T.size.iconSmall}
                        color={T.color.accent}
                      />
                      <Text variant="label" color={T.color.accent}>
                        {item.childCount === 1 ? 'Show 1 resonance' : `Show ${item.childCount} resonances`}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            }
            case 'child':
              return renderPost(item.row, true);
            case 'orphan-header':
              return (
                <View
                  style={{
                    paddingHorizontal: T.space.lg,
                    paddingTop: T.space.lg,
                    paddingBottom: T.space.sm,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: T.color.border,
                  }}
                >
                  <Text variant="heading">Based on your interests</Text>
                  <Text variant="small" style={{ marginTop: T.space.xxs }}>
                    Close to your “About you” — write a post on the topic to
                    anchor them.
                  </Text>
                </View>
              );
            case 'orphan':
              return renderPost(item.row, false);
            default:
              return null;
          }
        }}
        contentContainerStyle={{ paddingBottom: insets.bottom + T.size.touchTarget + T.space.xxxl }}
      />

      {/* Compose FAB, X-style: accent circle above the tab bar. */}
      <Pressable
        onPress={() => router.push('/compose')}
        accessibilityRole="button"
        accessibilityLabel="Write a post"
        style={({ pressed }) => ({
          position: 'absolute',
          right: T.space.lg,
          bottom: insets.bottom + T.space.lg,
          width: 56,
          height: 56,
          borderRadius: T.radius.pill,
          backgroundColor: T.color.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Icon name="plus" size={T.size.iconLarge} color={T.color.accentText} />
      </Pressable>
    </View>
  );
}
