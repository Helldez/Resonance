import { ThemeConfig } from './ThemeConfig';

/**
 * Design tokens for the X-style UI. Every component style in
 * `src/ui/design-system/` (and every screen) reads ONLY from here —
 * AGENTS.md's "no hardcoded constants at call sites" applies to colors,
 * spacing and type sizes too.
 *
 * Palette: pure-black surfaces and X-like neutrals; the accent stays the
 * Resonance purple, sourced from `ThemeConfig.dark.primary` so the semantic
 * map and the UI share one constant. Dark-only by design.
 */
export const DesignTokens = {
  color: {
    /** Pure black app background (X-style). */
    bg: '#000000',
    /** Elevated surfaces: sheets, pills, pressed states. */
    bgElevated: '#16181C',
    /** Subtle pressed/hover wash on rows. */
    bgPressed: '#080A0C',
    /** Hairline borders and dividers — slightly lifted so it survives cheap panels. */
    border: '#2F3336',
    /** Primary text. */
    text: '#E7E9EA',
    /** Secondary text: timestamps, handles, helper copy. */
    textMuted: '#71767B',
    /** The Resonance accent (shared with the map palette). */
    accent: ThemeConfig.dark.primary,
    /** Text/icon color on accent-filled surfaces. */
    accentText: '#FFFFFF',
    /** Translucent accent wash (active pill backgrounds, like-highlight). */
    accentSoft: 'rgba(124, 92, 255, 0.15)',
    danger: '#F4212E',
    success: '#00BA7C',
    warning: '#F0A020',
    /** Scrim behind sheets/modals. */
    overlay: 'rgba(91, 112, 131, 0.4)',
  },

  /** 4pt spacing scale. Use these, not ad-hoc margins. */
  space: {
    xxs: 2,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },

  radius: {
    sm: 4,
    md: 12,
    lg: 16,
    pill: 9999,
  },

  font: {
    size: {
      xs: 11,
      sm: 13,
      base: 15,
      lg: 17,
      xl: 20,
      xxl: 26,
      display: 31,
    },
    weight: {
      regular: '400',
      medium: '500',
      bold: '700',
      heavy: '800',
    },
    /** Line heights paired with the sizes above. */
    lineHeight: {
      xs: 14,
      sm: 17,
      base: 20,
      lg: 22,
      xl: 26,
      xxl: 32,
      display: 38,
    },
  },

  /** Shared component dimensions. */
  size: {
    avatar: 40,
    avatarSmall: 24,
    avatarLarge: 64,
    icon: 20,
    iconSmall: 16,
    iconLarge: 24,
    touchTarget: 44,
    tabBarHeight: 52,
    topBarHeight: 52,
    buttonHeight: 44,
    buttonHeightSmall: 32,
    progressBarHeight: 3,
  },
} as const;

export type DesignTokensShape = typeof DesignTokens;
