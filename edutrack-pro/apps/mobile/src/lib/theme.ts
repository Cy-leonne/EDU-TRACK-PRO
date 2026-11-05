/**
 * Mobile design tokens.
 *
 * Colours come from the school's own branding when the API provides it (schools in
 * Kenya vary), with a neutral fallback so the app is usable before sign-in.
 */
export const colors = {
  brand: '#244A78',
  brandSoft: '#EDF4FC',
  accent: '#14B8A6',
  text: '#23364D',
  muted: '#63758B',
  border: '#D9E6F4',
  surface: '#FFFFFF',
  background: '#F4F8FE',
  success: '#16865B',
  warning: '#F2B84B',
  danger: '#D64545',
  info: '#315F91',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export function tint(status?: string | null): string {
  switch ((status ?? '').toUpperCase()) {
    case 'PUBLISHED':
    case 'ACCEPTED':
    case 'ACTIVE':
      return colors.success;
    case 'RETURNED':
    case 'LATE':
    case 'READY_FOR_REVIEW':
      return colors.warning;
    case 'DRAFT':
    case 'MISSING':
    case 'ARCHIVED':
      return colors.muted;
    default:
      return colors.info;
  }
}
