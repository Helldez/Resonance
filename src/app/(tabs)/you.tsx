import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { formatRelative } from '@ui/format/relativeTime';
import {
  Avatar,
  EmptyState,
  IconButton,
  ListGroup,
  ListRow,
  Row,
  Text,
  TopBar,
} from '@ui/design-system';

interface OwnPost {
  readonly address: string;
  readonly text: string;
  readonly createdAt: number;
}

/**
 * The "You" tab: local identity (avatar, display name, fingerprint), your
 * own posts, and the doorway to Settings. There is no public profile —
 * everything here is what *you* see about yourself.
 */
export default function YouScreen() {
  const container = useRequireContainer();
  const router = useRouter();
  const displayName = useSettingsStore((s) => s.displayName);
  const [posts, setPosts] = useState<OwnPost[]>([]);

  const load = useCallback(async (): Promise<void> => {
    const rows = await container.database.query<{
      address: string;
      text: string;
      created_at: number;
    }>(
      'SELECT address, text, created_at FROM posts WHERE author = ? ORDER BY created_at DESC',
      [container.self],
    );
    setPosts(rows.map((r) => ({ address: r.address, text: r.text, createdAt: r.created_at })));
  }, [container]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const name = displayName.trim().length > 0 ? displayName : 'You';
  const fingerprint = `${container.self.slice(0, 12)}…${container.self.slice(-6)}`;

  return (
    <View style={{ flex: 1, backgroundColor: T.color.bg }}>
      <TopBar
        title="You"
        right={
          <IconButton
            icon="settings"
            accessibilityLabel="Settings"
            onPress={() => router.push('/settings')}
          />
        }
      />
      <FlatList
        data={posts}
        keyExtractor={(p) => p.address}
        ListHeaderComponent={
          <View>
            <View
              style={{
                alignItems: 'center',
                paddingVertical: T.space.xxl,
                gap: T.space.sm,
              }}
            >
              <Avatar peerId={container.self} label={displayName} size={T.size.avatarLarge} />
              <Text variant="title">{name}</Text>
              <Text variant="caption">{fingerprint}</Text>
            </View>
            <ListGroup>
              <ListRow
                label="Settings"
                icon="settings"
                chevron
                onPress={() => router.push('/settings')}
              />
            </ListGroup>
            <ListGroup title={`Your posts (${posts.length})`}>
              {posts.length === 0 ? (
                <EmptyState
                  icon="edit"
                  title="Nothing yet"
                  body="Your posts are the strongest signal for what reaches you. Write the first one."
                  actionLabel="Write a post"
                  onAction={() => router.push('/compose')}
                />
              ) : null}
            </ListGroup>
          </View>
        }
        renderItem={({ item }) => (
          <Row
            left={<Avatar peerId={container.self} label={displayName} />}
            onPress={() =>
              router.push({ pathname: '/thread/[id]', params: { id: item.address } })
            }
          >
            <View style={{ flexDirection: 'row', gap: T.space.sm }}>
              <Text variant="bodyBold" numberOfLines={1} style={{ flexShrink: 1 }}>
                {name}
              </Text>
              <Text variant="small">{formatRelative(item.createdAt)}</Text>
            </View>
            <Text variant="body" numberOfLines={4} style={{ marginTop: T.space.xxs }}>
              {item.text}
            </Text>
          </Row>
        )}
      />
    </View>
  );
}
