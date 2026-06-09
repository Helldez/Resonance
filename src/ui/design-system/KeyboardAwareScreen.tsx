import { useEffect, useRef, type ReactNode } from 'react';
import {
  Dimensions,
  ScrollView,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { useKeyboardHeight } from '@ui/hooks/useKeyboardHeight';

/** Let the keyboard frame and layout settle before measuring the focused field. */
const MEASURE_SETTLE_MS = 50;
/** Scroll-event cadence (ms) — we only need a coarse running offset. */
const SCROLL_THROTTLE_MS = 16;

/**
 * Scrollable form container that keeps the focused field above the soft
 * keyboard. Edge-to-edge Android no longer resizes the window when the keyboard
 * opens, so we offset ourselves: pad the scroll content by the keyboard height
 * and, when an input gains focus under the keyboard, scroll it just clear of the
 * keyboard top. Dependency-free (RN `Keyboard` + `measureInWindow`), which is
 * why the bottom inset is applied as content padding rather than via a native
 * keyboard-avoiding view.
 */
export function KeyboardAwareScreen(props: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  const keyboardHeight = useKeyboardHeight();

  useEffect(() => {
    if (keyboardHeight <= 0) {
      return;
    }
    const focused = TextInput.State.currentlyFocusedInput();
    if (focused === null) {
      return;
    }
    // Measure after the keyboard frame has settled, then scroll only by the
    // amount the field is hidden behind the keyboard (plus a small margin).
    const timer = setTimeout(() => {
      focused.measureInWindow((_x, y, _w, h) => {
        const keyboardTop = Dimensions.get('window').height - keyboardHeight;
        const hiddenBy = y + h + T.space.lg - keyboardTop;
        if (hiddenBy > 0) {
          scrollRef.current?.scrollTo({ y: offsetRef.current + hiddenBy, animated: true });
        }
      });
    }, MEASURE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [keyboardHeight]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    offsetRef.current = e.nativeEvent.contentOffset.y;
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={props.style}
      contentContainerStyle={props.contentContainerStyle}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={SCROLL_THROTTLE_MS}
      onScroll={onScroll}
    >
      {props.children}
      {/* Extra scrollable room so the focused field can clear the keyboard.
          Added as a spacer (not contentContainerStyle padding) so it always
          stacks on top of the caller's own paddingBottom instead of replacing
          it. */}
      <View style={{ height: keyboardHeight }} />
    </ScrollView>
  );
}
