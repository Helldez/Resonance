import { Pressable } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** Selectable pill chip (threshold presets, interests, status badges). */
export function Pill(props: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  onClose?: () => void;
  icon?: IconName;
  color?: string;
}) {
  const selected = props.selected === true;
  const tint = props.color ?? T.color.accent;
  const labelColor = selected ? tint : props.color ?? T.color.text;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.onPress === undefined}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: T.space.xs,
        paddingHorizontal: T.space.md,
        height: T.size.buttonHeightSmall,
        borderRadius: T.radius.pill,
        borderWidth: 1,
        borderColor: selected ? tint : T.color.border,
        backgroundColor: selected ? T.color.accentSoft : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {props.icon !== undefined && (
        <Icon name={props.icon} size={T.size.iconSmall} color={labelColor} />
      )}
      <Text variant="label" color={labelColor}>
        {props.label}
      </Text>
      {props.onClose !== undefined && (
        <Pressable onPress={props.onClose} hitSlop={T.space.sm} accessibilityLabel={`Remove ${props.label}`}>
          <Icon name="x" size={T.size.iconSmall} color={T.color.textMuted} />
        </Pressable>
      )}
    </Pressable>
  );
}
