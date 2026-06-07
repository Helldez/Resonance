import { View } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { colorForAuthor } from '@ui/colorMath';
import { Text } from './Text';
import { Icon } from './Icon';

/**
 * X-style circular avatar. There are no profile pictures in Resonance —
 * the fill color is derived deterministically from the peer id (same hash
 * the semantic map uses), with the first letter of the local display name
 * or the peer fingerprint as the monogram. `robot` marks the user's agent.
 */
export function Avatar(props: {
  peerId: string;
  label?: string;
  size?: number;
  robot?: boolean;
}) {
  const size = props.size ?? T.size.avatar;
  const source = props.label !== undefined && props.label.trim().length > 0 ? props.label : props.peerId;
  const monogram = source.trim().slice(0, 1).toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: T.radius.pill,
        backgroundColor: colorForAuthor(props.peerId),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {props.robot === true ? (
        <Icon name="robot" size={size * 0.55} color={T.color.accentText} />
      ) : (
        <Text
          variant="bodyBold"
          color={T.color.accentText}
          style={{ fontSize: size * 0.42, lineHeight: size * 0.55 }}
        >
          {monogram}
        </Text>
      )}
    </View>
  );
}
