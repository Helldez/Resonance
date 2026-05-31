import { useState } from 'react';
import { View } from 'react-native';
import { TextInput, Button, useTheme, HelperText } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireContainer, appendOwnEmbedding } from '@ui/AppContainerContext';
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
      if (record.body.kind === 'post') {
        await container.posts.upsert(
          addressOf(record.author, record.feedIndex),
          record.author,
          record.feedIndex,
          record.body,
          null,
        );
        // Push into the in-memory cache so future incoming posts are scored
        // against THIS post too, without waiting for an app restart.
        appendOwnEmbedding(record.body.embedding);
      }
      router.replace({
        pathname: '/map',
        params: { anchor: addressOf(record.author, record.feedIndex) },
      });
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
