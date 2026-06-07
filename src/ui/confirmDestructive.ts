import { Alert, Platform } from 'react-native';

/**
 * Cross-platform destructive-action confirmation prompt.
 *
 * React Native's `Alert.alert` only works on iOS/Android — on react-native-web
 * (Expo web export / Electron desktop) the call is a silent no-op, which
 * makes destructive buttons feel broken. We branch on `Platform.OS` and fall
 * back to the browser's native `window.confirm` on web. Both branches invoke
 * `onConfirm` only when the user actively confirms; cancel does nothing.
 *
 * Keep the API tiny and synchronous from the caller's perspective; the
 * platform's modal is itself blocking enough.
 */
export function confirmDestructive(
  title: string,
  message: string,
  onConfirm: () => void,
  confirmLabel: string = 'Delete',
): void {
  if (Platform.OS === 'web') {
    if (
      typeof window !== 'undefined' &&
      typeof window.confirm === 'function' &&
      window.confirm(`${title}\n\n${message}`)
    ) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
