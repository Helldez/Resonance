import { Tabs } from 'expo-router';
import { TabBar } from '@ui/components/TabBar';

/**
 * The four-tab shell: Home (feed), Atlas (semantic map), Agent (hub with
 * approvals badge), You (profile). Headers are per-screen `TopBar`s; the
 * bar itself is the custom X-style `TabBar`.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => (
        <TabBar
          routes={state.routes.map((r) => r.name)}
          activeIndex={state.index}
          onPress={(name) => navigation.navigate(name as never)}
        />
      )}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="atlas" />
      <Tabs.Screen name="agent" />
      <Tabs.Screen name="you" />
    </Tabs>
  );
}
