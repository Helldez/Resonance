import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { DesignTokens as T } from '@core/config/DesignTokens';

/**
 * The X timeline row — the Card replacement. Borderless, full-bleed,
 * optional avatar column on the left, content on the right, a hairline
 * divider at the bottom. No elevation anywhere.
 */
export function Row(props: {
  left?: ReactNode;
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Indent the row (nested replies). */
  inset?: boolean;
  /** Drop the bottom hairline (e.g. last row before a section header). */
  noDivider?: boolean;
}) {
  const container: ViewStyle = {
    flexDirection: 'row',
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.md,
    paddingLeft: props.inset === true ? T.space.xxxl + T.space.lg : T.space.lg,
    borderBottomWidth: props.noDivider === true ? 0 : StyleSheet.hairlineWidth,
    borderBottomColor: T.color.border,
    gap: T.space.md,
  };
  const body = (
    <>
      {props.left !== undefined && <View>{props.left}</View>}
      <View style={{ flex: 1 }}>{props.children}</View>
    </>
  );
  if (props.onPress === undefined && props.onLongPress === undefined) {
    return <View style={container}>{body}</View>;
  }
  return (
    <Pressable
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      style={({ pressed }) => [container, pressed ? { backgroundColor: T.color.bgPressed } : null]}
    >
      {body}
    </Pressable>
  );
}
