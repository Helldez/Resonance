import { View } from 'react-native';
import type { ReactNode } from 'react';
import { DesignTokens as T } from '@core/config/DesignTokens';

/**
 * Centered X-style content column: full width on phones, capped at
 * `size.contentMaxWidth` and centered on wide desktop windows so screens
 * don't stretch edge-to-edge.
 */
export function ContentColumn(props: { children: ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        width: '100%',
        maxWidth: T.size.contentMaxWidth,
        alignSelf: 'center',
      }}
    >
      {props.children}
    </View>
  );
}
