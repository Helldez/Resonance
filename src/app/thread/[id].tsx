import { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Pressable, RefreshControl } from 'react-native';
import { confirmDestructive } from '@ui/confirmDestructive';
import {
  Text,
  Card,
  Button,
  TextInput,
  ActivityIndicator,
  HelperText,
  IconButton,
  useTheme,
} from 'react-native-paper';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';
import { draftResponse } from '@core/responses/DraftResponse';
import { publishResponse } from '@core/responses/PublishResponse';
import { publishReaction } from '@core/reactions/PublishReaction';
import type { RecordAddress, ReactionType, ScoredPost } from '@core/domain/types';
import { cosineOnUnit } from '@core/matching/CosineSimilarity';
import { addressOf } from '@core/utils/AddressOf';
import { MatchingConfig } from '@core/config/MatchingConfig';
import {
  ReactionRow,
  EMPTY_REACTION_COUNTS,
  type ReactionCounts,
} from '@ui/components/ReactionRow';

interface ThreadPost {
  readonly address: string;
  readonly author: string;
  readonly text: string;
  readonly createdAt: number;
  readonly embedding: Uint8Array | null;
}

interface ThreadResponse {
  readonly address: string;
  readonly author: string;
  readonly text: string;
  readonly createdAt: number;
}

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const container = useRequireContainer();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const receiverContext = useSettingsStore((s) => s.receiverContext);

  const [post, setPost] = useState<ThreadPost | null>(null);
  const [responses, setResponses] = useState<ThreadResponse[]>([]);
  const [reactions, setReactions] = useState<
    Map<string, { counts: ReactionCounts; mine: ReactionType | null }>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const postRows = await container.database.query<{
      address: string;
      author: string;
      text: string;
      created_at: number;
      embedding: Uint8Array | null;
    }>(
      'SELECT address, author, text, created_at, embedding FROM posts WHERE address = ? LIMIT 1',
      [id],
    );
    if (postRows.length > 0) {
      const r = postRows[0];
      setPost({
        address: r.address,
        author: r.author,
        text: r.text,
        createdAt: r.created_at,
        embedding: r.embedding,
      });
    }
    const respRows = await container.database.query<{
      address: string;
      author: string;
      text: string;
      created_at: number;
    }>(
      'SELECT address, author, text, created_at FROM responses WHERE in_reply_to = ? ORDER BY created_at ASC',
      [id],
    );
    setResponses(
      respRows.map((r) => ({
        address: r.address,
        author: r.author,
        text: r.text,
        createdAt: r.created_at,
      })),
    );

    const addresses = [id, ...respRows.map((r) => r.address)] as RecordAddress[];
    const [countRows, mineRows] = await Promise.all([
      container.reactions.countsForTargets(addresses),
      container.reactions.myReactionsForTargets(container.self, addresses),
    ]);
    const byTarget = new Map<string, { counts: ReactionCounts; mine: ReactionType | null }>();
    for (const a of addresses) {
      byTarget.set(a, { counts: { ...EMPTY_REACTION_COUNTS }, mine: null });
    }
    for (const cr of countRows) {
      const e = byTarget.get(cr.target);
      if (e !== undefined) {
        e.counts[cr.reaction] = cr.count;
      }
    }
    for (const mr of mineRows) {
      const e = byTarget.get(mr.target);
      if (e !== undefined) {
        byTarget.set(mr.target, { counts: e.counts, mine: mr.reaction });
      }
    }
    setReactions(byTarget);
    setLoading(false);
  }, [container, id]);

  const reactTo = useCallback(
    async (target: string, type: ReactionType): Promise<void> => {
      const mine = reactions.get(target)?.mine ?? null;
      if (mine === type) {
        // Tapping your current reaction clears it locally (cross-peer retract
        // over an append-only feed is a later refinement).
        await container.reactions.clear(container.self, target as RecordAddress);
      } else {
        const record = await publishReaction(
          {
            mailbox: container.mailbox,
            network: container.network,
            identity: container.identity,
            clock: container.clock,
            self: container.self,
          },
          { inReplyTo: target as RecordAddress, reaction: type },
        );
        if (record.body.kind === 'reaction') {
          await container.reactions.applyFromRecord(
            addressOf(record.author, record.feedIndex),
            record.author,
            record.feedIndex,
            record.body,
          );
        }
      }
      await load();
    },
    [container, reactions, load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const id = setInterval(() => {
        void load();
      }, MatchingConfig.uiRefreshIntervalMs);
      return () => {
        clearInterval(id);
      };
    }, [load]),
  );

  const generateDraft = async (): Promise<void> => {
    if (post === null || post.embedding === null) {
      setError('Post has no embedding stored locally; cannot draft.');
      return;
    }
    setDrafting(true);
    setError(null);
    try {
      const embedding = new Float32Array(
        post.embedding.buffer,
        post.embedding.byteOffset,
        post.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT,
      );
      const scored: ScoredPost = {
        address: post.address as RecordAddress,
        author: post.author as ScoredPost['author'],
        post: {
          kind: 'post',
          text: post.text,
          embedding,
          createdAt: post.createdAt,
        },
        similarity: cosineOnUnit(embedding, embedding),
      };

      const { draftText } = await draftResponse(
        { llm: container.llm },
        { post: scored, receiverContext },
      );
      setDraft(draftText);
      setComposing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  };

  const publish = async (): Promise<void> => {
    if (post === null) {
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      const existing = await container.responses.countByAuthorAndPost(
        container.self,
        post.address as RecordAddress,
      );
      if (existing >= MatchingConfig.maxResponsesPerPeerPerPost) {
        setError(
          'You already responded to this post. Long-press your existing response to delete it before publishing a new one.',
        );
        return;
      }
      const record = await publishResponse(
        {
          mailbox: container.mailbox,
          network: container.network,
          identity: container.identity,
          clock: container.clock,
          self: container.self,
        },
        { text: draft, inReplyTo: post.address as RecordAddress },
      );
      if (record.body.kind === 'response') {
        await container.responses.upsert(
          addressOf(record.author, record.feedIndex),
          record.author,
          record.feedIndex,
          record.body,
        );
      }
      setDraft('');
      setComposing(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 32 }}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => {
            void load();
          }}
          tintColor={theme.colors.primary}
        />
      }
    >
      {post !== null ? (
        <Card>
          <Card.Content>
            <Text variant="bodyMedium">{post.text}</Text>
            <Text style={{ marginTop: 8, opacity: 0.6, fontSize: 12 }}>
              {shortPeer(post.author)} · {new Date(post.createdAt).toLocaleString()}
            </Text>
            <ReactionRow
              counts={reactions.get(post.address)?.counts ?? EMPTY_REACTION_COUNTS}
              mine={reactions.get(post.address)?.mine ?? null}
              commentCount={responses.length}
              onReact={(t) => {
                void reactTo(post.address, t);
              }}
            />
          </Card.Content>
        </Card>
      ) : (
        <Text>Post not found in local database.</Text>
      )}

      <Text variant="titleSmall" style={{ marginTop: 16 }}>
        Responses ({responses.length})
      </Text>

      {responses.map((r) => {
        const askDelete = (): void => {
          confirmDestructive(
            'Delete this response?',
            'Removes from your local DB only.',
            () => {
              void (async () => {
                await container.responses.delete(r.address as RecordAddress);
                await load();
              })();
            },
          );
        };
        return (
          <Card key={r.address} style={{ marginTop: 8 }}>
            <Card.Content>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 8,
                }}
              >
                <Pressable
                  onLongPress={askDelete}
                  style={{ flex: 1 }}
                >
                  <Text>{r.text}</Text>
                  <Text style={{ marginTop: 4, opacity: 0.6, fontSize: 12 }}>
                    {shortPeer(r.author)}
                  </Text>
                </Pressable>
                <IconButton
                  icon="delete-outline"
                  size={18}
                  accessibilityLabel="Delete this response"
                  style={{ margin: 0 }}
                  onPress={askDelete}
                />
              </View>
              <ReactionRow
                counts={reactions.get(r.address)?.counts ?? EMPTY_REACTION_COUNTS}
                mine={reactions.get(r.address)?.mine ?? null}
                onReact={(t) => {
                  void reactTo(r.address, t);
                }}
              />
            </Card.Content>
          </Card>
        );
      })}

      {responses.length === 0 && (
        <Text style={{ marginTop: 8, opacity: 0.6 }}>No responses yet.</Text>
      )}

      {post !== null && post.author !== container.self && (
        <View style={{ marginTop: 24 }}>
          {responses.some((r) => r.author === container.self) ? (
            <HelperText type="info">
              You already responded to this post. Tap the trash icon on your
              response above to delete it before writing a new one.
            </HelperText>
          ) : !composing ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                mode="contained"
                icon="pencil"
                onPress={() => {
                  setDraft('');
                  setError(null);
                  setComposing(true);
                }}
                disabled={drafting || publishing}
                style={{ flex: 1 }}
              >
                Write reply
              </Button>
              <Button
                mode="outlined"
                icon="robot-outline"
                onPress={() => {
                  void generateDraft();
                }}
                loading={drafting}
                disabled={drafting || publishing}
                style={{ flex: 1 }}
              >
                Draft with AI
              </Button>
            </View>
          ) : (
            <>
              <TextInput
                mode="outlined"
                multiline
                numberOfLines={6}
                value={draft}
                onChangeText={setDraft}
                placeholder="Write what you'd add — first person, specific, no greetings."
                autoFocus
              />
              {error !== null && <HelperText type="error">{error}</HelperText>}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: 8,
                  flexWrap: 'wrap',
                  rowGap: 8,
                }}
              >
                <Button
                  mode="text"
                  onPress={() => {
                    setComposing(false);
                    setDraft('');
                    setError(null);
                  }}
                  disabled={publishing}
                  compact
                >
                  Cancel
                </Button>
                <View style={{ flex: 1 }} />
                <Button
                  mode="outlined"
                  icon="robot-outline"
                  onPress={() => {
                    void generateDraft();
                  }}
                  loading={drafting}
                  disabled={drafting || publishing}
                  compact
                  style={{ marginRight: 8 }}
                >
                  {draft.trim().length === 0 ? 'AI' : 'Rewrite'}
                </Button>
                <Button
                  mode="contained"
                  icon="send"
                  onPress={() => {
                    void publish();
                  }}
                  loading={publishing}
                  disabled={publishing || draft.trim().length === 0}
                >
                  Publish
                </Button>
              </View>
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function shortPeer(peer: string): string {
  if (peer.length <= 12) {
    return peer;
  }
  return `${peer.slice(0, 6)}…${peer.slice(-4)}`;
}
