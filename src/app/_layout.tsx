import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { lightTheme } from '@ui/theme/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={lightTheme}>
        <Stack>
          <Stack.Screen name="bootstrap" options={{ headerShown: false }} />
          <Stack.Screen name="index" options={{ title: 'Inbox' }} />
          <Stack.Screen name="compose" options={{ title: 'New post' }} />
          <Stack.Screen name="thread/[id]" options={{ title: 'Thread' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        </Stack>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
