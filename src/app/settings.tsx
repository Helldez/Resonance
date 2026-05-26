import { View, ScrollView } from 'react-native';
import { Text, RadioButton, TextInput, Chip, useTheme, Divider, HelperText } from 'react-native-paper';
import { useSettingsStore } from '@domain/SettingsStore';

interface ThresholdPreset {
  readonly label: string;
  readonly value: number;
  readonly hint: string;
}

const THRESHOLD_PRESETS: ReadonlyArray<ThresholdPreset> = [
  { label: 'Very loose', value: 0.5, hint: 'Show almost everything from the bucket' },
  { label: 'Loose', value: 0.65, hint: 'Show posts loosely related to your interests' },
  { label: 'Balanced', value: 0.78, hint: 'Default: clearly related posts' },
  { label: 'Strict', value: 0.85, hint: 'Only strongly related posts' },
  { label: 'Very strict', value: 0.92, hint: 'Near-identical interests only' },
];

function presetForValue(v: number): ThresholdPreset {
  let best = THRESHOLD_PRESETS[0];
  let bestDelta = Math.abs(v - best.value);
  for (const p of THRESHOLD_PRESETS) {
    const delta = Math.abs(v - p.value);
    if (delta < bestDelta) {
      best = p;
      bestDelta = delta;
    }
  }
  return best;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const responseMode = useSettingsStore((s) => s.responseMode);
  const setResponseMode = useSettingsStore((s) => s.setResponseMode);
  const receiverContext = useSettingsStore((s) => s.receiverContext);
  const setReceiverContext = useSettingsStore((s) => s.setReceiverContext);
  const similarityThreshold = useSettingsStore((s) => s.similarityThreshold);
  const setSimilarityThreshold = useSettingsStore((s) => s.setSimilarityThreshold);

  const activePreset = presetForValue(similarityThreshold);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 12 }}
    >
      <Text variant="titleMedium">About you (stays on-device)</Text>
      <TextInput
        mode="outlined"
        multiline
        numberOfLines={6}
        value={receiverContext}
        onChangeText={setReceiverContext}
        placeholder="A short, honest description of who you are and what you actually know."
      />
      <HelperText type="info">
        Used to compute your interest bucket and to draft replies. Restart the
        app after changing this so the bucket re-routes you.
      </HelperText>

      <Divider style={{ marginVertical: 16 }} />

      <Text variant="titleMedium">Inbox similarity threshold</Text>
      <HelperText type="info">
        How close to your interests an incoming post must be to land in your
        inbox. Your own posts always show regardless.
      </HelperText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
        {THRESHOLD_PRESETS.map((preset) => {
          const selected = preset.value === activePreset.value;
          return (
            <Chip
              key={preset.label}
              mode={selected ? 'flat' : 'outlined'}
              selected={selected}
              onPress={() => setSimilarityThreshold(preset.value)}
            >
              {`${preset.label} (${preset.value.toFixed(2)})`}
            </Chip>
          );
        })}
      </View>
      <HelperText type="info">{activePreset.hint}</HelperText>

      <Divider style={{ marginVertical: 16 }} />

      <Text variant="titleMedium">Response mode</Text>
      <RadioButton.Group
        onValueChange={(v) => setResponseMode(v as typeof responseMode)}
        value={responseMode}
      >
        <RadioButton.Item label="Draft, I confirm before publishing" value="draft-confirm" />
        <RadioButton.Item label="Auto-publish on my behalf (not yet active)" value="auto-publish" />
      </RadioButton.Group>

      <Divider style={{ marginVertical: 16 }} />

      <Text variant="titleMedium">Reset</Text>
      <HelperText type="info">
        To wipe your identity, outbox feed and incoming posts, go to Android
        Settings → Apps → Resonance → Storage → Clear data. The next launch
        starts fresh.
      </HelperText>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}
