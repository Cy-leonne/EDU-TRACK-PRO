import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const dayName = (dayOfWeek: number) => DAY_NAMES[dayOfWeek] ?? `Day ${dayOfWeek}`;
export const dayShort = (dayOfWeek: number) => dayName(dayOfWeek).slice(0, 3);

/** Dates arrive as ISO strings; show them the way a Kenyan school office writes them. */
export function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatRelative(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return '—';
  const diff = Date.now() - date;
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (Math.abs(minutes) < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 31) return `${days}d ago`;
  return formatDate(value);
}

export function initials(name?: string | null) {
  if (!name) return '??';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function formatNumber(value?: number | null, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-KE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPercent(value?: number | null, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

export function formatBytes(bytes?: number | null) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export const titleCase = (value?: string | null) => {
  if (!value) return '';
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

/* Colour helpers live in `lib/theme.ts` so every surface shares one palette. */
export { FALLBACK_COLORS, CHART_PALETTE, colorFor, contrastText, hexToRgbTriplet, mixHex } from './theme';

export function todayDayOfWeek() {
  const day = new Date().getDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

export function statusTone(status?: string | null) {
  switch ((status ?? '').toUpperCase()) {
    case 'PUBLISHED':
    case 'ACCEPTED':
    case 'ACTIVE':
    case 'VALIDATED':
      return 'success' as const;
    case 'DRAFT':
    case 'READY_FOR_REVIEW':
    case 'SUBMITTED':
    case 'LATE':
    case 'REVIEWED':
      return 'warning' as const;
    case 'RETURNED':
    case 'CORRECTED':
    case 'ARCHIVED':
    case 'SUPERSEDED':
    case 'INACTIVE':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
}
