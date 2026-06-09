import { useEffect, useRef, useState } from 'react';
import { Animated, View, type LayoutChangeEvent } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';

/** Fraction of the track the moving segment occupies, and one sweep's duration. */
const SEGMENT_FRACTION = 0.4;
const SWEEP_MS = 1100;

/**
 * Indeterminate progress bar: a segment sweeping a muted track, for work with
 * no measurable progress (e.g. loading an already-downloaded model into
 * memory). Built on RN's `Animated` so it needs no extra dependency. Pairs with
 * `ProgressBar`, which is for determinate byte progress.
 */
export function IndeterminateBar(props: { color?: string }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: SWEEP_MS,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const onLayout = (e: LayoutChangeEvent): void => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-trackWidth * SEGMENT_FRACTION, trackWidth],
  });

  return (
    <View
      accessibilityRole="progressbar"
      onLayout={onLayout}
      style={{
        height: T.size.progressBarHeight,
        borderRadius: T.radius.pill,
        backgroundColor: T.color.bgElevated,
        overflow: 'hidden',
        alignSelf: 'stretch',
      }}
    >
      <Animated.View
        style={{
          width: `${SEGMENT_FRACTION * 100}%`,
          height: '100%',
          borderRadius: T.radius.pill,
          backgroundColor: props.color ?? T.color.accent,
          transform: [{ translateX }],
        }}
      />
    </View>
  );
}
