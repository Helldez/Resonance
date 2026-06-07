import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { DesignTokens as T } from '@core/config/DesignTokens';

export type TextVariant =
  | 'display' // splash titles
  | 'title' // screen titles, big numbers
  | 'heading' // section/post emphasis
  | 'body' // default copy
  | 'bodyBold' // author names, emphasized copy
  | 'muted' // secondary copy at body size
  | 'small' // timestamps, helper copy
  | 'label' // pill/tab/button labels
  | 'caption'; // tiny muted annotations

const VARIANTS: Record<TextVariant, TextStyle> = {
  display: {
    fontSize: T.font.size.display,
    lineHeight: T.font.lineHeight.display,
    fontWeight: T.font.weight.heavy,
    color: T.color.text,
  },
  title: {
    fontSize: T.font.size.xl,
    lineHeight: T.font.lineHeight.xl,
    fontWeight: T.font.weight.bold,
    color: T.color.text,
  },
  heading: {
    fontSize: T.font.size.lg,
    lineHeight: T.font.lineHeight.lg,
    fontWeight: T.font.weight.bold,
    color: T.color.text,
  },
  body: {
    fontSize: T.font.size.base,
    lineHeight: T.font.lineHeight.base,
    fontWeight: T.font.weight.regular,
    color: T.color.text,
  },
  bodyBold: {
    fontSize: T.font.size.base,
    lineHeight: T.font.lineHeight.base,
    fontWeight: T.font.weight.bold,
    color: T.color.text,
  },
  muted: {
    fontSize: T.font.size.base,
    lineHeight: T.font.lineHeight.base,
    fontWeight: T.font.weight.regular,
    color: T.color.textMuted,
  },
  small: {
    fontSize: T.font.size.sm,
    lineHeight: T.font.lineHeight.sm,
    fontWeight: T.font.weight.regular,
    color: T.color.textMuted,
  },
  label: {
    fontSize: T.font.size.sm,
    lineHeight: T.font.lineHeight.sm,
    fontWeight: T.font.weight.medium,
    color: T.color.text,
  },
  caption: {
    fontSize: T.font.size.xs,
    lineHeight: T.font.lineHeight.xs,
    fontWeight: T.font.weight.regular,
    color: T.color.textMuted,
  },
};

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: string;
}

/** Token-driven text. The only way screens set type — no inline font styles. */
export function Text({ variant = 'body', color, style, ...rest }: TextProps) {
  return (
    <RNText
      {...rest}
      style={[VARIANTS[variant], color !== undefined ? { color } : null, style]}
    />
  );
}
