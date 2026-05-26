import { useCallback, useEffect, useState } from 'react';
import { View, ScrollView } from 'react-native';
import {
  Text,
  Card,
  Button,
  TextInput,
  ActivityIndicator,
  HelperText,
  useTheme,
} from 'react-native-paper';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useSettingsStore } from '@domain/SettingsStore';
import { draftResponse } from '@core/responses/DraftResponse';
import { publishResponse } from '@core/responses/PublishResponse';
import type { RecordAddress, ScoredPost } from '@core/domain/types';
import { cosineOnUnit } from '@core/matching/CosineSimilarity';
import { addressOf } from '@core/utils/AddressOf';

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
  const receiverContext = useSettingsStore((s) => s.receiverContext);

  const [post, setPost] = useState<ThreadPost | null>(null);
  const [responses, setResponses] = useState<ThreadResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [publishing, setPublishing] = useState(false);
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
    setLoading(false);
  }, [container, id]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
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
          bucket: '' as ScoredPost['post']['bucket'],
          createdAt: post.createdAt,
        },
        similarity: cosineOnUnit(embedding, embedding),
      };

      const { draftText } = await draftResponse(
        { llm: container.llm },
        { post: scored, receiverContext },
      );
      setDraft(draftText);
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
      contentContainerStyle={{ padding: 12 }}
    >
      {post !== null ? (
        <Card>
          <Card.Content>
            <Text variant="bodyMedium">{post.text}</Text>
            <Text style={{ marginTop: 8, opacity: 0.6, fontSize: 12 }}>
              {shortPeer(post.author)} · {new Date(post.createdAt).toLocaleString()}
            </Text>
          </Card.Content>
        </Card>
      ) : (
        <Text>Post not found in local database.</Text>
      )}

      <Text variant="titleSmall" style={{ marginTop: 16 }}>
        Responses ({responses.length})
      </Text>

      {responses.map((r) => (
        <Card key={r.address} style={{ marginTop: 8 }}>
          <Card.Content>
            <Text>{r.text}</Text>
            <Text style={{ marginTop: 4, opacity: 0.6, fontSize: 12 }}>
              {shortPeer(r.author)}
            </Text>
          </Card.Content>
        </Card>
      ))}

      {responses.length === 0 && (
        <Text style={{ marginTop: 8, opacity: 0.6 }}>No responses yet.</Text>
      )}

      {post !== null && post.author !== container.self && (
        <View style={{ marginTop: 24 }}>
          <Button
            mode="outlined"
            onPress={() => {
              void generateDraft();
            }}
            loading={drafting}
            disabled={drafting || publishing}
          >
            Draft a response
          </Button>

          {draft.length > 0 && (
            <>
              <TextInput
                mode="outlined"
                multiline
                numberOfLines={6}
                value={draft}
                onChangeText={setDraft}
                style={{ marginTop: 12 }}
              />
              {error !== null && <HelperText type="error">{error}</HelperText>}
              <Button
                mode="contained"
                onPress={() => {
                  void publish();
                }}
                loading={publishing}
                disabled={publishing || draft.trim().length === 0}
                style={{ marginTop: 8 }}
              >
                Publish response
              </Button>
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
