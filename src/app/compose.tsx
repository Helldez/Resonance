import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';
import { appendOwnEmbedding, rescoreInboxAgainstOwnPosts } from '@services/NetworkIngestion';
import { createPost } from '@core/posts/CreatePost';
import { addressOf } from '@core/utils/AddressOf';
import { RoomConfig } from '@core/config/RoomConfig';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Avatar, Button, IconButton, Text, TextField } from '@ui/design-system';

/**
 * X-style compose: cancel left, accent Post pill right, avatar + large
 * borderless input, character counter against the room's signed limit.
 */
export default function ComposeScreen() {
  const container = useRequireContainer();
  const displayName = useSettingsStore((s) => s.displayName);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const remaining = RoomConfig.maxPostChars - text.length;

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const { record } = await createPost(
        {
          embedder: container.embedder,
          mailbox: container.mailbox,
          network: container.network,
          identity: container.identity,
          clock: container.clock,
          self: container.self,
        },
        { text },
      );
      const ownAddress = addressOf(record.author, record.feedIndex);
      if (record.body.kind === 'post') {
        await container.posts.upsert(
          ownAddress,
          record.author,
          record.feedIndex,
          record.body,
          null,
          null,
        );
        // Push into the in-memory cache so future incoming posts are scored
        // against THIS post too, without waiting for an app restart.
        appendOwnEmbedding(ownAddress, record.body.embedding);
      }
      // Navigate immediately to the feed. The two passes below are O(inbox) and
      // O(replicated history) and used to block the compose screen for seconds
      // as the corpus grew — they now run in the background. The Inbox re-polls
      // SQLite on a timer, so their results surface without a navigation event.
      router.replace('/');
      if (record.body.kind === 'post') {
        void (async (): Promise<void> => {
          try {
            // Re-score the existing inbox against the now-larger set of own
            // posts so already-received remote posts can be grouped under this
            // new post (and cold-start scores get rewritten on one metric).
            await rescoreInboxAgainstOwnPosts(container);
            // Replay the full replicated history so posts dropped at admission
            // (e.g. before "About you" was set) are re-evaluated against this
            // new post and pulled in if they now match.
            await container.network.rescan();
          } catch (e) {
            console.warn(
              `[rn] post-publish rescore/rescan failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        })();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: T.color.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={{
          paddingTop: insets.top,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: T.space.sm,
          height: T.size.topBarHeight + insets.top,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: T.color.border,
        }}
      >
        <IconButton icon="x" accessibilityLabel="Cancel" onPress={() => router.back()} />
        <View style={{ flex: 1 }} />
        <Text
          variant="small"
          color={remaining < 0 ? T.color.danger : T.color.textMuted}
          style={{ marginRight: T.space.md }}
        >
          {String(remaining)}
        </Text>
        <Button
          label="Post"
          small
          loading={submitting}
          disabled={submitting || text.trim().length === 0 || remaining < 0}
          onPress={() => {
            void submit();
          }}
        />
      </View>

      <View style={{ flexDirection: 'row', padding: T.space.lg, gap: T.space.md, flex: 1 }}>
        <Avatar peerId={container.self} label={displayName} />
        <View style={{ flex: 1 }}>
          <TextField
            value={text}
            onChangeText={setText}
            placeholder="A thought, a need, a topic — anything you'd want a stranger with a similar question to see."
            multiline
            numberOfLines={6}
            bare
            large
            autoFocus
            error={error}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
