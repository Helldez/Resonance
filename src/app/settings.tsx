import { useState } from 'react';
import { View, ScrollView } from 'react-native';
import {
  Text,
  RadioButton,
  TextInput,
  Chip,
  Button,
  ProgressBar,
  useTheme,
  Divider,
  HelperText,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettingsStore } from '@domain/SettingsStore';
import { useRequireContainer } from '@ui/AppContainerContext';
import { ModelProfiles } from '@core/config/ModelProfiles';
import { MatchingConfig } from '@core/config/MatchingConfig';

type ThresholdPreset = (typeof MatchingConfig.thresholdPresets)[number];

const THRESHOLD_PRESETS = MatchingConfig.thresholdPresets;

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
  const insets = useSafeAreaInsets();
  const container = useRequireContainer();
  const responseMode = useSettingsStore((s) => s.responseMode);
  const setResponseMode = useSettingsStore((s) => s.setResponseMode);
  const receiverContext = useSettingsStore((s) => s.receiverContext);
  const setReceiverContext = useSettingsStore((s) => s.setReceiverContext);
  const similarityThreshold = useSettingsStore((s) => s.similarityThreshold);
  const setSimilarityThreshold = useSettingsStore((s) => s.setSimilarityThreshold);
  const displayName = useSettingsStore((s) => s.displayName);
  const setDisplayName = useSettingsStore((s) => s.setDisplayName);

  const activePreset = presetForValue(similarityThreshold);

  const [llmLoading, setLlmLoading] = useState(false);
  const [llmReady, setLlmReady] = useState(container.llmConcrete.isLoaded);
  const [llmProgress, setLlmProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [llmError, setLlmError] = useState<string | null>(null);

  const downloadLlm = async (): Promise<void> => {
    setLlmLoading(true);
    setLlmError(null);
    setLlmProgress({ downloaded: 0, total: ModelProfiles.llm.sizeBytes });
    try {
      await container.llmConcrete.load((p) => {
        setLlmProgress({ downloaded: p.downloaded ?? 0, total: p.total ?? 0 });
      });
      setLlmReady(true);
    } catch (e) {
      setLlmError(e instanceof Error ? e.message : String(e));
    } finally {
      setLlmLoading(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24 }}
    >
      <Text variant="titleMedium">Display name</Text>
      <TextInput
        mode="outlined"
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="What you'd like to see next to your own posts"
      />
      <HelperText type="info">
        Local only — peers always see your public-key fingerprint. Leave
        empty to fall back to the truncated fingerprint everywhere.
      </HelperText>

      <Divider style={{ marginVertical: 16 }} />

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
        Used to rank incoming posts before you have written anything (cold
        start), and to draft replies. Everyone shares one room — this only
        shapes what surfaces in your inbox, not who you connect to.
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

      <Text variant="titleMedium">Language model (for drafting replies)</Text>
      <HelperText type="info">
        {`Qwen3 1.7B Q4_0 — about ${formatMb(ModelProfiles.llm.sizeBytes)} MB. ` +
          'Required to draft responses. Downloaded once, kept on disk.'}
      </HelperText>
      {llmReady ? (
        <Chip icon="check" style={{ alignSelf: 'flex-start', marginTop: 4 }}>
          Language model ready
        </Chip>
      ) : (
        <>
          <Button
            mode="contained"
            onPress={() => {
              void downloadLlm();
            }}
            loading={llmLoading}
            disabled={llmLoading}
            style={{ marginTop: 4, alignSelf: 'flex-start' }}
          >
            {llmLoading ? 'Downloading…' : 'Download language model'}
          </Button>
          {llmProgress !== null && llmProgress.total > 0 && (
            <View style={{ marginTop: 8 }}>
              <ProgressBar
                progress={Math.min(1, llmProgress.downloaded / llmProgress.total)}
              />
              <Text style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
                {`${formatMb(llmProgress.downloaded)} / ${formatMb(llmProgress.total)} MB`}
              </Text>
            </View>
          )}
          {llmError !== null && (
            <HelperText type="error">{llmError}</HelperText>
          )}
        </>
      )}

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

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}
