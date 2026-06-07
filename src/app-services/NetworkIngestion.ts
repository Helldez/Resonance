import type { PlatformContainer } from '@platform/PlatformContainer';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { RoomConfig } from '@core/config/RoomConfig';
import { decideAdmission } from '@core/inbox/InboxAdmission';
import { ingestAnnouncement } from '@core/inbox/IngestAnnouncement';
import { rerankAnnouncements } from '@core/inbox/RerankAnnouncements';
import { addressOf, parseAddress } from '@core/utils/AddressOf';
import { canonicalDigest } from '@core/utils/CanonicalRecord';
import { validateRecordBody } from '@core/validation/ValidateRecordBody';
import { cosineOnUnit } from '@core/matching/CosineSimilarity';
import type { Announcement, RecordAddress, SignedRecord } from '@core/domain/types';

/**
 * Network ingestion orchestration: the receive-side of the announce-then-pull
 * model (Tier-1 ranking, pulls, verified Tier-2 admission), the live matching
 * basis (own-post embeddings + the rescore/rerank paths), and the serialized
 * ingest queue. Pure orchestration over the `PlatformContainer` — no React.
 */

/** An own post embedding tagged with the address of the post it came from. */
export interface OwnEmbedding {
  readonly address: RecordAddress;
  readonly embedding: Float32Array;
}

/**
 * The list of the local user's post embeddings, used by the receiver-side
 * similarity scorer. Mutated in place when the user (or the agent) composes
 * a new post; replaced wholesale at boot from the DB.
 *
 * Module-level because the Compose/Approvals screens need to push into it
 * without going through the React tree.
 */
const ownEmbeddings: { current: OwnEmbedding[] } = { current: [] };

export function appendOwnEmbedding(address: RecordAddress, v: Float32Array): void {
  ownEmbeddings.current.push({ address, embedding: v });
}

export function setOwnEmbeddings(list: OwnEmbedding[]): void {
  ownEmbeddings.current = list;
}

export function getOwnEmbeddingsSnapshot(): ReadonlyArray<OwnEmbedding> {
  return ownEmbeddings.current;
}

/**
 * Serialized ingest queue for announcements and pulled records.
 *
 * Admission reads the inbox count and weakest occupant from SQLite before
 * deciding; with concurrent handlers a burst of N announcements all read the
 * same stale state and the capacity rule is bypassed (observed in the 400-post
 * stress test: a 457-announcement burst grew the K=200 inbox to 421). One
 * task at a time makes every decision see the state the previous one
 * committed. Network pulls are NOT awaited inside the queue — they resolve
 * through `onRecord`, which enqueues its own task.
 */
let ingestQueue: Promise<void> = Promise.resolve();

export function enqueueIngest(task: () => Promise<void>): void {
  ingestQueue = ingestQueue.then(task).catch((e) => {
    console.warn(`[rn] ingest task failed: ${e instanceof Error ? e.message : String(e)}`);
  });
}

/**
 * Re-score every remote post in the inbox against the user's current own
 * posts. Called after publishing a post: the set of own posts just grew, so
 * each remote post's MAX-cosine similarity (and the own post it matched) may
 * have changed. This keeps the grouped inbox correct — a remote post received
 * before post #k can now be grouped under post #k — and resolves the cold→warm
 * transition (old About-you-based scores are overwritten with own-post scores,
 * restoring a single comparable metric for inbox eviction).
 */
export async function rescoreInboxAgainstOwnPosts(c: PlatformContainer): Promise<void> {
  const own = getOwnEmbeddingsSnapshot();
  if (own.length === 0) {
    return;
  }
  const remote = await c.posts.getRemoteEmbeddings(c.self, MatchingConfig.embeddingDim);
  for (const post of remote) {
    const { similarity, matchedOwnAddress } = scoreRemotePost(post.embedding, own, null);
    await c.posts.updateScore(post.address, similarity, matchedOwnAddress);
  }
  console.log(`[rn] rescored inbox count=${remote.length} ownPosts=${own.length}`);
  // The matching basis changed, so Tier-1 summaries that lost the admission
  // race earlier may now rank inside the top-K — give them their shot too.
  await rerankTier1AndPull(c, null);
}

/**
 * Re-score every Tier-1 post summary against the current interest signals and
 * pull the not-yet-pulled winners. Runs whenever the matching basis changes
 * (the user edited "About you", or published a post): announcements received
 * earlier — possibly scored against an empty profile — get re-ranked now
 * instead of waiting for the next boot rescan. Each pulled body still goes
 * through the verified re-score + admission in `persistRecord`.
 */
export async function rerankTier1AndPull(
  c: PlatformContainer,
  interestProfile: Float32Array | null,
): Promise<void> {
  const candidates = await c.announcements.listPostsForRerank(MatchingConfig.embeddingDim);
  if (candidates.length === 0) {
    return;
  }
  const { scores, toPull } = rerankAnnouncements({
    candidates,
    ownEmbeddings: getOwnEmbeddingsSnapshot(),
    interestProfile,
    config: {
      capacity: RoomConfig.inboxCapacity,
      minSimilarity: RoomConfig.inboxMinSimilarity,
    },
  });
  for (const s of scores) {
    await c.announcements.updateScore(s.address, s.similarity);
  }
  for (const address of toPull) {
    const { author, feedIndex } = parseAddress(address);
    void c.network.requestPull(author, feedIndex).catch((e) => {
      console.warn(
        `[rn] rerank pull failed for ${String(author).slice(0, 12)}:${feedIndex}: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
  }
  console.log(`[rn] reranked tier1 candidates=${candidates.length} toPull=${toPull.length}`);
}

/**
 * Receive-side handler for a gossiped announcement (the high-volume path).
 * Ranks the lightweight summary against the user's own posts, keeps it in
 * Tier-1, and — only if it earns an inbox slot on the UNVERIFIED announced
 * embedding — asks the worker to pull the full body. Nothing is trusted here;
 * authenticity and the real admission are settled in `persistRecord` once the
 * body arrives. Our own announcements are skipped (we already hold the post).
 */
export async function handleAnnouncement(
  c: PlatformContainer,
  announcement: Announcement,
  ownEmbeddings: ReadonlyArray<OwnEmbedding>,
  interestProfile: Float32Array | null,
): Promise<void> {
  if (announcement.author === c.self) {
    return;
  }
  // Re-gossips and boot rescans re-emit announcements whose bodies we already
  // hold; skip them entirely — re-pulling is wasted bandwidth and the Tier-2
  // score is authoritative once the body is committed.
  const address = addressOf(announcement.author, announcement.feedIndex);
  if (await c.announcements.isPulled(address)) {
    return;
  }
  const currentInboxCount = await c.posts.countRemotePosts(c.self);
  const inboxMin = await c.posts.minSimilarityRemotePost(c.self);
  const result = ingestAnnouncement({
    announcement,
    ownEmbeddings,
    interestProfile,
    currentInboxCount,
    inboxMin,
    config: {
      capacity: RoomConfig.inboxCapacity,
      minSimilarity: RoomConfig.inboxMinSimilarity,
    },
  });
  await c.announcements.upsert(announcement, result.score.similarity);
  await c.announcements.enforceCap(RoomConfig.announceTier1Capacity);
  if (result.shouldPull) {
    // Fire-and-forget: this handler runs on the serialized ingest queue, and
    // a pull is a network round-trip (up to RoomConfig.pullTimeoutMs). The
    // body lands in `onRecord`, which enqueues its own task.
    void c.network.requestPull(announcement.author, announcement.feedIndex).catch((e) => {
      console.warn(
        `[rn] pull request failed for ${String(announcement.author).slice(0, 12)}:${announcement.feedIndex}: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
  }
}

export async function persistRecord(
  c: PlatformContainer,
  record: SignedRecord,
  ownEmbeddings: ReadonlyArray<OwnEmbedding>,
  interestProfile: Float32Array | null,
): Promise<void> {
  const shortAuthor = String(record.author).slice(0, 12);

  // Untrusted input is bounded BEFORE the expensive digest/signature work:
  // a hostile peer controls every field, so an oversized text or a
  // wrong-dimension embedding is dropped up front rather than stored.
  const limits = validateRecordBody(record.body, {
    maxPostChars: RoomConfig.maxPostChars,
    maxResponseChars: RoomConfig.maxResponseChars,
    embeddingDim: MatchingConfig.embeddingDim,
  });
  if (!limits.ok) {
    console.warn(`[rn] persistRecord REJECTED author=${shortAuthor} reason=${limits.reason}`);
    return;
  }

  const expectedDigest = await canonicalDigest(record.body);
  if (!bytesEqual(expectedDigest, record.digest)) {
    console.warn(
      `[rn] persistRecord DIGEST MISMATCH author=${shortAuthor} expected=${bytesToHexShort(expectedDigest)} got=${bytesToHexShort(record.digest)}`,
    );
    return;
  }
  const sigOk = await c.identity.verify(record.digest, record.signature, record.author);
  if (!sigOk) {
    console.warn(`[rn] persistRecord SIGNATURE INVALID author=${shortAuthor}`);
    return;
  }
  const address = addressOf(record.author, record.feedIndex);

  if (record.author !== c.self) {
    // This body arrived because we admitted its announcement and pulled it.
    // Mark the Tier-1 summary pulled so a later re-rank does not request it
    // again (no-op if we have no summary row for it).
    await c.announcements.markPulled(address);
  }

  if (record.body.kind === 'post') {
    const isOwn = record.author === c.self;
    if (isOwn) {
      await c.posts.upsert(address, record.author, record.feedIndex, record.body, null);
      await c.peers.touch(record.author, c.clock.now());
      return;
    }

    // Bounded top-K inbox admission (conf 9). Score the post, then decide
    // whether it earns a slot — drop below threshold, admit while under
    // capacity, or evict the weakest occupant when the newcomer beats it.
    const { similarity, matchedOwnAddress } = scoreRemotePost(
      record.body.embedding,
      ownEmbeddings,
      interestProfile,
    );
    const currentCount = await c.posts.countRemotePosts(c.self);
    const min = await c.posts.minSimilarityRemotePost(c.self);
    const decision = decideAdmission({
      similarity,
      currentCount,
      min,
      config: {
        capacity: RoomConfig.inboxCapacity,
        minSimilarity: RoomConfig.inboxMinSimilarity,
      },
    });
    if (decision.kind === 'reject-threshold' || decision.kind === 'reject-full') {
      console.log(
        `[rn] inbox drop author=${shortAuthor} similarity=${similarity === null ? 'null' : similarity.toFixed(3)} reason=${decision.kind}`,
      );
      return;
    }
    if (decision.kind === 'replace') {
      await c.posts.delete(decision.evict);
    }
    await c.posts.upsert(
      address,
      record.author,
      record.feedIndex,
      record.body,
      similarity,
      matchedOwnAddress,
    );
    console.log(
      `[rn] inbox ${decision.kind} author=${shortAuthor} similarity=${similarity === null ? 'null' : similarity.toFixed(3)} count=${currentCount}`,
    );
    await c.peers.touch(record.author, c.clock.now());
    return;
  }

  if (record.body.kind === 'reaction') {
    await c.reactions.applyFromRecord(
      address,
      record.author,
      record.feedIndex,
      record.body,
    );
    await c.peers.touch(record.author, c.clock.now());
    return;
  }

  await c.responses.upsert(address, record.author, record.feedIndex, record.body);
  await c.peers.touch(record.author, c.clock.now());
}

/** Result of scoring an incoming post against the local context. */
export interface RemoteScore {
  /** MAX cosine vs own posts, or the About-you fallback; null if unscorable. */
  readonly similarity: number | null;
  /**
   * Address of the own post that produced the MAX cosine, so the inbox can
   * group this remote post beneath it. Null on the cold-start (About-you)
   * path, where there is no own post to attribute the match to.
   */
  readonly matchedOwnAddress: RecordAddress | null;
}

/**
 * Receiver-side scoring for an incoming post.
 *
 * Primary signal: max cosine against the user's own post embeddings — what
 * the user has actually written about is a stronger signal than what they
 * declared in "About you". Also reports which own post won the max, so the
 * inbox can group the remote post under it.
 *
 * Cold-start fallback: cosine against the interest profile (embedding of
 * the "About you" text). Used until the user has at least one post; the
 * matched address is null because there is no own post to attribute it to.
 *
 * `similarity` is null only if neither signal is available.
 */
export function scoreRemotePost(
  postEmbedding: Float32Array,
  ownEmbeddings: ReadonlyArray<OwnEmbedding>,
  interestProfile: Float32Array | null,
): RemoteScore {
  if (ownEmbeddings.length > 0) {
    let best = -Infinity;
    let bestIndex = -1;
    for (let i = 0; i < ownEmbeddings.length; i++) {
      try {
        const s = cosineOnUnit(postEmbedding, ownEmbeddings[i].embedding);
        if (s > best) {
          best = s;
          bestIndex = i;
        }
      } catch {
        // dimension mismatch on a stale embedding — skip it
      }
    }
    if (bestIndex >= 0) {
      return {
        similarity: best,
        matchedOwnAddress: ownEmbeddings[bestIndex].address,
      };
    }
  }
  if (interestProfile !== null) {
    try {
      return {
        similarity: cosineOnUnit(postEmbedding, interestProfile),
        matchedOwnAddress: null,
      };
    } catch {
      return { similarity: null, matchedOwnAddress: null };
    }
  }
  return { similarity: null, matchedOwnAddress: null };
}

function bytesToHexShort(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < Math.min(bytes.length, 6); i++) {
    const b = bytes[i];
    hex += (b >>> 4).toString(16);
    hex += (b & 0xf).toString(16);
  }
  return hex;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
