import { View } from 'react-native';
import { useBootstrapStore } from '@domain/BootstrapStore';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Icon, ProgressBar, Text } from '@ui/design-system';
import type { BootstrapState } from '@domain/types';

type Stage = BootstrapState['stage'];

/** Boot steps in order, with the user-facing label for each. */
const STEPS: ReadonlyArray<{ readonly stage: Stage; readonly label: string }> = [
  { stage: 'identity', label: 'Your identity' },
  { stage: 'embedding-model', label: 'Embedding model' },
  { stage: 'network', label: 'Connecting to the network' },
];

const ORDER: readonly Stage[] = ['idle', 'identity', 'embedding-model', 'llm-model', 'network', 'ready'];

function stepState(step: Stage, current: Stage): 'done' | 'active' | 'todo' {
  if (current === 'error') {
    return 'todo';
  }
  const c = ORDER.indexOf(current);
  const s = ORDER.indexOf(step);
  if (c > s) {
    return 'done';
  }
  if (c === s) {
    return 'active';
  }
  return 'todo';
}

/**
 * X-style boot splash: the Resonance mark over pure black, with a checklist
 * of boot steps (done ✓ / in progress / pending) instead of an anonymous
 * spinner — on a first run the embedding-model download is minutes, and the
 * user should see exactly where boot is and how much is left.
 */
export function Splash() {
  const stage = useBootstrapStore((s) => s.stage);
  const progressBytes = useBootstrapStore((s) => s.progressBytes);
  const totalBytes = useBootstrapStore((s) => s.totalBytes);
  const error = useBootstrapStore((s) => s.error);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: T.color.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: T.space.xxxl,
      }}
    >
      <Icon name="resonance" size={56} color={T.color.accent} />
      <Text variant="display" style={{ marginTop: T.space.lg, marginBottom: T.space.xxxl }}>
        Resonance
      </Text>

      <View style={{ alignSelf: 'stretch', maxWidth: 360, width: '100%', gap: T.space.md }}>
        {STEPS.map((step) => {
          const state = stepState(step.stage, stage);
          return (
            <View key={step.stage} style={{ gap: T.space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.md }}>
                {state === 'done' ? (
                  <Icon name="check" size={T.size.iconSmall} color={T.color.success} />
                ) : (
                  <View
                    style={{
                      width: T.size.iconSmall,
                      alignItems: 'center',
                    }}
                  >
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: T.radius.pill,
                        backgroundColor: state === 'active' ? T.color.accent : T.color.border,
                      }}
                    />
                  </View>
                )}
                <Text
                  variant="body"
                  color={state === 'todo' ? T.color.textMuted : T.color.text}
                >
                  {step.label}
                </Text>
              </View>
              {state === 'active' &&
                progressBytes !== undefined &&
                totalBytes !== undefined &&
                totalBytes > 0 && (
                  <View style={{ gap: T.space.xs, paddingLeft: T.size.iconSmall + T.space.md }}>
                    <ProgressBar progress={progressBytes / totalBytes} />
                    <Text variant="caption">
                      {`${formatMb(progressBytes)} / ${formatMb(totalBytes)} MB`}
                    </Text>
                  </View>
                )}
            </View>
          );
        })}
      </View>

      {stage === 'error' && error !== undefined && (
        <View style={{ marginTop: T.space.xxl, alignItems: 'center', gap: T.space.sm }}>
          <Icon name="alert" size={T.size.icon} color={T.color.danger} />
          <Text variant="small" color={T.color.danger} style={{ textAlign: 'center' }}>
            {error}
          </Text>
          <Text variant="caption" style={{ textAlign: 'center' }}>
            Close and reopen the app to retry.
          </Text>
        </View>
      )}
    </View>
  );
}

export function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}
