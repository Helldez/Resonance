import { TextInput, View } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';
import { Text } from './Text';

/**
 * Token-driven text input. `bare` renders without a border — the X compose
 * style (large placeholder, no box); the default is a hairline-bordered
 * field for forms.
 */
export function TextField(props: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  numberOfLines?: number;
  autoFocus?: boolean;
  bare?: boolean;
  large?: boolean;
  error?: string | null;
  onSubmitEditing?: () => void;
  accessibilityLabel?: string;
}) {
  const fontSize = props.large === true ? T.font.size.xl : T.font.size.base;
  return (
    <View>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={T.color.textMuted}
        multiline={props.multiline}
        numberOfLines={props.numberOfLines}
        autoFocus={props.autoFocus}
        onSubmitEditing={props.onSubmitEditing}
        accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
        style={{
          color: T.color.text,
          fontSize,
          lineHeight: props.large === true ? T.font.lineHeight.xl : T.font.lineHeight.base,
          textAlignVertical: props.multiline === true ? 'top' : 'center',
          ...(props.bare === true
            ? { paddingVertical: T.space.sm }
            : {
                borderWidth: 1,
                borderColor: props.error != null ? T.color.danger : T.color.border,
                borderRadius: T.radius.md,
                paddingHorizontal: T.space.md,
                paddingVertical: T.space.sm + T.space.xxs,
              }),
          ...(props.multiline === true ? { minHeight: (props.numberOfLines ?? 4) * T.font.lineHeight.base + T.space.lg } : {}),
        }}
      />
      {props.error != null && (
        <Text variant="small" color={T.color.danger} style={{ marginTop: T.space.xs }}>
          {props.error}
        </Text>
      )}
    </View>
  );
}
