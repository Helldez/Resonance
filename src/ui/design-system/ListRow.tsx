import { Pressable, StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/**
 * X-settings list row: label (+ optional hint below), current value on the
 * right, chevron when it navigates, or any custom `right` control (Switch,
 * stepper). Group rows with `ListGroup`.
 */
export function ListRow(props: {
  label: string;
  hint?: string;
  value?: string;
  icon?: IconName;
  chevron?: boolean;
  right?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  noDivider?: boolean;
}) {
  const labelColor = props.destructive === true ? T.color.danger : T.color.text;
  const body = (
    <>
      {props.icon !== undefined && (
        <Icon name={props.icon} size={T.size.icon} color={labelColor} />
      )}
      <View style={{ flex: 1 }}>
        <Text variant="body" color={labelColor}>
          {props.label}
        </Text>
        {props.hint !== undefined && (
          <Text variant="small" style={{ marginTop: T.space.xxs }}>
            {props.hint}
          </Text>
        )}
      </View>
      {props.value !== undefined && (
        <Text variant="muted" numberOfLines={1} style={{ maxWidth: '40%' }}>
          {props.value}
        </Text>
      )}
      {props.right}
      {props.chevron === true && (
        <Icon name="chevron-right" size={T.size.iconSmall} color={T.color.textMuted} />
      )}
    </>
  );
  const container = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: T.space.md,
    minHeight: T.size.touchTarget + T.space.sm,
    paddingHorizontal: T.space.lg,
    paddingVertical: T.space.sm,
    borderBottomWidth: props.noDivider === true ? 0 : StyleSheet.hairlineWidth,
    borderBottomColor: T.color.border,
  };
  if (props.onPress === undefined) {
    return <View style={container}>{body}</View>;
  }
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      style={({ pressed }) => [container, pressed ? { backgroundColor: T.color.bgPressed } : null]}
    >
      {body}
    </Pressable>
  );
}

/** Section wrapper: uppercase header + rows + optional muted footer copy. */
export function ListGroup(props: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <View style={{ marginTop: T.space.xl }}>
      {props.title !== undefined && (
        <Text
          variant="caption"
          style={{
            paddingHorizontal: T.space.lg,
            marginBottom: T.space.xs,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
          }}
        >
          {props.title}
        </Text>
      )}
      {props.children}
      {props.footer !== undefined && (
        <Text variant="small" style={{ paddingHorizontal: T.space.lg, marginTop: T.space.sm }}>
          {props.footer}
        </Text>
      )}
    </View>
  );
}
