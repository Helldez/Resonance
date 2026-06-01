import { MatchingConfig } from '@core/config/MatchingConfig';
import { projectToPlane } from '@core/matching/Project2D';
import type { Plotted2D } from '@core/matching/Project2D';
import type { PeerId, RecordAddress } from '@core/domain/types';

export interface MapCandidate {
  readonly address: RecordAddress;
  readonly author: PeerId;
  readonly text: string;
  readonly createdAt: number;
}

export interface MapView {
  readonly anchor: MapCandidate & { readonly plot: Plotted2D };
  readonly peers: ReadonlyArray<MapCandidate & { readonly plot: Plotted2D }>;
}

export interface MapPostSource {
  readonly address: RecordAddress;
  readonly author: PeerId;
  readonly text: string;
  readonly embedding: Float32Array;
  readonly createdAt: number;
}

export interface ListForMapOptions {
  /**
   * Include the user's OWN posts in the candidate set (default false, which
   * keeps the per-post map focused on peers). The global "my posts" map sets
   * this so every own post is plotted, not just the anchor.
   */
  readonly includeSelf?: boolean;
  /** Address to omit (the anchor, added separately to avoid a duplicate). */
  readonly excludeAddress?: RecordAddress;
}

export interface MapRepository {
  getOneWithEmbedding(
    address: RecordAddress,
    expectedDim: number,
  ): Promise<MapPostSource | null>;
  listForMap(
    self: PeerId,
    limit: number,
    expectedDim: number,
    opts?: ListForMapOptions,
  ): Promise<MapPostSource[]>;
}

export interface GetMapViewOptions {
  /** Plot the user's own posts too (the global "my posts" map). */
  readonly includeSelf?: boolean;
}

/**
 * Builds the data the map screen needs: the anchor post (the one the
 * user just published) plus its 2D-projected neighbours from the local
 * cache. This is Option A in `docs/SEMANTIC_ROUTING.md` — no network
 * round-trips, the candidate set is whatever the device has already
 * received via Hyperswarm replication.
 *
 * Pure core: depends only on `MapRepository` (a port-shaped contract,
 * not the concrete SQLite class).
 */
export async function getMapView(
  deps: { posts: MapRepository; self: PeerId },
  anchorAddress: RecordAddress,
  opts: GetMapViewOptions = {},
): Promise<MapView | null> {
  const dim = MatchingConfig.embeddingDim;
  const anchor = await deps.posts.getOneWithEmbedding(anchorAddress, dim);
  if (anchor === null) {
    return null;
  }
  const peers = await deps.posts.listForMap(
    deps.self,
    MatchingConfig.mapMaxCandidates,
    dim,
    { includeSelf: opts.includeSelf === true, excludeAddress: anchorAddress },
  );

  const projection = projectToPlane(
    { address: anchor.address, embedding: anchor.embedding },
    peers.map((p) => ({ address: p.address, embedding: p.embedding })),
    MatchingConfig.mapProjectionMethod,
    MatchingConfig.mapPcaPowerIterations,
    MatchingConfig.mapRadialAnisotropyFloor,
  );

  const anchorOut = {
    address: anchor.address,
    author: anchor.author,
    text: anchor.text,
    createdAt: anchor.createdAt,
    plot: projection.anchor,
  };

  const peerByAddress = new Map<string, MapPostSource>();
  for (const p of peers) {
    peerByAddress.set(p.address, p);
  }
  const peersOut: Array<MapCandidate & { readonly plot: Plotted2D }> = [];
  for (const plot of projection.peers) {
    if (plot.similarityToAnchor < MatchingConfig.mapMinSimilarityToPlot) {
      continue;
    }
    const src = peerByAddress.get(plot.address);
    if (src === undefined) {
      continue;
    }
    peersOut.push({
      address: src.address,
      author: src.author,
      text: src.text,
      createdAt: src.createdAt,
      plot,
    });
  }
  return { anchor: anchorOut, peers: peersOut };
}
