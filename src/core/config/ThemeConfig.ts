/**
 * Visual design tokens. All colors and sizes referenced by screens MUST be
 * pulled from here, never inlined. The dark palette is the default; the
 * map sub-palette governs the semantic-map starfield.
 *
 * AGENTS.md ("no hardcoded constants at call sites") applies to colors too.
 */
export const ThemeConfig = {
  dark: {
    background: '#0B0D14',
    surface: '#11141C',
    surfaceVariant: '#1A1F2E',
    primary: '#7C5CFF',
    onPrimary: '#FFFFFF',
    onSurface: '#E6E8EE',
    onSurfaceVariant: '#A5ADBE',
    outline: '#2A2F3D',
    success: '#56D364',
    error: '#F85149',
  },
  map: {
    backgroundColor: '#0B0D14',
    gridColor: '#1A1F2E',
    selfStarColor: '#FFFFFF',
    selfStarOuterColor: '#7C5CFF',
    selfStarRadiusPx: 9,
    selfStarOuterRadiusPx: 16,
    peerStarColorHigh: '#7C5CFF',
    peerStarColorLow: '#3A3F55',
    peerStarRadiusPx: 4,
    peerStarSelectedColor: '#FFD86B',
    peerStarSelectedRadiusPx: 6,
    linkColor: '#7C5CFF',
    linkMaxWidthPx: 1.2,
    linkMaxOpacity: 0.35,
    referenceRingColor: '#2A2F3D',
    referenceRingLabelColor: '#5A6075',
    referenceRingStrokeWidthPx: 0.6,
    hitRadiusPx: 22,
  },
} as const;

export type ThemeConfigShape = typeof ThemeConfig;
