import { View } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { Button } from './Button';

/** Centered empty state: icon, title, body, optional CTA. Guides, never dead-ends. */
export function EmptyState(props: {
  icon: IconName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ alignItems: 'center', paddingHorizontal: T.space.xxxl, paddingVertical: T.space.xxxl, gap: T.space.md }}>
      <Icon name={props.icon} size={T.size.iconLarge * 1.5} color={T.color.textMuted} />
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {props.title}
      </Text>
      <Text variant="muted" style={{ textAlign: 'center' }}>
        {props.body}
      </Text>
      {props.actionLabel !== undefined && props.onAction !== undefined && (
        <View style={{ marginTop: T.space.sm }}>
          <Button label={props.actionLabel} onPress={props.onAction} />
        </View>
      )}
    </View>
  );
}
