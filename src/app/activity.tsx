import { useCallback, useState } from 'react';
import { View, FlatList } from 'react-native';
import {
  Text,
  useTheme,
  Icon,
  Button,
  SegmentedButtons,
} from 'react-native-paper';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireContainer } from '@ui/AppContainerContext';
import type { AgentLogEntry, AgentLogPhase } from '@data/AgentLogRepository';
import { MatchingConfig } from '@core/config/MatchingConfig';

/**
 * Agent Activity dashboard — a real-time, human-readable feed of what the
 * on-device agent is doing: every wake-up, relevance judgement, decision,
 * governor verdict, and published/queued action, with the text it wrote. Reads
 * the persisted AgentLogRepository and auto-refreshes, so the user (not just a
 * developer with logcat) can see exactly how the agent behaves.
 */

const PHASE_META: Record<AgentLogPhase, { icon: string; color: string; label: string }> = {
  tick: { icon: 'sync', color: '#A5ADBE', label: 'Tick' },
  triage: { icon: 'magnify-scan', color: '#7C5CFF', label: 'Read' },
  decide: { icon: 'thought-bubble-outline', color: '#7C5CFF', label: 'Decide' },
  govern: { icon: 'gavel', color: '#F0A020', label: 'Gate' },
  publish: { icon: 'send-check', color: '#56D364', label: 'Published' },
  queue: { icon: 'inbox-arrow-down', color: '#56D364', label: 'Drafted' },
  post: { icon: 'pencil-plus', color: '#56D364', label: 'Post' },
  error: { icon: 'alert-circle-outline', color: '#F85149', label: 'Error' },
};

type Filter = 'all' | 'actions' | 'thinking';

export default function ActivityScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const container = useRequireContainer();
  const [entries, setEntries] = useState<AgentLogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async (): Promise<void> => {
    setEntries(await container.agentLog.recent(300));
  }, [container]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const id = setInterval(() => {
        void load();
      }, MatchingConfig.uiRefreshIntervalMs);
      return () => clearInterval(id);
    }, [load]),
  );

  const shown = entries.filter((e) => {
    if (filter === 'all') {
      return true;
    }
    if (filter === 'actions') {
      return e.phase === 'publish' || e.phase === 'queue' || e.phase === 'post';
    }
    return e.phase === 'triage' || e.phase === 'decide' || e.phase === 'govern';
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ padding: 12, paddingBottom: 4 }}>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
          Everything your agent does, newest first. Updates live.
        </Text>
        <SegmentedButtons
          value={filter}
          onValueChange={(v) => setFilter(v as Filter)}
          density="small"
          buttons={[
            { value: 'all', label: 'All' },
            { value: 'actions', label: 'Actions' },
            { value: 'thinking', label: 'Reasoning' },
          ]}
        />
      </View>

      <FlatList
        data={shown}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 80 }}
        ListEmptyComponent={
          <Text style={{ opacity: 0.6, textAlign: 'center', marginTop: 32, color: theme.colors.onSurfaceVariant }}>
            No activity yet. Enable the agent in My agent; once it wakes up,
            every step it takes shows up here.
          </Text>
        }
        renderItem={({ item }) => {
          const meta = PHASE_META[item.phase];
          return (
            <View
              style={{
                flexDirection: 'row',
                marginBottom: 12,
                opacity: item.phase === 'tick' ? 0.7 : 1,
              }}
            >
              <View style={{ width: 26, alignItems: 'center', paddingTop: 2 }}>
                <Icon source={meta.icon} size={18} color={meta.color} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text variant="labelMedium" style={{ color: meta.color }}>
                    {meta.label}
                  </Text>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {formatTime(item.createdAt)}
                  </Text>
                  {item.target !== null && (
                    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, opacity: 0.7 }}>
                      {`· ${item.target.slice(0, 8)}…`}
                    </Text>
                  )}
                </View>
                <Text style={{ color: theme.colors.onSurface, marginTop: 1 }}>{item.summary}</Text>
                {item.text !== null && item.text.length > 0 && (
                  <View
                    style={{
                      marginTop: 4,
                      paddingLeft: 8,
                      borderLeftWidth: 2,
                      borderLeftColor: theme.colors.outline,
                    }}
                  >
                    <Text
                      variant="bodySmall"
                      style={{ color: theme.colors.onSurfaceVariant, fontStyle: 'italic' }}
                      numberOfLines={4}
                    >
                      {item.text}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          );
        }}
      />

      <View
        style={{
          position: 'absolute',
          right: 12,
          bottom: insets.bottom + 12,
        }}
      >
        <Button
          mode="contained-tonal"
          icon="delete-sweep"
          compact
          onPress={() => {
            void (async () => {
              await container.agentLog.clear();
              await load();
            })();
          }}
        >
          Clear
        </Button>
      </View>
    </View>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  const ss = `${d.getSeconds()}`.padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
