import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * Current soft-keyboard height in px (0 when hidden). Driven by RN's native
 * `Keyboard` events, which report the height correctly on Android even under
 * edge-to-edge — where `adjustResize` no longer pushes content, so the app must
 * offset for the keyboard itself. Android emits only the `Did*` events.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
