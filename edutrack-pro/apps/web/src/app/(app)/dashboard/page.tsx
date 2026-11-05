'use client';

import { FALLBACK_COLORS } from '@/lib/theme';
import Link from 'next/link';
import { useState } from 'react';
import {
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  GraduationCap,
  Library,
  ListChecks,
  ShieldAlert,
  Users,
} from 'lucide-react';
import { useSession } from '@/lib/session';
import { useApiQuery } from '@/lib/hooks';
import {
  Button,
  buttonClass,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  HeroMetric,
  HeroPanel,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { dayName, formatDate, formatPercent, formatRelative } from '@/lib/utils';
import type { AdminDashboard, ParentDashboard, TeacherDashboard } from '@/lib/types';

export default function DashboardPage() {
  const { user } = useSession();
  if (!user) return null;
  if (user.role === 'ADMIN') return <AdminHome />;
  if (user.role === 'TEACHER') return <TeacherHome />;
  return <ParentHome />;
}

function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

/* ------------------------------------------------------------------ ADMIN */

function AdminHome() {
  const { user } = useSession();
  const { data, error, loading, reload } = useApiQuery<AdminDashboard>('/dashboard/admin');

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={() => reload()} />;
  if (!data) return null;

  const { counts, academicContext, assessmentOverview, timetableStatus, setupWarnings = [], recentActivity = [] } = data;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Welcome, ${user?.fullName.split(' ')[0] ?? 'Administrator'}`}
        description={
          academicContext
            ? `${user?.schoolName} · ${academicContext.academicYearName ?? ''} ${academicContext.termName ?? ''}${
                academicContext.termEndsOn ? ` · term ends ${formatDate(academicContext.termEndsOn)}` : ''
              }`
            : user?.schoolName
        }
        actions={
          <>
            <Link href="/reports" className={buttonClass('outline', 'sm')}>
              <ClipboardCheck className="h-4 w-4" aria-hidden /> School report
            </Link>
            <Link href="/timetable" className={buttonClass('primary', 'sm')}>
              <CalendarClock className="h-4 w-4" aria-hidden /> Timetable workspace
            </Link>
          </>
        }
      />

      <HeroPanel
        eyebrow="School summary"
        title={user?.schoolName ?? 'Your school'}
        subtitle={
          academicContext
            ? `${academicContext.academicYearName ?? 'Academic year'} · ${academicContext.termName ?? 'current term'}${
                academicContext.termEndsOn ? ` · term ends ${formatDate(academicContext.termEndsOn)}` : ''
              }`
            : 'Set up the academic year and term to unlock the full workflow.'
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HeroMetric label="Learners" value={counts.learners} hint={`${counts.classes} classes`} />
          <HeroMetric
            label="Results published"
            value={assessmentOverview?.published ?? 0}
            hint={`${assessmentOverview?.missingResults ?? 0} assessments still missing results`}
          />
          <HeroMetric
            label="Timetable"
            value={timetableStatus?.published ? 'Published' : timetableStatus?.timetables ? 'Draft' : 'Not started'}
            hint={`${timetableStatus?.openConflicts ?? 0} open conflicts`}
          />
          <HeroMetric label="Teaching staff" value={counts.teachers} hint={`${counts.parents} linked guardians`} />
        </div>
      </HeroPanel>

      {setupWarnings.length > 0 ? (
        <Card className="border-amber-200">
          <CardHeader
            title={
              <span className="flex items-center gap-2 text-amber-900">
                <ShieldAlert className="h-4 w-4" aria-hidden /> Configuration needs attention
              </span>
            }
            description="These items block parts of the workflow until they are fixed."
          />
          <CardBody className="space-y-2">
            {setupWarnings.map((warning) => (
              <div key={warning.code} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span>{warning.message}</span>
                {warning.link ? (
                  <Link href={warning.link} className="text-xs font-semibold text-amber-900 underline">
                    Open
                  </Link>
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Learners" value={counts.learners} hint={`${counts.classes} classes · Grades 7–9`} icon={<Users className="h-5 w-5" aria-hidden />} />
        <StatCard label="Teaching staff" value={counts.teachers} hint={`${counts.parents} linked parents/guardians`} icon={<GraduationCap className="h-5 w-5" aria-hidden />} />
        <StatCard label="Assessments" value={counts.assessments} hint={`${assessmentOverview?.published ?? 0} published · ${assessmentOverview?.draft ?? 0} draft`} icon={<ClipboardCheck className="h-5 w-5" aria-hidden />} />
        <StatCard
          label="Timetable"
          value={timetableStatus?.published ? 'Published' : timetableStatus?.timetables ? 'Draft only' : 'Not started'}
          hint={`${timetableStatus?.openConflicts ?? 0} open conflicts · ${timetableStatus?.versions ?? 0} versions`}
          tone={timetableStatus?.openConflicts ? 'warning' : 'success'}
          icon={<CalendarClock className="h-5 w-5" aria-hidden />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Results awaiting entry"
            description="Assessments where learners still have no recorded outcome."
            actions={
              <Link href="/academics/classes" className="text-xs font-semibold text-royal hover:underline">
                Manage classes
              </Link>
            }
          />
          <CardBody className="space-y-3">
            {(assessmentOverview?.awaitingResults?.length ?? 0) === 0 ? (
              <EmptyState title="Nothing outstanding" description="Every assessment currently has its results entered." />
            ) : (
              assessmentOverview?.awaitingResults.slice(0, 6).map((item) => (
                <div key={item.id} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{item.title}</p>
                      <p className="text-xs text-slate-500">
                        {item.className} · {item.learningAreaName}
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">
                      {item.entered}/{item.expected} entered
                    </span>
                  </div>
                  <ProgressBar value={item.expected ? (item.entered / item.expected) * 100 : 0} tone={item.entered === 0 ? 'danger' : 'warning'} />
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Assessment status" description="School-wide pipeline" />
          <CardBody className="space-y-3 text-sm">
            <PipelineRow label="Draft" value={assessmentOverview?.draft ?? 0} tone="neutral" />
            <PipelineRow label="Ready for review" value={assessmentOverview?.readyForReview ?? 0} tone="warning" />
            <PipelineRow label="Published" value={assessmentOverview?.published ?? 0} tone="success" />
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500">Missing result entries</p>
              <p className="text-lg font-semibold text-slate-900">{assessmentOverview?.missingResults ?? 0}</p>
            </div>
            <PipelineRow label="Learning resources" value={counts.resources} tone="info" />
            <PipelineRow label="Learning areas" value={counts.learningAreas} tone="info" />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent activity"
          description="Audited actions across the school (no learner data in log summaries)."
          actions={
            <Link href="/audit" className="text-xs font-semibold text-royal hover:underline">
              Full audit log
            </Link>
          }
        />
        <CardBody>
          {recentActivity.length === 0 ? (
            <EmptyState title="No activity recorded yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentActivity.slice(0, 8).map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium text-slate-800">{entry.summary || entry.action}</span>
                    <span className="ml-2 text-xs text-slate-500">{entry.action}</span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {entry.actorName ? `${entry.actorName} · ` : ''}
                    {formatRelative(entry.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function PipelineRow({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'success' | 'warning' | 'info' }) {
  const dot = { neutral: 'bg-slate-400', success: 'bg-success', warning: 'bg-amber-500', info: 'bg-info' }[tone];
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-slate-600">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- TEACHER */

function TeacherHome() {
  const { user } = useSession();
  const { data, error, loading, reload } = useApiQuery<TeacherDashboard>('/dashboard/teacher');

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={() => reload()} />;
  if (!data) return null;

  const today = data.today?.lessons ?? [];
  const load = data.weeklyLoad;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Good to see you, ${user?.fullName.split(' ')[0] ?? 'teacher'}`}
        description={`${user?.schoolName} · your teaching week at a glance`}
        actions={
          <Link href="/teaching/assessments" className={buttonClass('primary', 'sm')}>
            <ClipboardCheck className="h-4 w-4" aria-hidden /> New assessment
          </Link>
        }
      />

      <HeroPanel eyebrow={dayName(data.today?.dayOfWeek ?? 1)} title={data.today?.lessons?.length ? 'Your teaching day' : 'No lessons scheduled today'} subtitle="Teaching load and assessment pipeline for the current week.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HeroMetric label="Lessons today" value={today.length} />
          <HeroMetric label="Weekly periods" value={load?.totalPeriods ?? 0} hint={load?.maxPeriodsPerWeek ? `of ${load.maxPeriodsPerWeek} allowed` : undefined} />
          <HeroMetric label="Classes" value={data.classes?.length ?? 0} hint={`${data.learningAreas?.length ?? 0} learning areas`} />
          <HeroMetric
            label="To finish"
            value={(data.assessments?.inProgress ?? 0) + (data.assessments?.awaitingPublication ?? 0)}
            hint={`${data.assessments?.draftsWithMissingResults ?? 0} missing results`}
          />
        </div>
      </HeroPanel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Today's lessons" value={today.length} hint={dayName(data.today?.dayOfWeek ?? 1)} icon={<CalendarClock className="h-5 w-5" aria-hidden />} />
        <StatCard
          label="Weekly periods"
          value={load?.totalPeriods ?? 0}
          hint={load?.maxPeriodsPerWeek ? `of ${load.maxPeriodsPerWeek} allowed` : 'limit not set'}
          tone={load?.maxPeriodsPerWeek && (load?.totalPeriods ?? 0) > load.maxPeriodsPerWeek ? 'warning' : 'neutral'}
          icon={<ListChecks className="h-5 w-5" aria-hidden />}
        />
        <StatCard label="My classes" value={data.classes?.length ?? 0} hint={`${data.learningAreas?.length ?? 0} learning areas`} icon={<BookOpen className="h-5 w-5" aria-hidden />} />
        <StatCard
          label="Assessments to finish"
          value={(data.assessments?.inProgress ?? 0) + (data.assessments?.awaitingPublication ?? 0)}
          hint={`${data.assessments?.draftsWithMissingResults ?? 0} missing results`}
          tone={data.assessments?.draftsWithMissingResults ? 'warning' : 'neutral'}
          icon={<ClipboardCheck className="h-5 w-5" aria-hidden />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Today's timetable"
            description={dayName(data.today?.dayOfWeek ?? 1)}
            actions={
              <Link href="/teaching/timetable" className="text-xs font-semibold text-royal hover:underline">
                Full week
              </Link>
            }
          />
          <CardBody className="space-y-2">
            {today.length === 0 ? (
              <EmptyState title="No lessons today" description="Either it is a non-teaching day, or the timetable is not published yet." />
            ) : (
              today.map((lesson, index) => (
                <div key={`${lesson.sequence}-${index}`} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <span className="w-20 shrink-0 text-xs font-semibold text-slate-600">
                    {lesson.startTime}
                    <br />
                    {lesson.endTime}
                  </span>
                  <span className="h-8 w-1 rounded-full" style={{ backgroundColor: lesson.learningAreaColor || FALLBACK_COLORS[0] }} aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{lesson.learningAreaName}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {lesson.className}
                      {lesson.roomName ? ` · ${lesson.roomName}` : ''}
                    </span>
                  </span>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent assessments"
            actions={
              <Link href="/teaching/assessments" className="text-xs font-semibold text-royal hover:underline">
                All assessments
              </Link>
            }
          />
          <CardBody className="space-y-2">
            {(data.assessments?.recent?.length ?? 0) === 0 ? (
              <EmptyState title="No assessments yet" description="Create one to start recording outcomes against strands." />
            ) : (
              data.assessments?.recent.map((assessment) => (
                <Link
                  key={assessment.id}
                  href={`/teaching/assessments/${assessment.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{assessment.title}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {assessment.className} · {assessment.learningAreaName} · {formatDate(assessment.assessmentDate)}
                    </span>
                  </span>
                  <StatusBadge status={assessment.status} />
                </Link>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="My classes" actions={<Link href="/teaching/classes" className="text-xs font-semibold text-royal hover:underline">Open class lists</Link>} />
        <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(data.classes ?? []).map((klass) => (
            <div key={klass.id} className="rounded-lg border border-slate-100 px-3 py-2">
              <p className="text-sm font-medium text-slate-800">{klass.name}</p>
              <p className="text-xs text-slate-500">
                {klass.gradeName} · {klass.learnerCount ?? 0} learners
              </p>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- PARENT */

function ParentHome() {
  const { user } = useSession();
  const [learnerId, setLearnerId] = useState<string | null>(null);

  // Two reads of the same endpoint, deliberately:
  //  - the list read always runs, so the learner switcher never disappears while
  //    the selected child's details load (and it survives a failed details call);
  //  - the details read only runs for a *verified* link. The API refuses an
  //    unverified one — which is correct — so asking for it would turn a normal
  //    "waiting for the office" state into a broken screen.
  const list = useApiQuery<ParentDashboard>('/dashboard/parent');
  const learners = list.data?.learners ?? [];
  const requested = learners.find((learner) => learner.id === learnerId);
  const detail = useApiQuery<ParentDashboard>('/dashboard/parent', {
    query: requested?.isVerified ? { learnerId: requested.id } : undefined,
    enabled: Boolean(requested?.isVerified),
  });

  const data = detail.data ?? list.data;
  const error = detail.data ? null : detail.error ?? list.error;
  const reload = () => {
    void detail.reload();
    void list.reload();
  };

  if (!data) {
    if (list.loading) return <Loading />;
    if (error) return <ErrorState message={error} onRetry={reload} />;
    return null;
  }

  const selected = data.learners.find((learner) => learner.id === (learnerId ?? data.selectedLearnerId)) ?? data.learners[0];
  // Never show one child's records while another child is selected: an unverified
  // link shows the explanation card only.
  const showRecords = Boolean(selected?.isVerified);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Hello, ${user?.fullName.split(' ')[0] ?? 'guardian'}`}
        description={data.academicContext ? `${data.academicContext.academicYearName} · ${data.academicContext.termName}` : 'Your child’s learning at a glance'}
      />

      {data.learners.length === 0 ? (
        <EmptyState
          title="No learner is linked to your account yet"
          description="Ask the school office to link your child and verify the link. Once verified, results, resources and the class timetable appear here."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {data.learners.map((learner) => {
              const active = learner.id === selected?.id;
              return (
                <button
                  key={learner.id}
                  type="button"
                  onClick={() => setLearnerId(learner.id)}
                  aria-pressed={active}
                  className={`surface-interactive rounded-lg border px-3 py-2 text-left ${
                    active ? 'border-royal bg-navy-100 shadow-sm' : 'border-line bg-surface hover:border-navy-300'
                  }`}
                >
                  <span className="block text-sm font-semibold text-slate-800">{learner.fullName}</span>
                  <span className="block text-xs text-slate-500">
                    {learner.gradeName} · {learner.className}
                  </span>
                  <span className="mt-1 block text-[11px] text-slate-500">
                    {learner.relationship} · {learner.isVerified ? 'verified link' : 'awaiting verification'}
                  </span>
                </button>
              );
            })}
          </div>

          {selected ? (
            <HeroPanel
              eyebrow="Your child"
              title={selected.fullName}
              subtitle={`${selected.gradeName} · ${selected.className} · ${selected.relationship} · ${
                selected.isVerified ? 'verified by the school office' : 'link awaiting verification'
              }`}
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <HeroMetric label="Published results" value={data.latestResults?.length ?? 0} />
                <HeroMetric label="Assignments due" value={data.upcomingAssignments?.length ?? 0} />
                <HeroMetric label="Shared resources" value={data.recentResources?.length ?? 0} />
              </div>
            </HeroPanel>
          ) : null}

          {selected && !selected.isVerified ? (
            <Card className="border-amber-200">
              <CardBody className="text-sm text-amber-900">
                This link is not verified yet, so results are hidden. The school office verifies guardian links before results are released.
              </CardBody>
            </Card>
          ) : null}

          {showRecords ? (
            <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Latest published results"
                description="Only published, school-internal assessment records are shown."
                actions={
                  <Link href="/family/results" className="text-xs font-semibold text-royal hover:underline">
                    All results &amp; progress
                  </Link>
                }
              />
              <CardBody className="space-y-2">
                {(data.latestResults?.length ?? 0) === 0 ? (
                  <EmptyState title="No published results yet" description="Results appear here as soon as the teacher publishes them." />
                ) : (
                  data.latestResults?.slice(0, 6).map((result) => (
                    <div key={result.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{result.assessmentTitle}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {result.learningAreaName} · {result.categoryName}{result.publishedAt ? ` · published ${formatDate(result.publishedAt)}` : ''}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold text-slate-900">{result.scoreLabel}</span>
                        {result.achievementLabel ? <span className="block text-xs text-slate-500">{result.achievementLabel}</span> : null}
                      </span>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Progress by learning area" description="School-defined bands, not national grades." />
              <CardBody className="space-y-4">
                {(data.progress?.length ?? 0) === 0 ? (
                  <p className="text-sm text-slate-500">Progress appears once a few assessments have been published.</p>
                ) : (
                  data.progress?.map((area) => {
                    const points = area.points.filter((point) => point.percent !== null);
                    const average = points.length ? points.reduce((sum, point) => sum + (point.percent ?? 0), 0) / points.length : null;
                    return (
                      <div key={area.learningAreaName}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-700">{area.learningAreaName}</span>
                          <span className="text-slate-500">{average === null ? '—' : formatPercent(average)}</span>
                        </div>
                        <ProgressBar value={average ?? 0} tone={(average ?? 0) >= 50 ? 'success' : 'warning'} />
                        <p className="mt-1 text-[11px] text-slate-400">{points.length} published assessment{points.length === 1 ? '' : 's'}</p>
                      </div>
                    );
                  })
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Assignments"
                actions={
                  <Link href="/family/assignments" className="text-xs font-semibold text-royal hover:underline">
                    Open
                  </Link>
                }
              />
              <CardBody className="space-y-2">
                {(data.upcomingAssignments?.length ?? 0) === 0 ? (
                  <EmptyState title="No assignments set" />
                ) : (
                  data.upcomingAssignments?.slice(0, 4).map((assignment) => (
                    <div key={assignment.id} className="rounded-lg border border-slate-100 px-3 py-2">
                      <p className="text-sm font-medium text-slate-800">{assignment.title}</p>
                      <p className="text-xs text-slate-500">
                        {assignment.learningAreaName} · due {formatDate(assignment.dueDate)}
                      </p>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Class resources"
                actions={
                  <Link href="/family/resources" className="text-xs font-semibold text-royal hover:underline">
                    Library
                  </Link>
                }
              />
              <CardBody className="space-y-2">
                {(data.recentResources?.length ?? 0) === 0 ? (
                  <EmptyState title="No shared resources yet" />
                ) : (
                  data.recentResources?.slice(0, 4).map((resource) => (
                    <div key={resource.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                      <Library className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-slate-800">{resource.title}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {resource.learningAreaName} · {formatDate(resource.publishedAt ?? resource.createdAt)}
                        </span>
                      </span>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          </div>
            </>
          ) : null}

        </>
      )}
    </div>
  );
}
