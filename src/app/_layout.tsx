import { useContext, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { AppContainerProvider, useAppContainer } from '@ui/AppContainerContext';
import { useBootstrapStore } from '@domain/BootstrapStore';
import { useSettingsStore } from '@domain/SettingsStore';
import { useModelDownloadStore } from '@domain/ModelDownloadStore';
import { Splash } from '@ui/Splash';
import { OnboardingFlow } from '@ui/onboarding/OnboardingFlow';
import { ModelDownloadIndicator } from '@ui/components/ModelDownloadIndicator';

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
  // Hydration-safe: the static web export renders the Splash, so the FIRST
  // client render must match it unconditionally (reading hasHydrated() during
  // render races zustand's async rehydrate and caused React #418 on desktop).
  // The effect then flips to the real state after mount.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const markHydrated = (): void => {
      // Installs that predate the onboarding flag have settings already
      // filled in — migrate them to onboardingDone ONCE, at hydration.
      // This check must NOT live in render: evaluated live, the first
      // character typed into the onboarding name field flipped it and
      // unmounted the whole flow mid-typing.
      const s = useSettingsStore.getState();
      if (
        !s.onboardingDone &&
        (s.receiverContext.trim().length > 0 || s.displayName.trim().length > 0)
      ) {
        s.setOnboardingDone(true);
      }
      setHydrated(true);
    };
    if (useSettingsStore.persist.hasHydrated()) {
      markHydrated();
      return;
    }
    return useSettingsStore.persist.onFinishHydration(markHydrated);
  }, []);

  if (!hydrated) {
    return <Splash />;
  }

  if (!onboardingDone) {
    return <OnboardingFlow />;
  }

  if (container === null || stage !== 'ready') {
    return <Splash />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: T.color.bg }}>
      <ModelDownloadIndicator />
      <DownloadTopInset>
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
      </DownloadTopInset>
    </View>
  );
}

/**
 * The download indicator owns the top safe-area inset while it is visible.
 * Every screen's `TopBar` also pads `insets.top`, so without this the strip and
 * the header would both reserve the status-bar height and leave an empty gap.
 * Overriding the inset context to `top: 0` for the screen subtree makes a
 * single component consume the edge — the standard safe-area-context pattern.
 */
function DownloadTopInset({ children }: { children: ReactNode }) {
  const active = useModelDownloadStore(
    (s) => s.status === 'downloading' || s.status === 'preparing',
  );
  const insets = useContext(SafeAreaInsetsContext);
  if (!active || insets === null) {
    return <>{children}</>;
  }
  return (
    <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
      {children}
    </SafeAreaInsetsContext.Provider>
  );
}
