import { Modal, Pressable, View } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Text } from './Text';

/** X-style bottom sheet over a scrim. Tap outside (or the handle) to close. */
export function Sheet(props: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: T.color.overlay }}
        onPress={props.onClose}
        accessibilityLabel="Close"
      />
      <View
        style={{
          backgroundColor: T.color.bgElevated,
          borderTopLeftRadius: T.radius.lg,
          borderTopRightRadius: T.radius.lg,
          paddingHorizontal: T.space.lg,
          paddingTop: T.space.md,
          paddingBottom: insets.bottom + T.space.lg,
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 36,
            height: 4,
            borderRadius: T.radius.pill,
            backgroundColor: T.color.border,
            marginBottom: T.space.md,
          }}
        />
        {props.title !== undefined && (
          <Text variant="heading" style={{ marginBottom: T.space.md }}>
            {props.title}
          </Text>
        )}
        {props.children}
      </View>
    </Modal>
  );
}
