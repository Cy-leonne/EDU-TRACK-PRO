/** Formatting helpers shared by assessment screens. */

/**
 * Achievement bands are stored as 0–100 percentages. Displayed as a readable
 * range that stays honest about fractional upper bounds (e.g. 39.99).
 */
export function percentRange(min: number | string, max: number | string) {
  const from = Number(min);
  const to = Number(max);
  const format = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
  return `${format(from)}% – ${format(to)}%`;
}

export function bandForPercent(percent: number | null | undefined, bands: Array<{ label: string; minPercent: number | string; maxPercent: number | string }>) {
  if (percent === null || percent === undefined) return null;
  const ordered = [...bands].sort((a, b) => Number(a.minPercent) - Number(b.minPercent));
  return ordered.find((band) => percent >= Number(band.minPercent) && percent <= Number(band.maxPercent)) ?? null;
}
