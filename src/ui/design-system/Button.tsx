import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * X-style pill button. `primary` = accent fill; `secondary` = hairline
 * outline; `ghost` = bare label; `danger` = outline in the danger color.
 */
export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  small?: boolean;
  full?: boolean;
  loading?: boolean;
  disabled?: boolean;
}) {
  const variant = props.variant ?? 'primary';
  const disabled = props.disabled === true || props.loading === true;
  const height = props.small === true ? T.size.buttonHeightSmall : T.size.buttonHeight;

  const container: ViewStyle = {
    height,
    borderRadius: T.radius.pill,
    paddingHorizontal: props.small === true ? T.space.lg : T.space.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: T.space.sm,
    alignSelf: props.full === true ? 'stretch' : 'flex-start',
    opacity: disabled ? 0.5 : 1,
  };
  if (variant === 'primary') {
    container.backgroundColor = T.color.accent;
  } else if (variant === 'secondary') {
    container.borderWidth = 1;
    container.borderColor = T.color.border;
  } else if (variant === 'danger') {
    container.borderWidth = 1;
    container.borderColor = T.color.danger;
  }
  const labelColor =
    variant === 'primary'
      ? T.color.accentText
      : variant === 'danger'
        ? T.color.danger
        : T.color.text;

  return (
    <Pressable
      onPress={props.onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      style={({ pressed }) => [container, pressed ? { opacity: 0.7 } : null]}
    >
      {props.loading === true ? (
        <ActivityIndicator size="small" color={labelColor} />
      ) : (
        <>
          {props.icon !== undefined && (
            <Icon name={props.icon} size={T.size.iconSmall} color={labelColor} />
          )}
          <View>
            <Text variant="label" color={labelColor} style={{ fontWeight: T.font.weight.bold }}>
              {props.label}
            </Text>
          </View>
        </>
      )}
    </Pressable>
  );
}
