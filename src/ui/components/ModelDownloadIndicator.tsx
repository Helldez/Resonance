import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { ModelProfiles } from '@core/config/ModelProfiles';
import { Icon, ProgressBar, Text } from '@ui/design-system';
import { formatMb } from '@ui/Splash';
import { formatDownloadEta } from '@ui/format/downloadEta';
import { useModelDownloadStore } from '@domain/ModelDownloadStore';

/**
 * App-wide download strip pinned under the status bar. It surfaces an LLM
 * download started anywhere (onboarding, Settings, the Agent banner) on every
 * screen — including pushed routes and modals — so the download is followable,
 * not lost on navigation. Tapping it opens the Agent hub, the feature the model
 * unlocks. Renders nothing unless a download is actually in flight.
 */
export function ModelDownloadIndicator() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const status = useModelDownloadStore((s) => s.status);
  const downloaded = useModelDownloadStore((s) => s.downloaded);
  const total = useModelDownloadStore((s) => s.total);
  const startedAt = useModelDownloadStore((s) => s.startedAt);

  if (status !== 'downloading' && status !== 'preparing') {
    return null;
  }

  const fraction = total > 0 ? downloaded / total : 0;
  const eta =
    status === 'downloading' ? formatDownloadEta(downloaded, total, startedAt, Date.now()) : null;
  const detail =
    status === 'preparing'
      ? 'Finalizing…'
      : `${formatMb(downloaded)} / ${formatMb(total)} MB${eta !== null ? ` · ${eta}` : ''}`;

  return (
    <Pressable
      onPress={() => router.push('/agent')}
      accessibilityRole="button"
      accessibilityLabel="Model download in progress — open Agent"
      style={{
        paddingTop: insets.top,
        backgroundColor: T.color.bg,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: T.color.border,
      }}
    >
      <View style={{ paddingHorizontal: T.space.lg, paddingVertical: T.space.sm, gap: T.space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
          <Icon name="download" size={T.size.iconSmall} color={T.color.accent} />
          <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
            {ModelProfiles.llm.label}
          </Text>
          <Text variant="caption">{detail}</Text>
        </View>
        <ProgressBar progress={status === 'preparing' ? 1 : fraction} />
      </View>
    </Pressable>
  );
}
