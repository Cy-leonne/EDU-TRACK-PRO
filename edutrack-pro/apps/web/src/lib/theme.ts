/**
 * Colour tokens shared by the UI layer.
 *
 * Everything that has to be *computed* (a school's own brand colour, a learning
 * area's colour, chart series) lives here so no component invents a hex value of
 * its own. Static styling is done with Tailwind tokens declared in
 * `tailwind.config.ts` / `globals.css`; this module only covers values that must
 * be produced at runtime.
 *
 * Palette reference (EduTrack Pro):
 *   navy #244A78 / #315F91 / #477DB5   action #3B82F6   teal #14B8A6
 *   canvas #F4F8FE / #EDF4FC           border #D9E6F4   ink #23364D / #63758B
 *   success #16865B                    amber #F2B84B     danger #D64545
 */

/** Used until the school's own profile has loaded (or when none is configured). */
export const BRAND_DEFAULTS: { primary: string; accent: string; fg: string } = {
  primary: '#244A78',
  accent: '#14B8A6',
  fg: '#FFFFFF',
};

/** The platform's own identity, used by marketing/auth surfaces. */
export const PRODUCT_BRAND: { primary: string; deep: string; deepest: string } = {
  primary: '#3B82F6',
  deep: '#315F91',
  deepest: '#244A78',
};

/**
 * Distinct, accessible hues for learning-area accents (timetable cells, chips).
 * Only used when a school has not chosen a colour for the learning area.
 */
export const FALLBACK_COLORS = [
  '#2457C5',
  '#0F766E',
  '#B45309',
  '#7C3AED',
  '#0E7490',
  '#BE123C',
  '#4D7C0F',
  '#0369A1',
  '#9A3412',
  '#4338CA',
];

/** Ordered series colours for charts, in the product's palette. */
export const CHART_PALETTE = [
  '#2457C5',
  '#14B8A6',
  '#F59E0B',
  '#3B82F6',
  '#F97373',
  '#52647A',
  '#0F8A6F',
  '#7C3AED',
];

/** `#102A43` -> `16 42 67`, the triplet form CSS variables expect. */
export function hexToRgbTriplet(hex?: string | null): string {
  const fallback = BRAND_DEFAULTS.primary;
  const value = (hex || fallback).replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const int = Number.parseInt(full || fallback.replace('#', ''), 16);
  if (Number.isNaN(int)) return hexToRgbTriplet(fallback);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

/** Blend `hex` toward `target` by `amount` (0..1) so derived shades stay on-brand. */
export function mixHex(hex: string, target: string, amount: number): string {
  const parse = (h: string) => {
    const v = h.replace('#', '');
    const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
    const n = Number.parseInt(full || '000000', 16);
    return Number.isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = parse(hex);
  const [r2, g2, b2] = parse(target);
  const r = Math.round(r1 + (r2 - r1) * amount);
  const g = Math.round(g1 + (g2 - g1) * amount);
  const b = Math.round(b1 + (b2 - b1) * amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h << 5) - h + value.charCodeAt(i);
  return h;
}

/** A stable colour for a name/seed, preferring a colour the school configured. */
export const colorFor = (seed: string, provided?: string | null) =>
  provided || FALLBACK_COLORS[Math.abs(hash(seed)) % FALLBACK_COLORS.length];

/** Readable text colour for a coloured chip (WCAG-ish luminance check). */
export function contrastText(hex?: string | null): string {
  if (!hex) return '#FFFFFF';
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return '#FFFFFF';
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? '#0B172A' : '#FFFFFF';
}
