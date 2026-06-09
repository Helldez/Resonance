import { Modal, Pressable, View } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { useKeyboardHeight } from '@ui/hooks/useKeyboardHeight';
import { Text } from './Text';

/** X-style bottom sheet over a scrim. Tap outside (or the handle) to close. */
export function Sheet(props: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  // A bottom-anchored Modal does not get pushed up by the keyboard on Android
  // (edge-to-edge), so lift the sheet ourselves. The existing safe-area padding
  // already covers `insets.bottom`, so only add the remainder above it.
  const keyboardLift = Math.max(0, keyboardHeight - insets.bottom);
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
          marginBottom: keyboardLift,
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
