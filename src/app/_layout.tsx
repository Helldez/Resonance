import { Stack } from 'expo-router';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { darkTheme } from '@ui/theme/theme';
import { AppContainerProvider, useAppContainer } from '@ui/AppContainerContext';
import { useBootstrapStore } from '@domain/BootstrapStore';
import BootstrapScreen from './bootstrap';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PaperProvider theme={darkTheme}>
          <StatusBar style="light" />
          <AppContainerProvider>
            <Gate />
          </AppContainerProvider>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
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
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: darkTheme.colors.surface },
        headerTintColor: darkTheme.colors.onSurface,
        contentStyle: { backgroundColor: darkTheme.colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Feed' }} />
      <Stack.Screen name="compose" options={{ title: 'New post' }} />
      <Stack.Screen name="map" options={{ headerShown: false }} />
      <Stack.Screen name="thread/[id]" options={{ title: 'Thread' }} />
      <Stack.Screen name="agent" options={{ title: 'My agent' }} />
      <Stack.Screen name="approvals" options={{ title: 'To approve' }} />
      <Stack.Screen name="activity" options={{ title: 'Agent activity' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="bootstrap" options={{ headerShown: false }} />
    </Stack>
  );
}
