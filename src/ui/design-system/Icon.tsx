import Svg, { G, Path, Circle, Line, Polyline, Polygon } from 'react-native-svg';
import type { ReactElement } from 'react';
import { DesignTokens as T } from '@core/config/DesignTokens';

/**
 * In-repo icon set (Feather-style strokes, 24×24 viewBox) rendered via
 * react-native-svg — replaces Paper/MaterialCommunityIcons so the app has
 * no Material glyphs left. Add new glyphs here, nowhere else.
 */
export type IconName =
  | 'home'
  | 'compass'
  | 'zap'
  | 'user'
  | 'settings'
  | 'arrow-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'check'
  | 'plus'
  | 'minus'
  | 'x'
  | 'trash'
  | 'send'
  | 'heart'
  | 'reply'
  | 'robot'
  | 'search'
  | 'edit'
  | 'shield'
  | 'inbox'
  | 'alert'
  | 'refresh'
  | 'download'
  | 'resonance';

const GLYPHS: Record<IconName, ReactElement> = {
  home: (
    <>
      <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <Polyline points="9 22 9 12 15 12 15 22" />
    </>
  ),
  compass: (
    <>
      <Circle cx={12} cy={12} r={10} />
      <Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </>
  ),
  zap: <Polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  user: (
    <>
      <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <Circle cx={12} cy={7} r={4} />
    </>
  ),
  settings: (
    <>
      <Line x1={4} y1={21} x2={4} y2={14} />
      <Line x1={4} y1={10} x2={4} y2={3} />
      <Line x1={12} y1={21} x2={12} y2={12} />
      <Line x1={12} y1={8} x2={12} y2={3} />
      <Line x1={20} y1={21} x2={20} y2={16} />
      <Line x1={20} y1={12} x2={20} y2={3} />
      <Line x1={1} y1={14} x2={7} y2={14} />
      <Line x1={9} y1={8} x2={15} y2={8} />
      <Line x1={17} y1={16} x2={23} y2={16} />
    </>
  ),
  'arrow-left': (
    <>
      <Line x1={19} y1={12} x2={5} y2={12} />
      <Polyline points="12 19 5 12 12 5" />
    </>
  ),
  'chevron-right': <Polyline points="9 18 15 12 9 6" />,
  'chevron-down': <Polyline points="6 9 12 15 18 9" />,
  check: <Polyline points="20 6 9 17 4 12" />,
  plus: (
    <>
      <Line x1={12} y1={5} x2={12} y2={19} />
      <Line x1={5} y1={12} x2={19} y2={12} />
    </>
  ),
  minus: <Line x1={5} y1={12} x2={19} y2={12} />,
  x: (
    <>
      <Line x1={18} y1={6} x2={6} y2={18} />
      <Line x1={6} y1={6} x2={18} y2={18} />
    </>
  ),
  trash: (
    <>
      <Polyline points="3 6 5 6 21 6" />
      <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  send: (
    <>
      <Line x1={22} y1={2} x2={11} y2={13} />
      <Polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>
  ),
  heart: (
    <Path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  ),
  reply: (
    <Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  ),
  robot: (
    <>
      <Path d="M5 11a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
      <Circle cx={9.5} cy={14} r={1} />
      <Circle cx={14.5} cy={14} r={1} />
      <Line x1={12} y1={9} x2={12} y2={5} />
      <Circle cx={12} cy={4} r={1} />
    </>
  ),
  search: (
    <>
      <Circle cx={11} cy={11} r={8} />
      <Line x1={21} y1={21} x2={16.65} y2={16.65} />
    </>
  ),
  edit: <Path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />,
  shield: <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  inbox: (
    <>
      <Polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <Path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  alert: (
    <>
      <Circle cx={12} cy={12} r={10} />
      <Line x1={12} y1={8} x2={12} y2={12} />
      <Line x1={12} y1={16} x2={12.01} y2={16} />
    </>
  ),
  refresh: (
    <>
      <Polyline points="23 4 23 10 17 10" />
      <Path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </>
  ),
  download: (
    <>
      <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <Polyline points="7 10 12 15 17 10" />
      <Line x1={12} y1={3} x2={12} y2={15} />
    </>
  ),
  /**
   * The Resonance mark: a solid point radiating two arcs. Refined brand
   * geometry — 110° sweeps rotated -15° so the endpoints clear the axes
   * (motion, not a static compass), heavier brand-weight stroke, filled
   * core. Keep in sync with `assets/brand/resonance-mark.svg`.
   */
  resonance: (
    <>
      <Path d="M9.93 4.27A8 8 0 0 1 19.97 12.7" strokeWidth={2.6} />
      <Path d="M14.07 19.73A8 8 0 0 1 4.03 11.3" strokeWidth={2.6} />
      <Circle cx={12} cy={12} r={2.8} fill="currentColor" strokeWidth={0} />
    </>
  ),
};

export function Icon(props: {
  name: IconName;
  size?: number;
  color?: string;
  /** Fill the glyph with `color` instead of stroking it (e.g. an active heart). */
  filled?: boolean;
}) {
  const size = props.size ?? T.size.icon;
  const color = props.color ?? T.color.text;
  return (
    // `color` feeds `currentColor` (the resonance mark's filled core).
    <Svg width={size} height={size} viewBox="0 0 24 24" color={color}>
      <G
        stroke={color}
        strokeWidth={1.75}
        fill={props.filled === true ? color : 'none'}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPHS[props.name]}
      </G>
    </Svg>
  );
}
