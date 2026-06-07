import { Pressable, View } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';

/** X-style toggle: accent track when on, bordered muted track when off. */
export function Switch(props: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  /** Track color when on (e.g. danger for the kill switch). */
  color?: string;
  accessibilityLabel?: string;
}) {
  const onColor = props.color ?? T.color.accent;
  return (
    <Pressable
      onPress={() => props.onValueChange(!props.value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: props.value }}
      accessibilityLabel={props.accessibilityLabel}
      hitSlop={T.space.sm}
      style={{
        width: 44,
        height: 24,
        borderRadius: T.radius.pill,
        backgroundColor: props.value ? onColor : T.color.bgElevated,
        borderWidth: props.value ? 0 : 1,
        borderColor: T.color.border,
        justifyContent: 'center',
        padding: 2,
      }}
    >
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: T.radius.pill,
          backgroundColor: props.value ? T.color.accentText : T.color.textMuted,
          alignSelf: props.value ? 'flex-end' : 'flex-start',
        }}
      />
    </Pressable>
  );
}
