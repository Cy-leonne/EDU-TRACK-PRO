'use client';

/**
 * EduTrack Pro component kit — navy design system.
 *
 * The public API of this module is stable: every export keeps the props it had
 * before the redesign, so the twenty-plus screens that use it inherit the new
 * look without behavioural change. Additions (HeroPanel, MetricTile, Toolbar,
 * ConfirmDialog, SkeletonTable, TableEmpty) are new names only.
 *
 * Styling rules of thumb used here:
 *  - never plain white as the dominant surface; cards sit on a tinted canvas
 *  - deep navy for navigation and high-impact panels, royal blue for actions
 *  - teal = progress/success, amber = attention, coral = error
 *  - one focus treatment (2px bright blue, offset) across every interactive control
 */

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, X, XCircle } from 'lucide-react';
import { cn, statusTone } from '@/lib/utils';

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'teal' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-b from-royal to-royal-strong text-white shadow-sm hover:brightness-[1.07] hover:shadow-md active:brightness-95 focus-visible:ring-bright',
  secondary:
    'bg-navy-100 text-navy-800 border border-navy-200 hover:bg-navy-200/70 hover:border-navy-300 active:bg-navy-200 focus-visible:ring-bright',
  subtle: 'bg-navy-50 text-navy-700 border border-line hover:bg-navy-100 hover:text-navy-800 focus-visible:ring-bright',
  ghost: 'bg-transparent text-ink-muted hover:bg-navy-100 hover:text-navy-800 focus-visible:ring-bright',
  danger: 'bg-danger text-white shadow-sm hover:brightness-95 active:brightness-90 focus-visible:ring-danger',
  outline: 'border border-line-strong bg-surface text-ink-strong hover:bg-navy-50 hover:border-navy-300 focus-visible:ring-bright',
  teal: 'bg-gradient-to-b from-teal-500 to-teal-600 text-white shadow-sm hover:brightness-[1.05] focus-visible:ring-teal-400',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-6 text-sm',
  icon: 'h-9 w-9',
  'icon-sm': 'h-8 w-8',
};

export type { ButtonSize, ButtonVariant };

/**
 * The button surface, exposed so links can look like buttons without nesting a
 * <button> inside an <a> (invalid HTML) or duplicating the classes ad hoc.
 */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) {
  return cn(
    'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold tracking-[-0.005em]',
    'transition-[background-color,box-shadow,filter,transform,color] duration-120 ease-standard',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none',
    buttonVariants[variant],
    buttonSizes[size],
    extra,
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({ className, variant = 'primary', size = 'md', loading, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold tracking-[-0.005em]',
        'transition-[background-color,box-shadow,filter,transform,color] duration-120 ease-standard',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------- Form fields */

export function Field({ label, hint, error, required, children, className }: { label?: string; hint?: string; error?: string | null; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      {label ? (
        <span className="flex items-baseline gap-1 text-xs font-semibold text-ink-muted">
          {label}
          {required ? (
            <span className="text-danger" aria-hidden>
              *
            </span>
          ) : null}
        </span>
      ) : null}
      {children}
      {error ? (
        <span role="alert" className="flex items-start gap-1 text-xs font-medium text-rose-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {error}
        </span>
      ) : hint ? (
        <span className="block text-xs text-ink-subtle">{hint}</span>
      ) : null}
    </label>
  );
}

const controlClass =
  'w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink-strong shadow-xs transition ' +
  'placeholder:text-ink-subtle hover:border-navy-300 ' +
  'focus:border-royal focus:outline-none focus:ring-2 focus:ring-bright/30 ' +
  'disabled:cursor-not-allowed disabled:bg-navy-50 disabled:text-ink-subtle aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20';

export const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={cn(controlClass, 'h-10', className)} />;
export const Textarea = ({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} className={cn(controlClass, 'min-h-[88px] resize-y', className)} />;
export const Select = ({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  /* The chevron is a real element rather than a CSS background so it inherits
     the ink colour and stays visible in forced-colours / high-contrast mode. */
  <span className="relative block">
    <select {...props} className={cn(controlClass, 'h-10 cursor-pointer appearance-none pr-9', className)}>
      {children}
    </select>
    <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
  </span>
);

export function Checkbox({ label, className, ...props }: { label: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <span className={cn('flex items-start gap-2.5 text-sm text-ink', className)}>
      <input id={id} type="checkbox" {...props} className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong text-royal focus:ring-2 focus:ring-bright/40 focus:ring-offset-0" />
      <label htmlFor={id} className="cursor-pointer select-none leading-snug">
        {label}
      </label>
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-pill border transition-colors duration-180',
        checked ? 'border-royal bg-royal' : 'border-line-strong bg-navy-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-bright focus-visible:ring-offset-2 disabled:opacity-50',
      )}
    >
      <span className={cn('h-4.5 w-4.5 rounded-full bg-white shadow-sm transition-transform duration-180 ease-out', checked ? 'translate-x-[1.45rem]' : 'translate-x-[0.2rem]')} style={{ height: '1.125rem', width: '1.125rem' }} />
    </button>
  );
}

/* ------------------------------------------------------------------- Card */

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('overflow-hidden rounded-lg border border-line bg-surface shadow-sm', className)}>{children}</div>;
}

export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line bg-surface-muted/60 px-4 py-3 sm:px-5', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-ink-strong">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('px-4 py-4 sm:px-5', className)}>{children}</div>;
}

/* ------------------------------------------------------------------ Badge */

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-navy-100 text-navy-700 border-navy-200',
  success: 'bg-teal-50 text-teal-800 border-teal-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  danger: 'bg-rose-50 text-rose-700 border-rose-200',
  info: 'bg-royal-soft text-royal-strong border-bright/30',
};

const toneDots: Record<Tone, string> = {
  neutral: 'bg-navy-400',
  success: 'bg-teal-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-bright',
};

export function Badge({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>
  );
}

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const label = (status ?? 'UNKNOWN').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const tone = statusTone(status);
  return (
    <Badge tone={tone} className={className}>
      {/* colour is never the only signal: every status carries a dot plus its label */}
      <span className={cn('h-1.5 w-1.5 rounded-full', toneDots[tone])} aria-hidden />
      {label}
    </Badge>
  );
}

/* ---------------------------------------------------------------- Feedback */

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line-strong bg-gradient-to-b from-navy-50/70 to-surface px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-100 text-navy-600 ring-1 ring-inset ring-navy-200">{icon ?? <Info className="h-5 w-5" aria-hidden />}</div>
      <p className="text-sm font-semibold text-ink-strong">{title}</p>
      {description ? <p className="max-w-md text-xs leading-relaxed text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 text-sm text-ink-muted', className)} role="status" aria-live="polite">
      <Loader2 className="h-4 w-4 animate-spin text-royal" aria-hidden />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton-shimmer rounded-md', className)} aria-hidden />;
}

/** Skeleton sized like a data table, so loading pages do not jump when data lands. */
export function SkeletonTable({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      <div className="flex gap-3 rounded-md bg-navy-100/70 px-3 py-2">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3 px-3 py-2.5">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton key={colIndex} className={cn('h-3 flex-1', colIndex === 0 && 'max-w-[9rem]')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        {message}
      </span>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function ProgressBar({ value, tone = 'brand', label }: { value: number; tone?: 'brand' | 'success' | 'warning' | 'danger'; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const bar = {
    brand: 'bg-gradient-to-r from-royal to-bright',
    success: 'bg-gradient-to-r from-teal-500 to-teal-600',
    warning: 'bg-gradient-to-r from-amber-400 to-amber-500',
    danger: 'bg-gradient-to-r from-rose-400 to-rose-600',
  }[tone];
  return (
    <div className="space-y-1.5">
      <div className="h-2 w-full overflow-hidden rounded-pill bg-navy-200/70" role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cn('progress-fill h-full rounded-pill', bar)} style={{ width: `${clamped}%` }} />
      </div>
      {label ? <p className="text-xs text-ink-muted">{label}</p> : null}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = 'neutral', icon }: { label: string; value: React.ReactNode; hint?: string; tone?: Tone; icon?: React.ReactNode }) {
  const iconTone: Record<Tone, string> = {
    neutral: 'bg-navy-100 text-navy-700',
    success: 'bg-teal-100 text-teal-700',
    warning: 'bg-amber-100 text-amber-700',
    danger: 'bg-rose-100 text-rose-700',
    info: 'bg-royal-soft text-royal',
  };
  return (
    <div className="stat-tile surface-interactive">
      <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-muted">{label}</p>
          <p className="tabular mt-1.5 truncate text-3xl font-semibold leading-none text-ink-strong">{value}</p>
          {hint ? <p className="mt-1.5 text-xs text-ink-muted">{hint}</p> : null}
        </div>
        {icon ? <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', iconTone[tone])}>{icon}</div> : null}
      </div>
    </div>
  );
}

/** Large metric used inside the navy hero panels on dashboards. */
export function HeroMetric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.07] px-4 py-3 backdrop-blur-sm">
      <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-inverse-muted">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold leading-none text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-inverse-muted">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Modal */

export function Modal({ open, onClose, title, description, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog so keyboard users are not left behind.
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])');
      focusable?.focus();
    }, 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];

  return (
    <div className="fixed inset-0 z-modal flex items-end justify-center bg-navy-950/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn('animate-rise max-h-[92vh] w-full overflow-y-auto rounded-t-xl border border-line bg-surface shadow-xl sm:rounded-xl', width)}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="text-base font-semibold text-ink-strong">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-md p-1.5 text-ink-muted transition hover:bg-navy-100 hover:text-navy-800">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-line bg-surface-muted/80 px-5 py-3 backdrop-blur">{footer}</div> : null}
      </div>
    </div>
  );
}

/**
 * Confirmation for irreversible or wide-reaching actions (publish, delete,
 * supersede). Deliberately a separate component so the destructive path is
 * always styled as such.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={typeof description === 'string' ? description : undefined}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {typeof description !== 'string' ? <div className="text-sm text-ink">{description}</div> : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------- Tabs */

export function Tabs({ tabs, value, onChange, className }: { tabs: Array<{ id: string; label: string; badge?: React.ReactNode }>; value: string; onChange: (id: string) => void; className?: string }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b border-line', className)} role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative shrink-0 px-3.5 py-2.5 text-sm font-semibold transition-colors duration-120',
              active ? 'text-royal-strong' : 'text-ink-muted hover:text-navy-800',
            )}
          >
            <span className="flex items-center gap-2">
              {tab.label}
              {tab.badge ? (
                <span className={cn('rounded-pill px-1.5 py-0.5 text-2xs font-semibold', active ? 'bg-royal-soft text-royal-strong' : 'bg-navy-100 text-navy-600')}>{tab.badge}</span>
              ) : null}
            </span>
            <span
              className={cn('absolute inset-x-1.5 -bottom-px h-0.5 rounded-pill transition-all duration-180', active ? 'bg-gradient-to-r from-royal to-bright opacity-100' : 'opacity-0')}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Table */

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('table-shell -mx-4 sm:mx-0', className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export const Th = ({ className, children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    {...props}
    className={cn(
      'sticky top-0 z-[1] border-b border-line bg-navy-50/95 px-3 py-2.5 text-left text-2xs font-semibold uppercase tracking-[0.06em] text-navy-600 backdrop-blur',
      className,
    )}
  >
    {children}
  </th>
);

export const Td = ({ className, children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td {...props} className={cn('border-b border-line/70 px-3 py-2.5 align-middle text-ink', className)}>
    {children}
  </td>
);

/** Row used inside <tbody> where each row is clickable — keeps hover consistent. */
export function TableRow({ className, children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...props} className={cn('transition-colors duration-120 hover:bg-navy-50/70', className)}>
      {children}
    </tr>
  );
}

export function TableEmpty({ colSpan, title, description, action }: { colSpan: number; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10">
        <EmptyState title={title} description={description} action={action} />
      </td>
    </tr>
  );
}

/* ----------------------------------------------------------------- Toasts */

type Toast = { id: number; tone: 'success' | 'error' | 'info' | 'warning'; title: string; description?: string };
const ToastContext = createContext<{ push: (toast: Omit<Toast, 'id'>) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...toast, id }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), toast.tone === 'error' ? 9000 : 5000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);

  const icon = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const ring = {
    success: 'border-teal-200 bg-teal-50 text-teal-900',
    error: 'border-rose-200 bg-rose-50 text-rose-900',
    info: 'border-navy-200 bg-navy-50 text-navy-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-toast flex w-[min(92vw,22rem)] flex-col gap-2" aria-live="polite" role="status">
        {toasts.map((toast) => {
          const Icon = icon[toast.tone];
          return (
            <div key={toast.id} className={cn('animate-rise pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-3 shadow-lg', ring[toast.tone])}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description ? <p className="mt-0.5 break-words text-xs opacity-90">{toast.description}</p> : null}
              </div>
              <button type="button" aria-label="Dismiss notification" onClick={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))} className="rounded p-1 hover:bg-black/5">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return {
    success: (title: string, description?: string) => context.push({ tone: 'success', title, description }),
    error: (title: string, description?: string) => context.push({ tone: 'error', title, description }),
    info: (title: string, description?: string) => context.push({ tone: 'info', title, description }),
    warning: (title: string, description?: string) => context.push({ tone: 'warning', title, description }),
  };
}

/* ------------------------------------------------------------------ Layout */

export function PageHeader({ title, description, actions, breadcrumb }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; breadcrumb?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1.5 text-xs font-medium text-ink-muted">{breadcrumb}</div> : null}
        <h1 className="truncate text-2xl font-semibold tracking-[-0.015em] text-ink-strong sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Deep navy hero band used at the top of dashboards and on the family/teaching
 * landing pages. Children render inside the tinted panel.
 */
export function HeroPanel({
  eyebrow,
  title,
  subtitle,
  children,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('hero-gradient relative overflow-hidden rounded-xl border border-navy-700/60 p-5 shadow-lg sm:p-6', className)}>
      <div className="hero-grid-lines pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden />
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-bright/20 blur-3xl" aria-hidden />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-ink-inverse-muted">{eyebrow}</p> : null}
          <h2 className="mt-1.5 text-2xl font-semibold leading-tight text-white sm:text-3xl">{title}</h2>
          {subtitle ? <p className="mt-2 max-w-2xl text-sm text-ink-inverse-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="relative mt-5">{children}</div> : null}
    </section>
  );
}

export function SectionHeading({ title, description, actions, className }: { title: string; description?: string; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-end justify-between gap-3', className)}>
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-navy-700">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Search + filter + action strip used above lists. */
export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-muted/70 p-2.5', className)}>{children}</div>
  );
}

export function Note({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'success' | 'danger'; title?: string; children: React.ReactNode }) {
  const styles = {
    info: 'border-navy-200 bg-navy-50 text-navy-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    success: 'border-teal-200 bg-teal-50 text-teal-900',
    danger: 'border-rose-200 bg-rose-50 text-rose-900',
  }[tone];
  const Icon = { info: Info, warning: AlertTriangle, success: CheckCircle2, danger: AlertTriangle }[tone];
  return (
    <div className={cn('flex gap-2.5 rounded-lg border px-4 py-3 text-xs', styles)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">
        {title ? <p className="text-sm font-semibold">{title}</p> : null}
        <div className="space-y-1 leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

export function Avatar({ name, className }: { name?: string | null; className?: string }) {
  const label = (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-navy-700 to-navy-900 text-xs font-semibold text-white ring-1 ring-inset ring-white/10',
        className,
      )}
    >
      {label || '?'}
    </span>
  );
}

export function KeyValue({ items, columns = 2 }: { items: Array<{ label: string; value: React.ReactNode }>; columns?: 1 | 2 | 3 }) {
  const cols = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' }[columns];
  return (
    <dl className={cn('grid grid-cols-1 gap-x-4 gap-y-3.5', cols)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0 border-l-2 border-navy-200 pl-3">
          <dt className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-muted">{item.label}</dt>
          <dd className="mt-0.5 break-words text-sm font-medium text-ink-strong">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Horizontal scroll wrapper used by the timetable grids on small screens. */
export function ScrollArea({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('overflow-x-auto overscroll-x-contain', className)}>{children}</div>;
}
