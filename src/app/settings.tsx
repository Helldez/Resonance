import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettingsStore } from '@domain/SettingsStore';
import { useRequireContainer } from '@ui/AppContainerContext';
import { ModelProfiles } from '@core/config/ModelProfiles';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { useModelDownload } from '@ui/hooks/useModelDownload';
import { formatMb } from '@ui/Splash';
import {
  Button,
  ContentColumn,
  ListGroup,
  ListRow,
  Pill,
  ProgressBar,
  Sheet,
  Text,
  TextField,
  TopBar,
} from '@ui/design-system';

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

type Editing = 'none' | 'name' | 'about' | 'threshold';

/**
 * X-style settings: grouped, scannable rows; long inputs edit in a sheet
 * instead of inline; the model download is one row that flows through
 * button → inline progress → ready. The old "Response mode" radio is gone —
 * autonomy lives in the Agent hub, one dial in one place.
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const container = useRequireContainer();
  const receiverContext = useSettingsStore((s) => s.receiverContext);
  const setReceiverContext = useSettingsStore((s) => s.setReceiverContext);
  const similarityThreshold = useSettingsStore((s) => s.similarityThreshold);
  const setSimilarityThreshold = useSettingsStore((s) => s.setSimilarityThreshold);
  const displayName = useSettingsStore((s) => s.displayName);
  const setDisplayName = useSettingsStore((s) => s.setDisplayName);

  const [editing, setEditing] = useState<Editing>('none');
  const llm = useModelDownload(container, ModelProfiles.llm.sizeBytes);
  const activePreset = presetForValue(similarityThreshold);

  return (
    <View style={{ flex: 1, backgroundColor: T.color.bg }}>
      <TopBar title="Settings" back />
      <ContentColumn>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + T.space.xxl }}>
        <ListGroup
          title="Profile"
          footer="Both stay on this device. Peers always see your public-key fingerprint."
        >
          <ListRow
            label="Display name"
            value={displayName.trim().length > 0 ? displayName : 'Not set'}
            chevron
            onPress={() => setEditing('name')}
          />
          <ListRow
            label="About you"
            value={receiverContext.trim().length > 0 ? receiverContext : 'Not set'}
            chevron
            onPress={() => setEditing('about')}
            noDivider
          />
        </ListGroup>

        <ListGroup
          title="Inbox"
          footer={activePreset.hint}
        >
          <ListRow
            label="Similarity threshold"
            hint="How close to your interests an incoming post must be."
            value={`${activePreset.label} (${activePreset.value.toFixed(2)})`}
            chevron
            onPress={() => setEditing('threshold')}
            noDivider
          />
        </ListGroup>

        <ListGroup
          title="AI models"
          footer="Downloaded once, kept on disk. Everything runs on this device."
        >
          <ListRow
            label={ModelProfiles.embedding.label}
            hint="Ranks every incoming post. Required."
            right={<Text variant="label" color={T.color.success}>Ready</Text>}
          />
          <View>
            <ListRow
              label={ModelProfiles.llm.label}
              hint={`Drafts replies and posts · ${formatMb(ModelProfiles.llm.sizeBytes)} MB`}
              right={
                llm.ready ? (
                  <Text variant="label" color={T.color.success}>Ready</Text>
                ) : llm.loading && llm.progress !== null && llm.progress.total > 0 ? (
                  <Text variant="label" color={T.color.textMuted}>
                    {`${formatMb(llm.progress.downloaded)} / ${formatMb(llm.progress.total)} MB`}
                  </Text>
                ) : undefined
              }
              noDivider
            />
            {llm.loading && llm.progress !== null && llm.progress.total > 0 && (
              <View style={{ paddingHorizontal: T.space.lg, paddingBottom: T.space.md }}>
                <ProgressBar progress={llm.progress.downloaded / llm.progress.total} />
              </View>
            )}
            {!llm.ready && !llm.loading && (
              <View style={{ paddingHorizontal: T.space.lg, paddingBottom: T.space.md }}>
                <Button label="Download model" icon="download" small onPress={llm.start} />
              </View>
            )}
            {llm.error !== null && (
              <Text
                variant="small"
                color={T.color.danger}
                style={{ paddingHorizontal: T.space.lg, paddingBottom: T.space.md }}
              >
                {llm.error}
              </Text>
            )}
          </View>
        </ListGroup>

        <ListGroup
          title="Reset"
          footer="To wipe your identity, outbox feed and incoming posts, go to Android Settings → Apps → Resonance → Storage → Clear data. The next launch starts fresh."
        >
          <View />
        </ListGroup>
      </ScrollView>
      </ContentColumn>

      <Sheet visible={editing === 'name'} onClose={() => setEditing('none')} title="Display name">
        <TextField
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="What you'd like to see next to your own posts"
          autoFocus
        />
        <Text variant="small" style={{ marginTop: T.space.sm }}>
          Local only. Leave empty to fall back to the truncated fingerprint.
        </Text>
        <View style={{ marginTop: T.space.lg }}>
          <Button label="Done" full onPress={() => setEditing('none')} />
        </View>
      </Sheet>

      <Sheet visible={editing === 'about'} onClose={() => setEditing('none')} title="About you">
        <TextField
          value={receiverContext}
          onChangeText={setReceiverContext}
          placeholder="A short, honest description of who you are and what you actually know."
          multiline
          numberOfLines={6}
          autoFocus
        />
        <Text variant="small" style={{ marginTop: T.space.sm }}>
          Ranks incoming posts before you have written anything, and helps
          draft replies. It only shapes what surfaces in your inbox — never
          who you connect to.
        </Text>
        <View style={{ marginTop: T.space.lg }}>
          <Button label="Done" full onPress={() => setEditing('none')} />
        </View>
      </Sheet>

      <Sheet
        visible={editing === 'threshold'}
        onClose={() => setEditing('none')}
        title="Similarity threshold"
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.space.sm }}>
          {THRESHOLD_PRESETS.map((preset) => (
            <Pill
              key={preset.label}
              label={`${preset.label} (${preset.value.toFixed(2)})`}
              selected={preset.value === activePreset.value}
              onPress={() => setSimilarityThreshold(preset.value)}
            />
          ))}
        </View>
        <Text variant="small" style={{ marginTop: T.space.md }}>
          {activePreset.hint} Your own posts always show regardless.
        </Text>
        <View style={{ marginTop: T.space.lg }}>
          <Button label="Done" full onPress={() => setEditing('none')} />
        </View>
      </Sheet>
    </View>
  );
}
