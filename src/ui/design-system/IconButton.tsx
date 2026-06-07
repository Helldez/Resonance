import { Pressable } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Icon, type IconName } from './Icon';

/** Ghost circular icon button with a full 44pt touch target. */
export function IconButton(props: {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  color?: string;
  size?: number;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      hitSlop={T.space.sm}
      style={({ pressed }) => ({
        width: T.size.touchTarget,
        height: T.size.touchTarget,
        borderRadius: T.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? T.color.bgElevated : 'transparent',
        opacity: props.disabled === true ? 0.4 : 1,
      })}
    >
      <Icon
        name={props.icon}
        size={props.size ?? T.size.icon}
        color={props.color ?? T.color.text}
      />
    </Pressable>
  );
}
