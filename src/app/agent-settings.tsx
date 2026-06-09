import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAgentProfileStore } from '@domain/AgentProfileStore';
import { useRequireContainer } from '@ui/AppContainerContext';
import { AgentConfig } from '@core/config/AgentConfig';
import { DesignTokens as T } from '@core/config/DesignTokens';
import {
  IconButton,
  KeyboardAwareScreen,
  ListGroup,
  ListRow,
  Pill,
  Switch,
  Text,
  TextField,
  TopBar,
} from '@ui/design-system';

/**
 * Agent configuration — touched once, then rarely: identity (name, tone),
 * interests and goals, the daily limits the governor enforces in code, the
 * advanced matching thresholds, and the kill switch. The autonomy dial
 * lives in the hub, where the agent's behaviour is visible.
 */
export default function AgentSettingsScreen() {
  const insets = useSafeAreaInsets();
  const container = useRequireContainer();
  const profile = useAgentProfileStore((s) => s.profile);
  const setProfile = useAgentProfileStore((s) => s.setProfile);
  const killSwitch = useAgentProfileStore((s) => s.killSwitch);
  const setKillSwitch = useAgentProfileStore((s) => s.setKillSwitch);

  const [interestDraft, setInterestDraft] = useState('');
  const [goalDraft, setGoalDraft] = useState('');

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
    <View style={{ flex: 1, backgroundColor: T.color.bg }}>
      <TopBar title="Agent settings" back />
      <KeyboardAwareScreen
        contentContainerStyle={{ paddingBottom: insets.bottom + T.space.xxl }}
      >
        <ListGroup title="Identity">
          <View style={{ paddingHorizontal: T.space.lg, paddingVertical: T.space.sm, gap: T.space.md }}>
            <TextField
              value={profile.name}
              onChangeText={(v) => setProfile({ name: v })}
              placeholder="What your agent is called"
            />
            <TextField
              value={profile.tone}
              onChangeText={(v) => setProfile({ tone: v })}
              placeholder="Tone — e.g. concise, technical, no fluff"
            />
          </View>
        </ListGroup>

        <ListGroup
          title="Interests"
          footer="What the agent cares about when reading the room."
        >
          <View style={{ paddingHorizontal: T.space.lg, paddingVertical: T.space.sm, gap: T.space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
              <View style={{ flex: 1 }}>
                <TextField
                  value={interestDraft}
                  onChangeText={setInterestDraft}
                  placeholder="Add an interest"
                  onSubmitEditing={addInterest}
                />
              </View>
              <IconButton icon="plus" accessibilityLabel="Add interest" onPress={addInterest} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: T.space.sm }}>
              {profile.interests.map((it, i) => (
                <Pill
                  key={`${it}-${i}`}
                  label={it}
                  onClose={() =>
                    setProfile({ interests: profile.interests.filter((_, j) => j !== i) })
                  }
                />
              ))}
            </View>
          </View>
        </ListGroup>

        <ListGroup
          title="Goals"
          footer="The agent writes proactive posts to advance the first goal."
        >
          <View style={{ paddingHorizontal: T.space.lg, paddingVertical: T.space.sm, gap: T.space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
              <View style={{ flex: 1 }}>
                <TextField
                  value={goalDraft}
                  onChangeText={setGoalDraft}
                  placeholder="What should it pursue?"
                  onSubmitEditing={addGoal}
                />
              </View>
              <IconButton icon="plus" accessibilityLabel="Add goal" onPress={addGoal} />
            </View>
            {profile.goals.map((g, i) => (
              <View
                key={`${g}-${i}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}
              >
                <Text variant="body" style={{ flex: 1 }}>
                  {`${i + 1}. ${g}`}
                </Text>
                <IconButton
                  icon="x"
                  accessibilityLabel={`Remove goal ${g}`}
                  onPress={() => setProfile({ goals: profile.goals.filter((_, j) => j !== i) })}
                />
              </View>
            ))}
          </View>
        </ListGroup>

        <ListGroup
          title="Daily limits"
          footer="Enforced by code (the governor), not by the model."
        >
          <StepperRow
            label="Posts / day"
            value={profile.limits.maxPostsPerDay}
            max={AgentConfig.caps.maxPostsPerDay}
            onChange={(n) => setProfile({ limits: { ...profile.limits, maxPostsPerDay: n } })}
          />
          <StepperRow
            label="Comments / day"
            value={profile.limits.maxCommentsPerDay}
            max={AgentConfig.caps.maxCommentsPerDay}
            onChange={(n) => setProfile({ limits: { ...profile.limits, maxCommentsPerDay: n } })}
          />
          <StepperRow
            label="Reactions / day"
            value={profile.limits.maxReactionsPerDay}
            max={AgentConfig.caps.maxReactionsPerDay}
            onChange={(n) => setProfile({ limits: { ...profile.limits, maxReactionsPerDay: n } })}
          />
          <StepperRow
            label="Replies / thread"
            value={profile.limits.maxTurnsPerThread}
            min={1}
            max={AgentConfig.caps.maxTurnsPerThread}
            onChange={(n) => setProfile({ limits: { ...profile.limits, maxTurnsPerThread: n } })}
            noDivider
          />
        </ListGroup>

        <ListGroup
          title="Advanced — matching thresholds"
          footer="Cosine similarity (0–1). Higher react/comment = the agent acts less; keep comment ≥ react. Lower the echo threshold to suppress repetitive replies more aggressively."
        >
          <FloatStepperRow
            label="React above similarity"
            value={profile.thresholds.reactMinSimilarity}
            onChange={(n) =>
              setProfile({ thresholds: { ...profile.thresholds, reactMinSimilarity: n } })
            }
          />
          <FloatStepperRow
            label="Comment above similarity"
            value={profile.thresholds.respondMinSimilarity}
            onChange={(n) =>
              setProfile({ thresholds: { ...profile.thresholds, respondMinSimilarity: n } })
            }
          />
          <FloatStepperRow
            label="Suppress reply if echo ≥"
            value={profile.thresholds.echoMaxCosine}
            onChange={(n) =>
              setProfile({ thresholds: { ...profile.thresholds, echoMaxCosine: n } })
            }
            noDivider
          />
        </ListGroup>

        <ListGroup footer="Immediately stops all agent actions. Resets on app restart.">
          <ListRow
            label="Kill switch"
            destructive
            right={
              <Switch
                value={killSwitch}
                onValueChange={(v) => {
                  setKillSwitch(v);
                  if (v) {
                    // Gating future ticks is not enough: a completion can hold
                    // the model for minutes. Abort the in-flight one too.
                    container.llmConcrete.cancelGeneration();
                  }
                }}
                color={T.color.danger}
                accessibilityLabel="Kill switch"
              />
            }
            noDivider
          />
        </ListGroup>
      </KeyboardAwareScreen>
    </View>
  );
}

function StepperRow(props: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange: (n: number) => void;
  noDivider?: boolean;
}) {
  const min = props.min ?? 0;
  return (
    <ListRow
      label={props.label}
      noDivider={props.noDivider}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton
            icon="minus"
            accessibilityLabel={`Decrease ${props.label}`}
            disabled={props.value <= min}
            onPress={() => props.onChange(Math.max(min, props.value - 1))}
          />
          <Text variant="bodyBold" style={{ minWidth: T.space.xxl + T.space.xs, textAlign: 'center' }}>
            {String(props.value)}
          </Text>
          <IconButton
            icon="plus"
            accessibilityLabel={`Increase ${props.label}`}
            disabled={props.value >= props.max}
            onPress={() => props.onChange(Math.min(props.max, props.value + 1))}
          />
        </View>
      }
    />
  );
}

/** Stepper for a cosine threshold: range [0,1], step 0.01, shown to 2 decimals. */
function FloatStepperRow(props: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  noDivider?: boolean;
}) {
  const step = 0.01;
  // Round to 2 decimals to avoid float drift accumulating across taps.
  const round = (n: number): number => Math.round(n * 100) / 100;
  return (
    <ListRow
      label={props.label}
      noDivider={props.noDivider}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton
            icon="minus"
            accessibilityLabel={`Decrease ${props.label}`}
            disabled={props.value <= 0}
            onPress={() => props.onChange(round(Math.max(0, props.value - step)))}
          />
          <Text variant="bodyBold" style={{ minWidth: T.space.xxxl + T.space.sm, textAlign: 'center' }}>
            {props.value.toFixed(2)}
          </Text>
          <IconButton
            icon="plus"
            accessibilityLabel={`Increase ${props.label}`}
            disabled={props.value >= 1}
            onPress={() => props.onChange(round(Math.min(1, props.value + step)))}
          />
        </View>
      }
    />
  );
}
