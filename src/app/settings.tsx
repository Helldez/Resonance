import { View, ScrollView } from 'react-native';
import { Text, RadioButton, TextInput, useTheme, Divider } from 'react-native-paper';
import { useSettingsStore } from '@domain/SettingsStore';

export default function SettingsScreen() {
  const theme = useTheme();
  const responseMode = useSettingsStore((s) => s.responseMode);
  const setResponseMode = useSettingsStore((s) => s.setResponseMode);
  const receiverContext = useSettingsStore((s) => s.receiverContext);
  const setReceiverContext = useSettingsStore((s) => s.setReceiverContext);
  const similarityThreshold = useSettingsStore((s) => s.similarityThreshold);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 12 }}
    >
      <Text variant="titleMedium">Response mode</Text>
      <RadioButton.Group
        onValueChange={(v) => setResponseMode(v as typeof responseMode)}
        value={responseMode}
      >
        <RadioButton.Item label="Draft, I confirm before publishing" value="draft-confirm" />
        <RadioButton.Item label="Auto-publish on my behalf (opt-in)" value="auto-publish" />
      </RadioButton.Group>

      <Divider style={{ marginVertical: 12 }} />

      <Text variant="titleMedium">About you (stays on-device)</Text>
      <TextInput
        mode="outlined"
        multiline
        numberOfLines={6}
        value={receiverContext}
        onChangeText={setReceiverContext}
        placeholder="A short, honest description of who you are and what you actually know. Used to draft replies."
      />

      <Divider style={{ marginVertical: 12 }} />

      <Text variant="titleMedium">Similarity threshold</Text>
      <Text style={{ opacity: 0.7 }}>
        Currently {similarityThreshold.toFixed(2)}. The threshold slider lands in M5.
      </Text>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}
