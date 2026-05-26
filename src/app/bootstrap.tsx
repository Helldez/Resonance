import { View } from 'react-native';
import { ActivityIndicator, Text, useTheme } from 'react-native-paper';
import { useBootstrapStore } from '@domain/BootstrapStore';

export default function BootstrapScreen() {
  const stage = useBootstrapStore((s) => s.stage);
  const progressBytes = useBootstrapStore((s) => s.progressBytes);
  const totalBytes = useBootstrapStore((s) => s.totalBytes);
  const error = useBootstrapStore((s) => s.error);
  const theme = useTheme();

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.background,
        padding: 24,
      }}
    >
      <Text variant="headlineSmall" style={{ marginBottom: 16 }}>
        Resonance
      </Text>
      <ActivityIndicator size="large" />
      <Text style={{ marginTop: 16 }}>{labelFor(stage)}</Text>
      {progressBytes !== undefined && totalBytes !== undefined && totalBytes > 0 && (
        <Text style={{ marginTop: 4, opacity: 0.7 }}>
          {Math.floor((progressBytes / totalBytes) * 100)}%
        </Text>
      )}
      {error !== undefined && (
        <Text style={{ marginTop: 16, color: theme.colors.error }}>{error}</Text>
      )}
    </View>
  );
}

function labelFor(stage: string): string {
  if (stage === 'identity') return 'Creating your identity…';
  if (stage === 'embedding-model') return 'Downloading the embedding model…';
  if (stage === 'llm-model') return 'Downloading the language model…';
  if (stage === 'network') return 'Connecting to the network…';
  if (stage === 'ready') return 'Ready.';
  if (stage === 'error') return 'Something went wrong.';
  return 'Starting…';
}
