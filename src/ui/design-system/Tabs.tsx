import { Pressable, StyleSheet, View } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Text } from './Text';

export interface TabItem<K extends string> {
  readonly key: K;
  readonly label: string;
}

/**
 * X-style text tabs with an accent underline on the active item, over a
 * hairline. Replaces Paper's SegmentedButtons for filters/sections.
 */
export function Tabs<K extends string>(props: {
  items: ReadonlyArray<TabItem<K>>;
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: T.color.border,
      }}
    >
      {props.items.map((item) => {
        const active = item.key === props.value;
        return (
          <Pressable
            key={item.key}
            onPress={() => props.onChange(item.key)}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: 'center',
              paddingTop: T.space.md,
              backgroundColor: pressed ? T.color.bgPressed : 'transparent',
            })}
          >
            <Text
              variant="label"
              color={active ? T.color.text : T.color.textMuted}
              style={active ? { fontWeight: T.font.weight.bold } : null}
            >
              {item.label}
            </Text>
            <View
              style={{
                marginTop: T.space.sm,
                height: 3,
                width: T.space.xxxl + T.space.sm,
                borderRadius: T.radius.pill,
                backgroundColor: active ? T.color.accent : 'transparent',
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
