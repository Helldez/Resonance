import { View } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { clamp01 } from '@ui/colorMath';

/** Thin X-style progress bar: muted track, accent fill. `progress` in [0,1]. */
export function ProgressBar(props: { progress: number; color?: string }) {
  return (
    <View
      accessibilityRole="progressbar"
      style={{
        height: T.size.progressBarHeight,
        borderRadius: T.radius.pill,
        backgroundColor: T.color.bgElevated,
        overflow: 'hidden',
        alignSelf: 'stretch',
      }}
    >
      <View
        style={{
          width: `${clamp01(props.progress) * 100}%`,
          height: '100%',
          borderRadius: T.radius.pill,
          backgroundColor: props.color ?? T.color.accent,
        }}
      />
    </View>
  );
}
