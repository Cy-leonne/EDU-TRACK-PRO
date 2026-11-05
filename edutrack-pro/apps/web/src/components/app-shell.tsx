'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bell, ChevronRight, LogOut, Menu, Search, X } from 'lucide-react';
import { useSession } from '@/lib/session';
import { visibleSections } from '@/lib/nav';
import { api } from '@/lib/api';
import { useApiQuery } from '@/lib/hooks';
import { Avatar, Badge, Button } from '@/components/ui';
import { cn, formatRelative } from '@/lib/utils';
import type { NotificationItem } from '@/lib/types';

const roleLabel = {
  SUPERADMIN: 'Platform Superadmin',
  ADMIN: 'School Administrator',
  CLASS_TEACHER: 'Class Teacher',
  TEACHER: 'Teacher',
  PARENT: 'Parent/Guardian',
} as const;

/**
 * Role-aware application shell.
 *
 * Deep navy sidebar (fixed on desktop, drawer on phones), refined top bar with
 * search, notification bell and account menu, and a tinted content canvas.
 * Navigation, permissions and the data it loads are unchanged from before the
 * redesign — only the presentation is new.
 */
export function AppShell({ children, title }: { children: React.ReactNode; title?: string }) {
  const { user, school, signOut, hasPermission } = useSession();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const sections = user ? visibleSections(user.role, user.permissions ?? []) : [];
  const unread = useApiQuery<{ count: number } | number>(user ? '/notifications/unread-count' : null, { pollMs: 60000 });
  const notifications = useApiQuery<NotificationItem[] | { items: NotificationItem[] }>(bellOpen ? '/notifications?limit=8' : null);

  const unreadCount = typeof unread.data === 'number' ? unread.data : (unread.data as { count?: number } | null)?.count ?? 0;
  const items = Array.isArray(notifications.data) ? notifications.data : notifications.data?.items ?? [];

  useEffect(() => {
    setDrawerOpen(false);
    setBellOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  // Escape closes any open overlay — keyboard users never get stuck.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setBellOpen(false);
      setMenuOpen(false);
      setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const isActive = (href: string) => pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));

  const markAllRead = async () => {
    await api.post('/notifications/read-all');
    notifications.reload();
    unread.reload();
  };

  const currentSection = sections.find((section) => section.items.some((item) => isActive(item.href)));

  return (
    <div className="app-canvas flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-sidebar shrink-0 flex-col panel-navy lg:flex">
        <SidebarContent sections={sections} pathname={pathname} schoolName={school?.portalName || user?.schoolName} isActive={isActive} />
      </aside>

      {/* Sidebar (mobile drawer) */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-drawer lg:hidden">
          <div className="animate-fade absolute inset-0 bg-navy-950/60 backdrop-blur-[2px]" onClick={() => setDrawerOpen(false)} aria-hidden />
          <aside className="animate-slide-in absolute inset-y-0 left-0 flex w-72 flex-col panel-navy shadow-xl">
            <div className="flex items-center justify-end px-2 pt-2">
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setDrawerOpen(false)}
                className="rounded-md p-2 text-ink-inverse-muted transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <SidebarContent sections={sections} pathname={pathname} schoolName={school?.portalName || user?.schoolName} isActive={isActive} />
            </div>
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
          <div className="flex h-topbar items-center gap-2 px-3 sm:px-5">
            <button
              type="button"
              className="rounded-md p-2 text-ink-muted transition hover:bg-navy-100 hover:text-navy-800 lg:hidden"
              aria-label="Open navigation"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="h-5 w-5" aria-hidden />
            </button>

            <div className="min-w-0 lg:block">
              <p className="truncate text-sm font-semibold text-ink-strong lg:hidden">{title ?? 'EduTrack Pro'}</p>
              <div className="hidden items-center gap-1.5 text-xs text-ink-muted lg:flex">
                <span className="font-medium text-navy-700">{school?.portalName || user?.schoolName || 'EduTrack Pro'}</span>
                {currentSection ? (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
                    <span>{currentSection.title}</span>
                  </>
                ) : null}
              </div>
            </div>

            <form
              className="ml-auto hidden items-center gap-2 sm:flex"
              role="search"
              onSubmit={(event) => {
                event.preventDefault();
                const value = new FormData(event.currentTarget).get('q');
                if (typeof value === 'string' && value.trim()) {
                  const target = user?.role === 'ADMIN' ? `/people/learners?q=${encodeURIComponent(value.trim())}` : `/teaching/assessments?q=${encodeURIComponent(value.trim())}`;
                  window.location.href = target;
                }
              }}
            >
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden />
                <input
                  name="q"
                  placeholder={user?.role === 'PARENT' ? 'Search…' : 'Search learners…'}
                  aria-label="Search"
                  className="h-9 w-48 rounded-md border border-line-strong bg-surface-muted pl-9 pr-3 text-sm text-ink-strong shadow-xs transition placeholder:text-ink-subtle focus:border-royal focus:bg-white focus:outline-none focus:ring-2 focus:ring-bright/30 lg:w-64"
                />
              </div>
            </form>

            <div className={cn('flex items-center gap-1', 'ml-auto sm:ml-2')}>
              {/* Notification bell */}
              <div className="relative">
                <button
                  type="button"
                  aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
                  aria-expanded={bellOpen}
                  onClick={() => setBellOpen((open) => !open)}
                  className="relative rounded-md p-2 text-ink-muted transition hover:bg-navy-100 hover:text-navy-800"
                >
                  <Bell className="h-5 w-5" aria-hidden />
                  {unreadCount > 0 ? (
                    <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-danger px-1 text-2xs font-bold text-white ring-2 ring-surface">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  ) : null}
                </button>
                {bellOpen ? (
                  <div className="animate-rise absolute right-0 top-12 z-40 w-[min(92vw,23rem)] overflow-hidden rounded-lg border border-line bg-surface shadow-xl">
                    <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-muted/70 px-3.5 py-2.5">
                      <p className="text-sm font-semibold text-ink-strong">Notifications</p>
                      <button type="button" className="text-xs font-semibold text-royal transition hover:text-royal-strong hover:underline" onClick={markAllRead}>
                        Mark all read
                      </button>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {notifications.loading ? <p className="px-3.5 py-4 text-xs text-ink-muted">Loading…</p> : null}
                      {!notifications.loading && items.length === 0 ? <p className="px-3.5 py-6 text-center text-xs text-ink-muted">You are all caught up.</p> : null}
                      {items.map((item) => (
                        <Link
                          key={item.id}
                          href={item.link || '#'}
                          className={cn(
                            'block border-b border-line/70 px-3.5 py-2.5 transition hover:bg-navy-50',
                            !item.readAt && 'bg-royal-soft/40',
                          )}
                          onClick={() => void api.patch(`/notifications/${item.id}/read`).catch(() => undefined)}
                        >
                          <p className={cn('text-sm', item.readAt ? 'text-ink' : 'font-semibold text-ink-strong')}>{item.title}</p>
                          {item.body ? <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{item.body}</p> : null}
                          <p className="mt-1 text-2xs text-ink-subtle">{formatRelative(item.createdAt)}</p>
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Account menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 transition hover:bg-navy-100"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label={`Account menu — ${user?.fullName ?? 'your account'}`}
                >
                  <Avatar name={user?.fullName} className="h-8 w-8" />
                  <span className="hidden text-left sm:block">
                    <span className="block max-w-[10rem] truncate text-xs font-semibold text-ink-strong">{user?.fullName}</span>
                    <span className="block text-2xs text-ink-muted">{user ? roleLabel[user.role] : ''}</span>
                  </span>
                </button>
                {menuOpen ? (
                  <div role="menu" className="animate-rise absolute right-0 top-12 z-40 w-60 overflow-hidden rounded-lg border border-line bg-surface shadow-xl">
                    <div className="border-b border-line bg-navy-50/70 px-3.5 py-3">
                      <p className="truncate text-sm font-semibold text-ink-strong">{user?.fullName}</p>
                      <p className="truncate text-xs text-ink-muted">{user?.email}</p>
                      <Badge tone="info" className="mt-1.5">
                        {user ? roleLabel[user.role] : ''}
                      </Badge>
                    </div>
                    <div className="p-1">
                      <Link href="/account" className="block rounded-md px-3 py-2 text-sm text-ink transition hover:bg-navy-50 hover:text-navy-800">
                        My account
                      </Link>
                      <button
                        type="button"
                        onClick={() => void signOut()}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-rose-700 transition hover:bg-rose-50"
                      >
                        <LogOut className="h-4 w-4" aria-hidden />
                        Sign out
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-5 sm:py-6">
          {children}
        </main>

        <footer className="border-t border-line bg-surface/60 px-4 py-4 text-center text-2xs text-ink-muted">
          EduTrack Pro · internal school records — these are not official national assessment outcomes.
        </footer>
      </div>
    </div>
  );
}

function SidebarContent({
  sections,
  pathname,
  schoolName,
  isActive,
}: {
  sections: ReturnType<typeof visibleSections>;
  pathname: string;
  schoolName?: string;
  isActive: (href: string) => boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-bright to-royal text-white shadow-md ring-1 ring-inset ring-white/20">
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden fill="currentColor">
            <path d="M12 3 1 8l11 5 9-4.09V17h2V8L12 3Zm-7 9.18V16c0 1.66 3.13 3 7 3s7-1.34 7-3v-3.82l-7 3.18-7-3.18Z" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-[-0.01em] text-white">EduTrack Pro</p>
          <p className="truncate text-2xs text-ink-inverse-muted">{schoolName ?? 'Junior school'}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4" aria-label="Main navigation">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="px-2.5 pb-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-navy-400">{section.title}</p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-120',
                        active
                          ? 'bg-white/[0.11] font-semibold text-white shadow-sm'
                          : 'text-navy-300 hover:bg-white/[0.06] hover:text-white',
                      )}
                    >
                      {active ? <span className="absolute inset-y-1 left-0 w-0.5 rounded-pill bg-gradient-to-b from-bright to-accent" aria-hidden /> : null}
                      <Icon className={cn('h-4 w-4 shrink-0 transition-transform duration-180', active ? 'text-bright' : 'text-navy-400 group-hover:text-navy-200')} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="text-2xs leading-relaxed text-navy-400">
          Grades 7–9 · CBE-aligned records
          <br />
          Internal records only — not national results.
        </p>
      </div>
    </>
  );
}
