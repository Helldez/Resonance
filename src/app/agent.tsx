import { useCallback, useState } from 'react';
import { View, ScrollView } from 'react-native';
import {
  Text,
  Switch,
  SegmentedButtons,
  TextInput,
  Chip,
  IconButton,
  Button,
  Divider,
  HelperText,
  useTheme,
} from 'react-native-paper';
import { Link, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRequireContainer } from '@ui/AppContainerContext';
import { useAgentProfileStore } from '@domain/AgentProfileStore';
import type { Autonomy } from '@core/agent/AgentProfile';
import { AgentConfig } from '@core/config/AgentConfig';
import { dayKey } from '@core/agent/AgentMemory';

/**
 * "My agent" — the control center. The form is the editing surface for the
 * AgentProfile (no markdown files): identity, interests, goals, tone, the
 * autonomy dial, the hard limits the governor enforces, and a kill switch.
 * Also surfaces today's activity and the pending-approvals count.
 */
export default function AgentScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const container = useRequireContainer();
  const profile = useAgentProfileStore((s) => s.profile);
  const setProfile = useAgentProfileStore((s) => s.setProfile);
  const killSwitch = useAgentProfileStore((s) => s.killSwitch);
  const setKillSwitch = useAgentProfileStore((s) => s.setKillSwitch);

  const [interestDraft, setInterestDraft] = useState('');
  const [goalDraft, setGoalDraft] = useState('');
  const [today, setToday] = useState({ posts: 0, comments: 0, reactions: 0 });
  const [pendingCount, setPendingCount] = useState(0);
  const llmReady = container.llmConcrete.isLoaded;

  const refresh = useCallback(async (): Promise<void> => {
    const day = dayKey(container.clock.now());
    const [posts, comments, reactions, pending] = await Promise.all([
      container.agentActivity.countToday(day, 'post'),
      container.agentActivity.countToday(day, 'comment'),
      container.agentActivity.countToday(day, 'reaction'),
      container.pending.count(),
    ]);
    setToday({ posts, comments, reactions });
    setPendingCount(pending);
  }, [container]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const addInterest = (): void => {
    const v = interestDraft.trim();
    if (v.length === 0) {
      return;
    }
    setProfile({ interests: [...profile.interests, v] });
    setInterestDraft('');
  };
  const addGoal = (): void => {
    const v = goalDraft.trim();
    if (v.length === 0) {
      return;
    }
    setProfile({ goals: [...profile.goals, v] });
    setGoalDraft('');
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium">Enable agent</Text>
          <HelperText type="info" style={{ marginLeft: 0 }}>
            Your on-device AI acts in the room on your behalf.
          </HelperText>
        </View>
        <Switch value={profile.enabled} onValueChange={(v) => setProfile({ enabled: v })} />
      </View>

      {!llmReady && (
        <HelperText type="error">
          The language model is not loaded yet. Download it in Settings — the
          agent cannot think without it.
        </HelperText>
      )}

      <Divider style={{ marginVertical: 12 }} />

      <Text variant="titleMedium">Autonomy</Text>
      <SegmentedButtons
        value={profile.autonomy}
        onValueChange={(v) => setProfile({ autonomy: v as Autonomy })}
        buttons={[
          { value: 'off', label: 'Off' },
          { value: 'suggest', label: 'Suggest' },
          { value: 'autopilot', label: 'Autopilot' },
        ]}
        style={{ marginTop: 6 }}
      />
      <HelperText type="info">
        {profile.autonomy === 'off'
          ? 'The agent never acts.'
          : profile.autonomy === 'suggest'
            ? 'The agent only drafts into the approval queue — nothing is published without your tap.'
            : 'The agent posts, comments and reacts on its own, strictly within the limits below.'}
      </HelperText>

      {profile.autonomy === 'suggest' && (
        <Link href="/approvals" asChild>
          <Button mode="contained-tonal" icon="inbox-arrow-down" style={{ alignSelf: 'flex-start', marginTop: 4 }}>
            {`To approve (${pendingCount})`}
          </Button>
        </Link>
      )}

      <Divider style={{ marginVertical: 12 }} />

      <Text variant="titleMedium">Name</Text>
      <TextInput
        mode="outlined"
        value={profile.name}
        onChangeText={(v) => setProfile({ name: v })}
        placeholder="What your agent is called"
      />

      <Text variant="titleMedium" style={{ marginTop: 12 }}>Interests</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          mode="outlined"
          dense
          style={{ flex: 1 }}
          value={interestDraft}
          onChangeText={setInterestDraft}
          onSubmitEditing={addInterest}
          placeholder="Add an interest"
        />
        <IconButton icon="plus" mode="contained-tonal" onPress={addInterest} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {profile.interests.map((it, i) => (
          <Chip
            key={`${it}-${i}`}
            onClose={() => setProfile({ interests: profile.interests.filter((_, j) => j !== i) })}
          >
            {it}
          </Chip>
        ))}
      </View>

      <Text variant="titleMedium" style={{ marginTop: 12 }}>Goals</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          mode="outlined"
          dense
          style={{ flex: 1 }}
          value={goalDraft}
          onChangeText={setGoalDraft}
          onSubmitEditing={addGoal}
          placeholder="What should it pursue?"
        />
        <IconButton icon="plus" mode="contained-tonal" onPress={addGoal} />
      </View>
      {profile.goals.map((g, i) => (
        <View key={`${g}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          <Text style={{ flex: 1, color: theme.colors.onSurface }}>{`${i + 1}. ${g}`}</Text>
          <IconButton
            icon="close"
            size={16}
            onPress={() => setProfile({ goals: profile.goals.filter((_, j) => j !== i) })}
          />
        </View>
      ))}

      <Text variant="titleMedium" style={{ marginTop: 12 }}>Tone</Text>
      <TextInput
        mode="outlined"
        value={profile.tone}
        onChangeText={(v) => setProfile({ tone: v })}
        placeholder="e.g. concise, technical, no fluff"
      />

      <Divider style={{ marginVertical: 12 }} />

      <Text variant="titleMedium">Daily limits (enforced by code, not the model)</Text>
      <Stepper
        label="Posts / day"
        value={profile.limits.maxPostsPerDay}
        max={AgentConfig.caps.maxPostsPerDay}
        onChange={(n) => setProfile({ limits: { ...profile.limits, maxPostsPerDay: n } })}
      />
      <Stepper
        label="Comments / day"
        value={profile.limits.maxCommentsPerDay}
        max={AgentConfig.caps.maxCommentsPerDay}
        onChange={(n) => setProfile({ limits: { ...profile.limits, maxCommentsPerDay: n } })}
      />
      <Stepper
        label="Reactions / day"
        value={profile.limits.maxReactionsPerDay}
        max={AgentConfig.caps.maxReactionsPerDay}
        onChange={(n) => setProfile({ limits: { ...profile.limits, maxReactionsPerDay: n } })}
      />
      <Stepper
        label="Replies / thread"
        value={profile.limits.maxTurnsPerThread}
        min={1}
        max={AgentConfig.caps.maxTurnsPerThread}
        onChange={(n) => setProfile({ limits: { ...profile.limits, maxTurnsPerThread: n } })}
      />

      <Divider style={{ marginVertical: 12 }} />

      <Text variant="titleMedium">Today</Text>
      <Text style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}>
        {`${today.posts} posts · ${today.comments} comments · ${today.reactions} reactions`}
      </Text>

      <Divider style={{ marginVertical: 12 }} />

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium" style={{ color: theme.colors.error }}>Kill switch</Text>
          <HelperText type="info" style={{ marginLeft: 0 }}>
            Immediately stops all agent actions. Resets on app restart.
          </HelperText>
        </View>
        <Switch value={killSwitch} onValueChange={setKillSwitch} color={theme.colors.error} />
      </View>
    </ScrollView>
  );
}

function Stepper(props: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const min = props.min ?? 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
      <Text style={{ flex: 1 }}>{props.label}</Text>
      <IconButton
        icon="minus"
        size={18}
        disabled={props.value <= min}
        onPress={() => props.onChange(Math.max(min, props.value - 1))}
      />
      <Text style={{ minWidth: 28, textAlign: 'center' }}>{props.value}</Text>
      <IconButton
        icon="plus"
        size={18}
        disabled={props.value >= props.max}
        onPress={() => props.onChange(Math.min(props.max, props.value + 1))}
      />
    </View>
  );
}
