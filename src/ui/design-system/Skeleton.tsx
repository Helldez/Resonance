import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';

/** Pulsing placeholder block for loading states. */
export function Skeleton(props: { width?: number | `${number}%`; height?: number; round?: boolean }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  const height = props.height ?? T.font.lineHeight.base;
  return (
    <Animated.View
      style={{
        width: props.width ?? '100%',
        height,
        borderRadius: props.round === true ? T.radius.pill : T.radius.sm,
        backgroundColor: T.color.bgElevated,
        opacity,
      }}
    />
  );
}
