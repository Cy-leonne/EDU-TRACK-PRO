'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, BookOpen, CalendarClock } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, EmptyState, Note, ProgressBar, Skeleton, StatCard, StatusBadge } from '@/components/ui';
import { useFamily } from '@/lib/family';
import { colorFor, formatDate, titleCase } from '@/lib/utils';

/**
 * Family overview for the selected child.
 *
 * Only published results are ever returned by the API for a guardian, so there
 * is no risk of a draft leaking here. Achievement labels are the school's own
 * bands, not national grades.
 */
export default function FamilyOverviewPage() {
  const family = useFamily();
  const dashboard = family.dashboard;

  if (family.loading && !dashboard) return <Skeleton className="h-72" />;
  if (!dashboard) return null;

  const publishedCount = dashboard.latestResults.length;
  const upcoming = dashboard.upcomingAssignments;
  const overdue = upcoming.filter((assignment) => assignment.dueDate && new Date(assignment.dueDate) < new Date());

  return (
    <div className="space-y-4">
      {family.learner && !family.learner.isVerified ? (
        <Note tone="warning" title="Your link to this learner is not verified yet">
          <p>
            The school office records how the relationship was confirmed. Until that verification is complete, results and resources stay hidden. Contact the
            office if this is unexpected.
          </p>
        </Note>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Published results" value={publishedCount} hint="Most recent first" />
        <StatCard label="Open assignments" value={upcoming.length} tone={overdue.length ? 'warning' : 'neutral'} hint={overdue.length ? `${overdue.length} past due` : 'Nothing overdue'} />
        <StatCard label="Shared resources" value={dashboard.recentResources.length} />
        <StatCard label="Unread notifications" value={dashboard.unreadNotifications} tone={dashboard.unreadNotifications ? 'info' : 'neutral'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Latest published results"
            description="Achievement labels are the school's own bands."
            actions={
              <Link href="/family/results" className="inline-flex items-center gap-1 text-xs font-semibold text-royal hover:underline">
                See all results <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            }
          />
          <CardBody>
            {publishedCount === 0 ? (
              <EmptyState title="No published results yet" description="Results appear here once the teacher publishes them." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {dashboard.latestResults.map((result) => (
                  <li key={result.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{result.assessmentTitle}</p>
                      <p className="text-xs text-slate-500">
                        {result.learningAreaName} · {result.categoryName}
                        {result.publishedAt ? ` · published ${formatDate(result.publishedAt)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {result.achievementLabel ? <Badge tone="info">{result.achievementLabel}</Badge> : null}
                      <span className="text-sm font-semibold text-slate-700">{result.scoreLabel}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Assignments due" description="Work set for this class." />
          <CardBody className="space-y-3">
            {upcoming.length === 0 ? (
              <EmptyState title="No assignments set" icon={<BookOpen className="h-6 w-6" aria-hidden />} />
            ) : (
              upcoming.map((assignment) => {
                const isOverdue = assignment.dueDate && new Date(assignment.dueDate) < new Date();
                return (
                  <div key={assignment.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">{assignment.title}</p>
                        <p className="text-xs text-slate-500">
                          {assignment.learningAreaName}
                          {assignment.dueDate ? ` · due ${formatDate(assignment.dueDate)}` : ''}
                        </p>
                      </div>
                      {isOverdue ? <Badge tone="danger">past due</Badge> : <StatusBadge status="PUBLISHED" />}
                    </div>
                    {assignment.instructions ? <p className="mt-1 line-clamp-2 text-xs text-slate-600">{assignment.instructions}</p> : null}
                    <Link href="/family/assignments" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-royal hover:underline">
                      Hand in work <ArrowRight className="h-3 w-3" aria-hidden />
                    </Link>
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Progress by learning area" description="Average of published results, most recent cohort of the term." />
          <CardBody className="space-y-3">
            {dashboard.progress.length === 0 ? (
              <EmptyState title="Not enough published results yet" description="Progress appears once at least one result is published." icon={<CalendarClock className="h-6 w-6" aria-hidden />} />
            ) : (
              dashboard.progress.map((area) => {
                const points = area.points as Array<{ percent?: number | null }>;
                const values = points.map((point) => Number(point?.percent ?? 0)).filter((value) => !Number.isNaN(value));
                const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
                return (
                  <div key={area.learningAreaName}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">{area.learningAreaName}</span>
                      <span className="text-slate-500">
                        {values.length} result(s) · average {average.toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-1">
                      <ProgressBar value={Math.round(average)} tone={average >= 60 ? 'success' : average >= 40 ? 'warning' : 'danger'} />
                    </div>
                  </div>
                );
              })
            )}
            <p className="text-[11px] text-slate-500">
              Percentages are the school&apos;s internal record for teaching purposes — they are not a national grading of your child.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Learning resources"
            description="Shared by teachers with this class."
            actions={
              <Link href="/family/resources" className="inline-flex items-center gap-1 text-xs font-semibold text-royal hover:underline">
                All resources <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            }
          />
          <CardBody className="space-y-3">
            {dashboard.recentResources.length === 0 ? (
              <EmptyState title="Nothing shared yet" description="Teachers share notes, links and worksheets here." />
            ) : (
              dashboard.recentResources.map((resource) => (
                <div key={resource.id} className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
                  <span className="mt-0.5 h-8 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: colorFor(resource.learningAreaName ?? resource.title) }} aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{resource.title}</p>
                    <p className="text-xs text-slate-500">
                      {resource.learningAreaName ?? 'General'} · {titleCase(resource.type) ?? 'Resource'}
                      {resource.publishedAt ? ` · ${formatDate(resource.publishedAt)}` : ''}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      {overdue.length ? (
        <Note tone="warning" title={`${overdue.length} assignment(s) past the due date`}>
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5" aria-hidden />
            Work handed in after the due date is flagged to the teacher as late. You can still submit — the reason is up to the school to consider.
          </p>
        </Note>
      ) : null}
    </div>
  );
}
