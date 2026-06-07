import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useAgentProfileStore } from '@domain/AgentProfileStore';
import type { Autonomy } from '@core/agent/AgentProfile';
import type { AgentLogEntry } from '@data/AgentLogRepository';
import type { AgentLogPhase } from '@core/agent/ActivityTypes';
import type { PendingAction } from '@data/PendingActionRepository';
import { MatchingConfig } from '@core/config/MatchingConfig';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { dayKey } from '@core/agent/AgentMemory';
import { useApprovals } from '@ui/agent/useApprovals';
import { formatRelative } from '@ui/format/relativeTime';
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  Pill,
  Tabs,
  Text,
  TopBar,
  type IconName,
} from '@ui/design-system';

/** Visual vocabulary per loop phase — colors point at the design tokens. */
const PHASE_META: Record<AgentLogPhase, { icon: IconName; color: string; label: string }> = {
  tick: { icon: 'refresh', color: T.color.textMuted, label: 'Tick' },
  triage: { icon: 'search', color: T.color.accent, label: 'Read' },
  decide: { icon: 'edit', color: T.color.accent, label: 'Decide' },
  govern: { icon: 'shield', color: T.color.warning, label: 'Gate' },
  publish: { icon: 'send', color: T.color.success, label: 'Published' },
  queue: { icon: 'inbox', color: T.color.success, label: 'Drafted' },
  post: { icon: 'plus', color: T.color.success, label: 'Post' },
  error: { icon: 'alert', color: T.color.danger, label: 'Error' },
};

type Filter = 'all' | 'actions' | 'thinking';

const AUTONOMY_ITEMS: ReadonlyArray<{ value: Autonomy; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'suggest', label: 'Suggest' },
  { value: 'autopilot', label: 'Autopilot' },
];

const AUTONOMY_HINT: Record<Autonomy, string> = {
  off: 'The agent never acts.',
  suggest: 'The agent only drafts — nothing is published without your tap.',
  autopilot: 'The agent acts on its own, strictly within your limits.',
};

/**
 * The Agent hub — one place for everything the on-device agent is and does:
 * the autonomy dial (the single dial; "response mode" is gone), today's
 * stats, drafts that need approval (inline, actionable), and the live
 * activity timeline. Configuration lives behind the gear (agent-settings).
 */
export default function AgentScreen() {
  const router = useRouter();
  const container = useRequireContainer();
  const profile = useAgentProfileStore((s) => s.profile);
  const setProfile = useAgentProfileStore((s) => s.setProfile);
  const killSwitch = useAgentProfileStore((s) => s.killSwitch);

  const approvals = useApprovals(container);
  const [today, setToday] = useState({ posts: 0, comments: 0, reactions: 0 });
  const [entries, setEntries] = useState<AgentLogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const llmReady = container.llmConcrete.isLoaded;

  const refresh = useCallback(async (): Promise<void> => {
    const day = dayKey(container.clock.now());
    const [posts, comments, reactions, log] = await Promise.all([
      container.agentActivity.countToday(day, 'post'),
      container.agentActivity.countToday(day, 'comment'),
      container.agentActivity.countToday(day, 'reaction'),
      container.agentLog.recent(300),
    ]);
    setToday({ posts, comments, reactions });
    setEntries(log);
  }, [container]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      const id = setInterval(() => {
        void refresh();
      }, MatchingConfig.uiRefreshIntervalMs);
      return () => clearInterval(id);
    }, [refresh]),
  );

  const setAutonomy = (autonomy: Autonomy): void => {
    setProfile({ autonomy, enabled: autonomy !== 'off' });
  };

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
    <View style={{ flex: 1, backgroundColor: T.color.bg }}>
      <TopBar
        title={profile.name.trim().length > 0 ? profile.name : 'Agent'}
        subtitle={killSwitch ? 'Kill switch ON' : AUTONOMY_HINT[profile.autonomy]}
        right={
          <>
            <IconButton
              icon="trash"
              accessibilityLabel="Clear activity log"
              onPress={() => {
                void (async () => {
                  await container.agentLog.clear();
                  await refresh();
                })();
              }}
            />
            <IconButton
              icon="settings"
              accessibilityLabel="Agent settings"
              onPress={() => router.push('/agent-settings')}
            />
          </>
        }
      />
      <FlatList
        data={shown}
        keyExtractor={(e) => String(e.id)}
        ListHeaderComponent={
          <View>
            {/* Autonomy — the single dial. */}
            <View
              style={{
                flexDirection: 'row',
                gap: T.space.sm,
                paddingHorizontal: T.space.lg,
                paddingTop: T.space.lg,
              }}
            >
              {AUTONOMY_ITEMS.map((a) => (
                <Pill
                  key={a.value}
                  label={a.label}
                  selected={profile.autonomy === a.value}
                  onPress={() => setAutonomy(a.value)}
                />
              ))}
            </View>

            {/* Today, at a glance. */}
            <View
              style={{
                flexDirection: 'row',
                paddingVertical: T.space.xl,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: T.color.border,
              }}
            >
              <Stat value={today.posts} label="posts" />
              <Stat value={today.comments} label="comments" />
              <Stat value={today.reactions} label="reactions" />
            </View>

            {!llmReady && profile.autonomy !== 'off' && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: T.space.md,
                  paddingHorizontal: T.space.lg,
                  paddingVertical: T.space.md,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: T.color.border,
                }}
              >
                <Icon name="alert" size={T.size.icon} color={T.color.warning} />
                <Text variant="small" style={{ flex: 1 }}>
                  The language model is not loaded — the agent cannot think
                  without it.
                </Text>
                <Button
                  label="Get it"
                  small
                  variant="secondary"
                  onPress={() => router.push('/settings')}
                />
              </View>
            )}

            {/* Drafts that need a human tap, inline and actionable. */}
            {approvals.items.length > 0 && (
              <View>
                <Text
                  variant="caption"
                  style={{
                    paddingHorizontal: T.space.lg,
                    paddingTop: T.space.lg,
                    textTransform: 'uppercase',
                    letterSpacing: 0.8,
                  }}
                >
                  {`Needs your approval (${approvals.items.length})`}
                </Text>
                {approvals.items.map((item) => (
                  <ApprovalCard
                    key={item.id}
                    item={item}
                    busy={approvals.busy === item.id}
                    onApprove={() => void approvals.approve(item)}
                    onDismiss={() => void approvals.dismiss(item)}
                  />
                ))}
              </View>
            )}

            <View style={{ marginTop: T.space.lg }}>
              <Tabs
                items={[
                  { key: 'all', label: 'All' },
                  { key: 'actions', label: 'Actions' },
                  { key: 'thinking', label: 'Reasoning' },
                ]}
                value={filter}
                onChange={setFilter}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="zap"
            title="No activity yet"
            body={
              profile.autonomy === 'off'
                ? 'Turn the dial to Suggest and your agent starts reading the room for you — every step it takes shows up here.'
                : 'Once the agent wakes up, every step it takes shows up here, with its reasoning.'
            }
          />
        }
        renderItem={({ item }) => <LogRow entry={item} />}
      />
    </View>
  );
}

function Stat(props: { value: number; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: T.space.xxs }}>
      <Text variant="title">{String(props.value)}</Text>
      <Text variant="caption">{props.label}</Text>
    </View>
  );
}

function ApprovalCard(props: {
  item: PendingAction;
  busy: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const { item } = props;
  const kindLabel =
    item.kind === 'post' ? 'New post' : item.kind === 'react' ? `Reaction: ${item.reaction ?? ''}` : 'Reply';
  const kindIcon: IconName = item.kind === 'post' ? 'edit' : item.kind === 'react' ? 'heart' : 'reply';
  return (
    <View
      style={{
        marginHorizontal: T.space.lg,
        marginTop: T.space.md,
        borderWidth: 1,
        borderColor: T.color.border,
        borderRadius: T.radius.lg,
        padding: T.space.md,
        gap: T.space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
        <Icon name={kindIcon} size={T.size.iconSmall} color={T.color.accent} />
        <Text variant="label" color={T.color.accent}>
          {kindLabel}
        </Text>
      </View>
      {item.text.length > 0 && <Text variant="body">{item.text}</Text>}
      {item.rationale.length > 0 && (
        <Text variant="small">{`Why: ${item.rationale}`}</Text>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: T.space.sm, marginTop: T.space.xs }}>
        <Button label="Dismiss" variant="ghost" small onPress={props.onDismiss} disabled={props.busy} />
        <Button label="Approve" icon="check" small onPress={props.onApprove} loading={props.busy} />
      </View>
    </View>
  );
}

function LogRow(props: { entry: AgentLogEntry }) {
  const meta = PHASE_META[props.entry.phase];
  const e = props.entry;
  return (
    <View
      style={{
        flexDirection: 'row',
        paddingHorizontal: T.space.lg,
        paddingVertical: T.space.md,
        gap: T.space.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: T.color.border,
        opacity: e.phase === 'tick' ? 0.6 : 1,
      }}
    >
      <View style={{ width: T.size.icon, alignItems: 'center', paddingTop: T.space.xxs }}>
        <Icon name={meta.icon} size={T.size.iconSmall} color={meta.color} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
          <Text variant="label" color={meta.color}>
            {meta.label}
          </Text>
          <Text variant="caption">{formatRelative(e.createdAt)}</Text>
          {e.target !== null && (
            <Text variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
              {`· ${e.target.slice(0, 8)}…`}
            </Text>
          )}
        </View>
        <Text variant="body" style={{ marginTop: T.space.xxs }}>
          {e.summary}
        </Text>
        {e.refText !== null && e.refText.length > 0 && (
          <View
            style={{
              marginTop: T.space.xs,
              paddingLeft: T.space.sm,
              borderLeftWidth: 1,
              borderLeftColor: T.color.border,
            }}
          >
            <Text variant="caption">In reply to</Text>
            <Text variant="small" numberOfLines={3}>
              {e.refText}
            </Text>
          </View>
        )}
        {e.text !== null && e.text.length > 0 && (
          <View
            style={{
              marginTop: T.space.xs,
              paddingLeft: T.space.sm,
              borderLeftWidth: 2,
              borderLeftColor: meta.color,
            }}
          >
            <Text variant="caption" color={meta.color}>
              Agent wrote
            </Text>
            <Text variant="small" color={T.color.text} numberOfLines={5}>
              {e.text}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
