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

export interface MapRepository {
  getOneWithEmbedding(
    address: RecordAddress,
    expectedDim: number,
  ): Promise<MapPostSource | null>;
  listForMap(
    self: PeerId,
    limit: number,
    expectedDim: number,
  ): Promise<MapPostSource[]>;
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
  );

  const projection = projectToPlane(
    { address: anchor.address, embedding: anchor.embedding },
    peers.map((p) => ({ address: p.address, embedding: p.embedding })),
    MatchingConfig.mapProjectionMethod,
    MatchingConfig.mapPcaPowerIterations,
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
