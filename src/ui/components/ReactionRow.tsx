import { View, Pressable } from 'react-native';
import { Text, Icon, useTheme } from 'react-native-paper';
import { REACTION_TYPES, type ReactionType } from '@core/domain/types';

export type ReactionCounts = Record<ReactionType, number>;

export const EMPTY_REACTION_COUNTS: ReactionCounts = {
  like: 0,
};

/**
 * Presentational reaction bar used on every post and response. The icon
 * vocabulary lives here (it is pure presentation); counts and the user's own
 * reaction are passed in. Tapping a reaction calls `onReact` — the parent
 * decides whether that publishes, changes, or clears it.
 */
const REACTION_ICON: Record<ReactionType, string> = {
  like: 'thumb-up-outline',
};

export function ReactionRow(props: {
  counts: ReactionCounts;
  mine: ReactionType | null;
  commentCount?: number;
  onReact: (reaction: ReactionType) => void;
  onComment?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
      {REACTION_TYPES.map((t) => {
        const selected = props.mine === t;
        const count = props.counts[t] ?? 0;
        const color = selected ? theme.colors.primary : theme.colors.onSurfaceVariant;
        return (
          <Pressable
            key={t}
            onPress={() => props.onReact(t)}
            accessibilityRole="button"
            accessibilityLabel={`React ${t}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 14,
              backgroundColor: selected ? theme.colors.surfaceVariant : 'transparent',
            }}
          >
            <Icon source={REACTION_ICON[t]} size={16} color={color} />
            {count > 0 && (
              <Text variant="labelSmall" style={{ marginLeft: 4, color }}>
                {count}
              </Text>
            )}
          </Pressable>
        );
      })}
      {props.onComment !== undefined && (
        <Pressable
          onPress={props.onComment}
          accessibilityRole="button"
          accessibilityLabel="Open thread"
          style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 }}
        >
          <Icon source="comment-outline" size={16} color={theme.colors.onSurfaceVariant} />
          {(props.commentCount ?? 0) > 0 && (
            <Text variant="labelSmall" style={{ marginLeft: 4, color: theme.colors.onSurfaceVariant }}>
              {props.commentCount}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

/** Build a full ReactionCounts from sparse {reaction,count} rows. */
export function toReactionCounts(rows: ReadonlyArray<{ reaction: ReactionType; count: number }>): ReactionCounts {
  const out: ReactionCounts = { ...EMPTY_REACTION_COUNTS };
  for (const r of rows) {
    out[r.reaction] = r.count;
  }
  return out;
}
