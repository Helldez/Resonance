import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';
import { useThread } from '@ui/thread/useThread';
import { confirmDestructive } from '@ui/confirmDestructive';
import { formatRelative } from '@ui/format/relativeTime';
import { formatAuthor, shortPeer } from '@domain/AuthorFormatting';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { EMPTY_REACTION_COUNTS } from '@ui/components/ReactionRow';
import {
  ActionBar,
  Avatar,
  Button,
  IconButton,
  Row,
  Skeleton,
  Text,
  TextField,
  TopBar,
} from '@ui/design-system';

/**
 * X-style conversation: the root post rendered large, replies as indented
 * timeline rows, and a sticky reply composer at the bottom (with the
 * on-demand AI draft). Data + actions live in useThread.
 */
export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const container = useRequireContainer();
  const insets = useSafeAreaInsets();
  const receiverContext = useSettingsStore((s) => s.receiverContext);
  const displayName = useSettingsStore((s) => s.displayName);
  const thread = useThread(container, id);

  const [draft, setDraft] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { post, responses, reactions } = thread;
  const alreadyReplied = responses.some((r) => r.author === container.self);
  const canReply = post !== null && post.author !== container.self && !alreadyReplied;

  const generate = (): void => {
    setDrafting(true);
    setError(null);
    void (async () => {
      try {
        setDraft(await thread.draftWithAi(receiverContext));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setDrafting(false);
      }
    })();
  };

  const publish = (): void => {
    setPublishing(true);
    setError(null);
    void (async () => {
      try {
        await thread.publishReply(draft);
        setDraft('');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPublishing(false);
      }
    })();
  };

  const authorLabel = (author: string): string =>
    author === container.self
      ? formatAuthor({ self: container.self, peer: container.self, selfDisplayName: displayName })
      : shortPeer(author);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.color.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TopBar title="Post" back />

      <ScrollView contentContainerStyle={{ paddingBottom: T.space.xxl }}>
        {thread.loading && post === null ? (
          <View style={{ padding: T.space.lg, gap: T.space.md }}>
            <Skeleton height={T.size.avatar} width={T.size.avatar} round />
            <Skeleton />
            <Skeleton width="70%" />
          </View>
        ) : post === null ? (
          <Text variant="muted" style={{ padding: T.space.lg }}>
            Post not found in local database.
          </Text>
        ) : (
          <View
            style={{
              paddingHorizontal: T.space.lg,
              paddingVertical: T.space.md,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: T.color.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.md }}>
              <Avatar
                peerId={post.author}
                label={post.author === container.self ? displayName : undefined}
              />
              <View style={{ flex: 1 }}>
                <Text variant="bodyBold" numberOfLines={1}>
                  {authorLabel(post.author)}
                </Text>
                <Text variant="caption">{formatRelative(post.createdAt)}</Text>
              </View>
            </View>
            {/* The root post reads large — it is the subject of the screen. */}
            <Text
              variant="body"
              style={{
                marginTop: T.space.md,
                fontSize: T.font.size.lg,
                lineHeight: T.font.lineHeight.xl,
              }}
            >
              {post.text}
            </Text>
            <ActionBar
              likeCount={reactions.get(post.address)?.counts.like ?? EMPTY_REACTION_COUNTS.like}
              liked={reactions.get(post.address)?.mine === 'like'}
              onLike={() => void thread.reactTo(post.address, 'like')}
              commentCount={responses.length}
            />
          </View>
        )}

        {responses.map((r) => {
          const askDelete = (): void => {
            confirmDestructive('Delete this response?', 'Removes from your local DB only.', () => {
              void thread.deleteResponse(r.address);
            });
          };
          return (
            <Row
              key={r.address}
              inset
              onLongPress={askDelete}
              left={
                <Avatar
                  peerId={r.author}
                  size={T.size.avatarSmall + T.space.sm}
                  label={r.author === container.self ? displayName : undefined}
                />
              }
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
                <Text variant="bodyBold" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {authorLabel(r.author)}
                </Text>
                <Text variant="caption">{formatRelative(r.createdAt)}</Text>
                <View style={{ flex: 1 }} />
                <IconButton
                  icon="trash"
                  size={T.size.iconSmall}
                  color={T.color.textMuted}
                  accessibilityLabel="Delete this response"
                  onPress={askDelete}
                />
              </View>
              <Text variant="body">{r.text}</Text>
              <ActionBar
                likeCount={reactions.get(r.address)?.counts.like ?? 0}
                liked={reactions.get(r.address)?.mine === 'like'}
                onLike={() => void thread.reactTo(r.address, 'like')}
              />
            </Row>
          );
        })}

        {!thread.loading && responses.length === 0 && (
          <Text variant="muted" style={{ padding: T.space.lg }}>
            No replies yet.
          </Text>
        )}
      </ScrollView>

      {/* Sticky reply composer. One reply per peer per post (product rule). */}
      {post !== null && post.author !== container.self && (
        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: T.color.border,
            paddingHorizontal: T.space.lg,
            paddingTop: T.space.sm,
            paddingBottom: insets.bottom + T.space.sm,
            gap: T.space.sm,
          }}
        >
          {alreadyReplied ? (
            <Text variant="small">
              You already replied. Delete your reply above to write a new one.
            </Text>
          ) : (
            <>
              <TextField
                value={draft}
                onChangeText={setDraft}
                placeholder="Post your reply — first person, specific, no greetings."
                multiline
                numberOfLines={2}
                bare
                error={error}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
                <Button
                  label={draft.trim().length === 0 ? 'Draft with AI' : 'Rewrite with AI'}
                  variant="secondary"
                  small
                  icon="robot"
                  loading={drafting}
                  disabled={drafting || publishing || !canReply}
                  onPress={generate}
                />
                <View style={{ flex: 1 }} />
                <Button
                  label="Reply"
                  small
                  icon="send"
                  loading={publishing}
                  disabled={publishing || drafting || draft.trim().length === 0}
                  onPress={publish}
                />
              </View>
            </>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
