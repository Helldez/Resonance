import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { ModelProfiles } from '@core/config/ModelProfiles';
import { useSettingsStore } from '@domain/SettingsStore';
import { useBootstrapStore } from '@domain/BootstrapStore';
import { useAgentProfileStore } from '@domain/AgentProfileStore';
import { useModelDownloadStore } from '@domain/ModelDownloadStore';
import { useAppContainer } from '@ui/AppContainerContext';
import { ModelDownloadProgress } from '@ui/components/ModelDownloadProgress';
import { formatMb } from '@ui/Splash';
import {
  Button,
  Icon,
  KeyboardAwareScreen,
  Skeleton,
  Text,
  TextField,
} from '@ui/design-system';

const STEP_COUNT = 4;

/**
 * First-run onboarding — four focused steps (welcome, identity, About you,
 * agent opt-in + model download) while the platform container boots in the
 * background. Everything is skippable; whatever is skipped stays reachable
 * later (Settings, Agent tab). Completing (or skipping out of) the flow
 * sets `onboardingDone`, and the Gate switches to the tab shell.
 */
export function OnboardingFlow() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const setOnboardingDone = useSettingsStore((s) => s.setOnboardingDone);

  const finish = (): void => setOnboardingDone(true);
  const next = (): void => {
    if (step >= STEP_COUNT - 1) {
      finish();
    } else {
      setStep(step + 1);
    }
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: T.color.bg,
        paddingTop: insets.top,
        paddingBottom: insets.bottom + T.space.lg,
      }}
    >
      <KeyboardAwareScreen
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, padding: T.space.xxl }}
      >
        {step === 0 && <StepWelcome onNext={next} />}
        {step === 1 && <StepIdentity onNext={next} />}
        {step === 2 && <StepAboutYou onNext={next} />}
        {step === 3 && <StepAgent onDone={finish} />}
      </KeyboardAwareScreen>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          gap: T.space.sm,
          paddingTop: T.space.md,
        }}
      >
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <View
            key={i}
            style={{
              width: i === step ? T.space.lg : 6,
              height: 6,
              borderRadius: T.radius.pill,
              backgroundColor: i === step ? T.color.accent : T.color.border,
            }}
          />
        ))}
      </View>
    </View>
  );
}

function StepWelcome(props: { onNext: () => void }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: T.space.lg }}>
      <Icon name="resonance" size={64} color={T.color.accent} />
      <Text variant="display">Posts find you.</Text>
      <Text variant="muted">
        No follows. No feeds built by ads. You write what you think; what
        resonates with it reaches you — ranked on your device, by your device.
      </Text>
      <Text variant="muted">
        All AI runs locally. No servers, no sign-up, no telemetry.
      </Text>
      <View style={{ marginTop: T.space.lg }}>
        <Button label="Start" full onPress={props.onNext} />
      </View>
    </View>
  );
}

function StepIdentity(props: { onNext: () => void }) {
  const self = useBootstrapStore((s) => s.self);
  const displayName = useSettingsStore((s) => s.displayName);
  const setDisplayName = useSettingsStore((s) => s.setDisplayName);
  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: T.space.lg }}>
      <Text variant="title">Your identity is ready</Text>
      <Text variant="muted">
        A keypair was generated on this device — no account, no e-mail. Peers
        know you by this fingerprint:
      </Text>
      {self !== undefined ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: T.color.border,
            borderRadius: T.radius.md,
            padding: T.space.md,
          }}
        >
          <Text variant="label" color={T.color.accent} numberOfLines={1}>
            {`${self.slice(0, 16)}…${self.slice(-8)}`}
          </Text>
        </View>
      ) : (
        <Skeleton height={44} />
      )}
      <Text variant="muted">
        Pick a name to show next to your own posts. It stays on this device —
        peers always see the fingerprint.
      </Text>
      <TextField
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Display name (optional)"
      />
      <View style={{ marginTop: T.space.lg }}>
        <Button label="Continue" full onPress={props.onNext} />
      </View>
    </View>
  );
}

function StepAboutYou(props: { onNext: () => void }) {
  const receiverContext = useSettingsStore((s) => s.receiverContext);
  const setReceiverContext = useSettingsStore((s) => s.setReceiverContext);
  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: T.space.lg }}>
      <Text variant="title">What do you care about?</Text>
      <Text variant="muted">
        Everyone shares one room. This text is what ranks incoming posts
        before you have written anything — it decides what lands in your feed.
        It never leaves your device.
      </Text>
      <TextField
        value={receiverContext}
        onChangeText={setReceiverContext}
        multiline
        numberOfLines={6}
        placeholder="A short, honest description of who you are and what you actually know. E.g. “Android dev building on-device AI; interested in local-first software, embedded ML, …”"
      />
      <View style={{ marginTop: T.space.lg, gap: T.space.md }}>
        <Button label="Continue" full onPress={props.onNext} />
        <Button label="Skip for now" variant="ghost" full onPress={props.onNext} />
      </View>
    </View>
  );
}

function StepAgent(props: { onDone: () => void }) {
  const container = useAppContainer();
  const setProfile = useAgentProfileStore((s) => s.setProfile);
  const [optIn, setOptIn] = useState<boolean | null>(null);
  const llmStatus = useModelDownloadStore((s) => s.status);
  const llmDownloaded = useModelDownloadStore((s) => s.downloaded);
  const llmTotal = useModelDownloadStore((s) => s.total);
  const llmError = useModelDownloadStore((s) => s.error);
  const startLlmDownload = useModelDownloadStore((s) => s.start);
  const llmReady = llmStatus === 'ready';
  const llmBusy = llmStatus === 'downloading' || llmStatus === 'preparing';

  const choose = (v: boolean): void => {
    setOptIn(v);
    setProfile({ enabled: v, autonomy: v ? 'suggest' : 'off' });
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', gap: T.space.lg }}>
      <Text variant="title">Want an agent reading for you?</Text>
      <Text variant="muted">
        Your on-device AI can read the room, suggest replies and surface what
        matters. It never publishes without your approval until you say so.
      </Text>

      <Choice
        label="No — just me"
        body="You can enable it any time from the Agent tab."
        selected={optIn === false}
        onPress={() => choose(false)}
      />
      <Choice
        label="Yes, but I approve everything"
        body="The agent drafts; you tap to publish. Needs the language model below."
        selected={optIn === true}
        onPress={() => choose(true)}
      />

      {optIn === true && (
        <View
          style={{
            borderWidth: 1,
            borderColor: T.color.border,
            borderRadius: T.radius.md,
            padding: T.space.md,
            gap: T.space.sm,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: T.space.sm }}>
            <Icon name="download" size={T.size.iconSmall} color={T.color.textMuted} />
            <Text variant="label" style={{ flex: 1 }}>
              {`${ModelProfiles.llm.label} · ${formatMb(ModelProfiles.llm.sizeBytes)} MB`}
            </Text>
            {llmReady && <Text variant="label" color={T.color.success}>Ready</Text>}
          </View>
          {llmBusy ? (
            <ModelDownloadProgress
              status={llmStatus}
              downloaded={llmDownloaded}
              total={llmTotal}
            />
          ) : !llmReady ? (
            container !== null ? (
              <Button label="Download now" small onPress={() => startLlmDownload(container)} />
            ) : (
              <Text variant="caption">Finishing device setup — the download unlocks in a moment.</Text>
            )
          ) : null}
          {llmError !== null && (
            <Text variant="small" color={T.color.danger}>
              {llmError}
            </Text>
          )}
        </View>
      )}

      <View style={{ marginTop: T.space.lg, gap: T.space.md }}>
        <Button label="Done" full disabled={optIn === null} onPress={props.onDone} />
        <Button label="Decide later" variant="ghost" full onPress={props.onDone} />
      </View>
    </View>
  );
}

function Choice(props: {
  label: string;
  body: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <View
      style={{
        borderWidth: props.selected ? 1.5 : 1,
        borderColor: props.selected ? T.color.accent : T.color.border,
        borderRadius: T.radius.lg,
        backgroundColor: props.selected ? T.color.accentSoft : 'transparent',
      }}
    >
      <Text
        onPress={props.onPress}
        variant="bodyBold"
        style={{ paddingHorizontal: T.space.lg, paddingTop: T.space.md }}
      >
        {props.label}
      </Text>
      <Text
        onPress={props.onPress}
        variant="small"
        style={{ paddingHorizontal: T.space.lg, paddingBottom: T.space.md, marginTop: T.space.xxs }}
      >
        {props.body}
      </Text>
    </View>
  );
}
