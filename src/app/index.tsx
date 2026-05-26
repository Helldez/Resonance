import { View, FlatList } from 'react-native';
import { Text, Button, Card, useTheme } from 'react-native-paper';
import { Link } from 'expo-router';
import { useInboxStore } from '@domain/InboxStore';

export default function InboxScreen() {
  const items = useInboxStore((s) => s.items);
  const theme = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 12 }}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <Link href="/compose" asChild>
          <Button mode="contained">New post</Button>
        </Link>
        <Link href="/settings" asChild>
          <Button mode="outlined">Settings</Button>
        </Link>
      </View>

      {items.length === 0 ? (
        <Text style={{ opacity: 0.6, marginTop: 24, textAlign: 'center' }}>
          No incoming posts match your interest profile yet.
        </Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.address}
          renderItem={({ item }) => (
            <Link href={{ pathname: '/thread/[id]', params: { id: item.address } }} asChild>
              <Card style={{ marginBottom: 8 }}>
                <Card.Content>
                  <Text numberOfLines={3}>{item.post.text}</Text>
                  <Text style={{ marginTop: 4, opacity: 0.6, fontSize: 12 }}>
                    similarity {item.similarity.toFixed(2)}
                  </Text>
                </Card.Content>
              </Card>
            </Link>
          )}
        />
      )}
    </View>
  );
}
