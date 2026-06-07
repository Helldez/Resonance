import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { IconButton } from './IconButton';
import { Text } from './Text';

/**
 * Per-screen sticky header (native headers are disabled): back chevron on
 * the left when the screen is pushed, bold left-aligned title, optional
 * trailing actions. Hairline at the bottom, safe-area aware.
 */
export function TopBar(props: {
  title?: string;
  subtitle?: string;
  back?: boolean;
  left?: ReactNode;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: T.color.bg,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: T.color.border,
      }}
    >
      <View
        style={{
          height: T.size.topBarHeight,
          width: '100%',
          maxWidth: T.size.contentMaxWidth,
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: T.space.sm,
          gap: T.space.sm,
        }}
      >
        {props.back === true && (
          <IconButton icon="arrow-left" accessibilityLabel="Back" onPress={() => router.back()} />
        )}
        {props.left}
        <View style={{ flex: 1, paddingHorizontal: T.space.sm }}>
          {props.title !== undefined && <Text variant="heading">{props.title}</Text>}
          {props.subtitle !== undefined && <Text variant="caption">{props.subtitle}</Text>}
        </View>
        {props.right}
      </View>
    </View>
  );
}
