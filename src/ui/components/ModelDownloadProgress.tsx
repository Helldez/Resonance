import { View } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { ProgressBar, Text } from '@ui/design-system';
import { formatMb } from '@ui/Splash';
import type { ModelDownloadState } from '@domain/types';

/**
 * Shared progress visual for the LLM download: a thin bar plus a caption that
 * reads bytes while downloading and "Finalizing…" during the post-download
 * `preparing` phase (bytes in, native load still resolving). Reused by the
 * Settings row, the onboarding card, the Agent banner and the global
 * indicator so the four never drift. Render only when status is
 * `downloading` or `preparing`.
 */
export function ModelDownloadProgress(props: {
  status: ModelDownloadState['status'];
  downloaded: number;
  total: number;
}) {
  const { status, downloaded, total } = props;
  const fraction = total > 0 ? downloaded / total : 0;
  return (
    <View style={{ gap: T.space.xs }}>
      <ProgressBar progress={status === 'preparing' ? 1 : fraction} />
      <Text variant="caption">
        {status === 'preparing'
          ? 'Finalizing…'
          : `${formatMb(downloaded)} / ${formatMb(total)} MB`}
      </Text>
    </View>
  );
}
