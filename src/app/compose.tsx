import { useState } from 'react';
import { View } from 'react-native';
import { TextInput, Button, useTheme, HelperText } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireContainer } from '@ui/AppContainerContext';
import { appendOwnEmbedding, rescoreInboxAgainstOwnPosts } from '@services/NetworkIngestion';
import { createPost } from '@core/posts/CreatePost';
import { addressOf } from '@core/utils/AddressOf';

export default function ComposeScreen() {
  const container = useRequireContainer();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

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
    <View
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        padding: 12,
        paddingBottom: insets.bottom + 12,
      }}
    >
      <TextInput
        mode="outlined"
        multiline
        numberOfLines={8}
        value={text}
        onChangeText={setText}
        placeholder="A thought, a need, a topic — anything you'd want a stranger with a similar question to see."
      />
      {error !== null && <HelperText type="error">{error}</HelperText>}
      <Button
        mode="contained"
        onPress={() => {
          void submit();
        }}
        loading={submitting}
        disabled={submitting || text.trim().length === 0}
        style={{ marginTop: 12 }}
      >
        Post
      </Button>
      <Button onPress={() => router.back()} style={{ marginTop: 4 }}>
        Cancel
      </Button>
    </View>
  );
}
