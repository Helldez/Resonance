import { Stack } from 'expo-router';
import { View } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { lightTheme } from '@ui/theme/theme';
import { AppContainerProvider, useAppContainer } from '@ui/AppContainerContext';
import { useBootstrapStore } from '@domain/BootstrapStore';
import BootstrapScreen from './bootstrap';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={lightTheme}>
        <AppContainerProvider>
          <Gate />
        </AppContainerProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

function Gate() {
  const container = useAppContainer();
  const stage = useBootstrapStore((s) => s.stage);
  if (container === null || stage !== 'ready') {
    return (
      <View style={{ flex: 1 }}>
        <BootstrapScreen />
      </View>
    );
  }
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Inbox' }} />
      <Stack.Screen name="compose" options={{ title: 'New post' }} />
      <Stack.Screen name="thread/[id]" options={{ title: 'Thread' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="bootstrap" options={{ headerShown: false }} />
    </Stack>
  );
}
