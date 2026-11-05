'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Baby, BellRing } from 'lucide-react';
import { Badge, ErrorState, Select, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { FamilyProvider, useFamily } from '@/lib/family';

const TABS = [
  { href: '/family', label: 'Overview' },
  { href: '/family/results', label: 'Results & progress' },
  { href: '/family/timetable', label: 'Timetable' },
  { href: '/family/assignments', label: 'Assignments' },
  { href: '/family/resources', label: 'Resources' },
  { href: '/family/notifications', label: 'Notifications' },
];

function FamilyShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const family = useFamily();

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Family portal</p>
            {family.loading && !family.dashboard ? (
              <Skeleton className="mt-1 h-6 w-56" />
            ) : family.learner ? (
              <>
                <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold text-slate-800">
                  {family.learner.fullName}
                  {family.learner.isVerified ? (
                    <Badge tone="success">verified link</Badge>
                  ) : (
                    <Badge tone="warning">link pending verification</Badge>
                  )}
                </h1>
                <p className="text-sm text-slate-500">
                  {family.learner.className} · {family.learner.gradeName} · admission {family.learner.admissionNumber}
                  {family.dashboard?.academicContext?.termName ? ` · ${family.dashboard.academicContext.academicYearName}, ${family.dashboard.academicContext.termName}` : ''}
                </p>
              </>
            ) : (
              <h1 className="text-xl font-semibold text-slate-800">Family portal</h1>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {family.learners.length > 1 ? (
              <label className="text-xs font-medium text-slate-600">
                Child
                <Select
                  className="mt-1 w-full sm:w-56"
                  value={family.learnerId ?? ''}
                  onChange={(event) => family.setLearnerId(event.target.value)}
                >
                  {family.learners.map((learner) => (
                    <option key={learner.id} value={learner.id}>
                      {learner.fullName} — {learner.className}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <Link
              href="/family/notifications"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <BellRing className="h-4 w-4" aria-hidden /> Notifications
              {family.dashboard?.unreadNotifications ? <Badge tone="danger">{family.dashboard.unreadNotifications}</Badge> : null}
            </Link>
          </div>
        </div>

        <nav className="mt-4 flex gap-1 overflow-x-auto" aria-label="Family portal sections">
          {TABS.map((tab) => {
            const active = tab.href === '/family' ? pathname === '/family' : pathname?.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition',
                  active ? 'bg-brand text-brand-fg' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {family.error ? <ErrorState message={family.error} onRetry={() => family.reload()} /> : null}

      {family.learners.length === 0 && !family.loading ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <Baby className="mx-auto h-7 w-7 text-slate-400" aria-hidden />
          <h2 className="mt-2 text-base font-semibold text-slate-800">No learner is linked to your account yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            The school office links a guardian account to a learner and verifies the relationship. Once they do, the child&apos;s results, timetable and
            assignments appear here.
          </p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return (
    <FamilyProvider>
      <FamilyShell>{children}</FamilyShell>
    </FamilyProvider>
  );
}
