import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { AppContainerProvider, useAppContainer } from '@ui/AppContainerContext';
import { useBootstrapStore } from '@domain/BootstrapStore';
import { useSettingsStore } from '@domain/SettingsStore';
import { Splash } from '@ui/Splash';
import { OnboardingFlow } from '@ui/onboarding/OnboardingFlow';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AppContainerProvider>
          <Gate />
        </AppContainerProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Routing gate: settings hydration → first-run onboarding → boot splash →
 * the app (tab shell + pushed screens). Onboarding renders while the
 * container boots in the background, so the model download overlaps the
 * user's first 90 seconds instead of blocking them.
 */
function Gate() {
  const container = useAppContainer();
  const stage = useBootstrapStore((s) => s.stage);
  const onboardingDone = useSettingsStore((s) => s.onboardingDone);
  const receiverContext = useSettingsStore((s) => s.receiverContext);
  const displayName = useSettingsStore((s) => s.displayName);
  // Hydration-safe: the static web export renders the Splash, so the FIRST
  // client render must match it unconditionally (reading hasHydrated() during
  // render races zustand's async rehydrate and caused React #418 on desktop).
  // The effect then flips to the real state after mount.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (useSettingsStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useSettingsStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  if (!hydrated) {
    return <Splash />;
  }

  // Installs that predate the onboarding flag have settings already filled
  // in — never show them the first-run flow.
  const done =
    onboardingDone || receiverContext.trim().length > 0 || displayName.trim().length > 0;
  if (!done) {
    return <OnboardingFlow />;
  }

  if (container === null || stage !== 'ready') {
    return <Splash />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: T.color.bg },
        headerTintColor: T.color.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: T.color.bg },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="compose"
        options={{ headerShown: false, presentation: 'modal' }}
      />
      <Stack.Screen name="thread/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="settings" options={{ headerShown: false }} />
      <Stack.Screen name="agent-settings" options={{ headerShown: false }} />
    </Stack>
  );
}
