import { useEffect, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { Text, Card, Button, ActivityIndicator, useTheme } from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';
import { useRequireContainer } from '@ui/AppContainerContext';

interface ThreadPost {
  readonly address: string;
  readonly author: string;
  readonly text: string;
  readonly createdAt: number;
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
  const [post, setPost] = useState<ThreadPost | null>(null);
  const [responses, setResponses] = useState<ThreadResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      const postRows = await container.database.query<{
        address: string;
        author: string;
        text: string;
        created_at: number;
      }>('SELECT address, author, text, created_at FROM posts WHERE address = ? LIMIT 1', [id]);
      if (cancelled) {
        return;
      }
      if (postRows.length > 0) {
        const r = postRows[0];
        setPost({
          address: r.address,
          author: r.author,
          text: r.text,
          createdAt: r.created_at,
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
      if (cancelled) {
        return;
      }
      setResponses(
        respRows.map((r) => ({
          address: r.address,
          author: r.author,
          text: r.text,
          createdAt: r.created_at,
        })),
      );
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [container, id]);

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
        <Text style={{ marginTop: 8, opacity: 0.6 }}>
          Waiting for peers to answer. This flow wires up in M3 (network) and
          M4 (response drafting).
        </Text>
      )}

      <Button mode="outlined" style={{ marginTop: 24 }} disabled>
        Draft a response (M4)
      </Button>
    </ScrollView>
  );
}

function shortPeer(peer: string): string {
  if (peer.length <= 12) {
    return peer;
  }
  return `${peer.slice(0, 6)}…${peer.slice(-4)}`;
}
