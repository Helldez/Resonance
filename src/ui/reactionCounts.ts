import { type ReactionType } from '@core/domain/types';

/** Per-target reaction tallies keyed by the reaction vocabulary. */
export type ReactionCounts = Record<ReactionType, number>;

export const EMPTY_REACTION_COUNTS: ReactionCounts = {
  like: 0,
};
