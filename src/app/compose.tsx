import { useState } from 'react';
import { View } from 'react-native';
import { TextInput, Button, useTheme, HelperText } from 'react-native-paper';
import { useRouter } from 'expo-router';

export default function ComposeScreen() {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const theme = useTheme();

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      // TODO M2: invoke createPost use case via app container.
      throw new Error('Compose flow not wired yet (M2).');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 12 }}>
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
