/**
 * Tiny presentation-layer helpers for blending the theme colors used in
 * the feed cards and the semantic map. Kept here (not in `@core/*`)
 * because color blending is a UI concern, not domain logic.
 */

export function clamp01(v: number): number {
  if (v < 0) {
    return 0;
  }
  if (v > 1) {
    return 1;
  }
  return v;
}

export function interpolateColor(lowHex: string, highHex: string, t: number): string {
  const low = hexToRgb(lowHex);
  const high = hexToRgb(highHex);
  const u = clamp01(t);
  const r = Math.round(low.r + (high.r - low.r) * u);
  const g = Math.round(low.g + (high.g - low.g) * u);
  const b = Math.round(low.b + (high.b - low.b) * u);
  return `rgb(${r},${g},${b})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return { r, g, b };
}
