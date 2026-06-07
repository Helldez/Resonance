import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Icon, Text, type IconName } from '@ui/design-system';
import { useAppContainer } from '@ui/AppContainerContext';
import { usePendingCount } from '@ui/hooks/usePendingCount';

const TAB_META: Record<string, { icon: IconName; label: string }> = {
  index: { icon: 'home', label: 'Home' },
  atlas: { icon: 'compass', label: 'Atlas' },
  agent: { icon: 'zap', label: 'Agent' },
  you: { icon: 'user', label: 'You' },
};

/**
 * X-style bottom tab bar over pure black with a hairline top border. The
 * Agent tab carries a live badge with the number of drafts awaiting
 * approval — actionable work calls the user, instead of hiding in a screen.
 */
export function TabBar(props: {
  routes: ReadonlyArray<string>;
  activeIndex: number;
  onPress: (name: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const container = useAppContainer();
  const pendingCount = usePendingCount(container);

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: T.color.bg,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: T.color.border,
        paddingBottom: insets.bottom,
        height: T.size.tabBarHeight + insets.bottom,
      }}
    >
      {props.routes.map((name, i) => {
        const meta = TAB_META[name];
        if (meta === undefined) {
          return null;
        }
        const active = i === props.activeIndex;
        const color = active ? T.color.text : T.color.textMuted;
        const badge = name === 'agent' ? pendingCount : 0;
        return (
          <Pressable
            key={name}
            onPress={() => props.onPress(name)}
            accessibilityRole="tab"
            accessibilityLabel={meta.label}
            accessibilityState={{ selected: active }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <View>
              <Icon name={meta.icon} size={T.size.iconLarge} color={color} filled={false} />
              {badge > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: -T.space.xs,
                    right: -T.space.sm,
                    minWidth: T.space.lg,
                    height: T.space.lg,
                    borderRadius: T.radius.pill,
                    backgroundColor: T.color.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: T.space.xs,
                  }}
                >
                  <Text variant="caption" color={T.color.accentText} style={{ fontWeight: T.font.weight.bold }}>
                    {badge > 99 ? '99+' : String(badge)}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
