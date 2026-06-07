/**
 * Pure grouping of the flat inbox rows into the feed's render units. No
 * React, no DB — unit-testable in plain Node (see scripts/test/feed-group).
 */

export interface FeedRow {
  readonly address: string;
  readonly author: string;
  readonly text: string;
  readonly similarity: number | null;
  readonly matchedOwnAddress: string | null;
  readonly createdAt: number;
}

/**
 * Flattened render units for the grouped feed. Each of the user's own posts
 * is an anchor; the remote posts that matched it (their MAX cosine) are
 * nested beneath it, most-similar first. Remote posts with no own match
 * (cold start, or a match to an own post not in view) fall into the
 * "Based on your interests" group.
 */
export type FeedItem =
  | { readonly kind: 'own'; readonly row: FeedRow; readonly childCount: number }
  | { readonly kind: 'child'; readonly row: FeedRow }
  | { readonly kind: 'orphan-header'; readonly count: number }
  | { readonly kind: 'orphan'; readonly row: FeedRow };

/**
 * Group the flat rows into anchors (own posts) + their matched remote posts,
 * with a trailing "Based on your interests" group for unmatched remotes.
 * Resonances are collapsed by default; only groups whose anchor address is
 * in `expanded` emit their children.
 */
export function groupFeed(
  rows: readonly FeedRow[],
  self: string,
  expanded: ReadonlySet<string>,
): FeedItem[] {
  const ownPosts: FeedRow[] = [];
  const ownAddresses = new Set<string>();
  for (const r of rows) {
    if (r.author === self) {
      ownPosts.push(r);
      ownAddresses.add(r.address);
    }
  }

  const childrenByOwn = new Map<string, FeedRow[]>();
  const orphans: FeedRow[] = [];
  for (const r of rows) {
    if (r.author === self) {
      continue;
    }
    const parent = r.matchedOwnAddress;
    if (parent !== null && ownAddresses.has(parent)) {
      const list = childrenByOwn.get(parent);
      if (list === undefined) {
        childrenByOwn.set(parent, [r]);
      } else {
        list.push(r);
      }
    } else {
      orphans.push(r);
    }
  }

  const bySimilarityDesc = (a: FeedRow, b: FeedRow): number =>
    (b.similarity ?? -Infinity) - (a.similarity ?? -Infinity);

  const out: FeedItem[] = [];
  // Own posts are already in created_at DESC order from the query.
  for (const own of ownPosts) {
    const children = (childrenByOwn.get(own.address) ?? []).sort(bySimilarityDesc);
    out.push({ kind: 'own', row: own, childCount: children.length });
    if (expanded.has(own.address)) {
      for (const child of children) {
        out.push({ kind: 'child', row: child });
      }
    }
  }
  if (orphans.length > 0) {
    orphans.sort(bySimilarityDesc);
    out.push({ kind: 'orphan-header', count: orphans.length });
    for (const o of orphans) {
      out.push({ kind: 'orphan', row: o });
    }
  }
  return out;
}
