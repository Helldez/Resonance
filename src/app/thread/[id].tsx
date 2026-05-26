import { View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useLocalSearchParams } from 'expo-router';

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, padding: 12 }}>
      <Text variant="titleSmall">Address</Text>
      <Text selectable>{id}</Text>
      <Text style={{ marginTop: 16, opacity: 0.6 }}>
        Thread view — post body, draft response, and aggregated replies will live
        here (M4).
      </Text>
    </View>
  );
}
