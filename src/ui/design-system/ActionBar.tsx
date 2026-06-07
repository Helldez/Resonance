import { Pressable, View } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

function Action(props: {
  icon: IconName;
  label: string;
  count?: number;
  active?: boolean;
  activeColor?: string;
  onPress?: () => void;
}) {
  const color = props.active === true ? (props.activeColor ?? T.color.accent) : T.color.textMuted;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.onPress === undefined}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      hitSlop={T.space.sm}
      style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.xs }}
    >
      <Icon
        name={props.icon}
        size={T.size.iconSmall}
        color={color}
        filled={props.active === true && props.icon === 'heart'}
      />
      {(props.count ?? 0) > 0 && (
        <Text variant="small" color={color}>
          {String(props.count)}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * X-style bottom action row for a post: ghost icons + counts, muted until
 * active. Replaces the old Paper ReactionRow. The reaction vocabulary is a
 * single "like" (see domain types) rendered as a heart.
 */
export function ActionBar(props: {
  likeCount: number;
  liked: boolean;
  onLike: () => void;
  commentCount?: number;
  onComment?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: T.space.xxxl,
        marginTop: T.space.sm,
      }}
    >
      {props.onComment !== undefined && (
        <Action
          icon="reply"
          label="Open thread"
          count={props.commentCount}
          onPress={props.onComment}
        />
      )}
      <Action
        icon="heart"
        label="Like"
        count={props.likeCount}
        active={props.liked}
        onPress={props.onLike}
      />
    </View>
  );
}
