'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Info, Printer } from 'lucide-react';
import { useApiQuery } from '@/lib/hooks';
import { useFamily } from '@/lib/family';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Note, PageHeader, Skeleton, StatCard, Table, Td, Th } from '@/components/ui';
import { TimetableGrid } from '@/components/timetable-grid';
import { dayName, dayShort, formatDate, todayDayOfWeek } from '@/lib/utils';
import type { TimetableLesson, TimetablePeriod } from '@/lib/types';

interface LearnerTimetable {
  published: boolean;
  versionId?: string;
  versionNumber?: number;
  publishedAt?: string | null;
  className?: string;
  classId?: string;
  periods: TimetablePeriod[];
  lessons: TimetableLesson[];
  message?: string;
}

/**
 * A learner's class timetable.
 *
 * Only a published version is ever returned for a guardian — drafts and
 * validated-but-unpublished grids stay in the office. Guardians cannot edit:
 * timetable changes are an administrative action.
 */
export default function FamilyTimetablePage() {
  const family = useFamily();
  const learnerId = family.learnerId;
  const [dayFilter, setDayFilter] = useState<number | null>(null);

  const timetable = useApiQuery<LearnerTimetable>(learnerId ? `/timetables/learner/${learnerId}` : null);

  const lessons = useMemo(() => timetable.data?.lessons ?? [], [timetable.data]);
  const periods = useMemo(() => timetable.data?.periods ?? [], [timetable.data]);
  const workingDays = useMemo(() => Array.from(new Set(periods.map((period) => period.dayOfWeek))).sort((a, b) => a - b), [periods]);

  const today = todayDayOfWeek();
  const todaysLessons = useMemo(
    () => lessons.filter((lesson) => lesson.dayOfWeek === today).sort((a, b) => a.sequence - b.sequence),
    [lessons, today],
  );

  const shown = dayFilter ? lessons.filter((lesson) => lesson.dayOfWeek === dayFilter) : lessons;

  const perLearningArea = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lesson of lessons) counts.set(lesson.learningAreaName, (counts.get(lesson.learningAreaName) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [lessons]);

  const subjectDays = useMemo(() => {
    const seen = new Map<string, Set<number>>();
    for (const lesson of lessons) {
      const set = seen.get(lesson.learningAreaName) ?? new Set<number>();
      set.add(lesson.dayOfWeek);
      seen.set(lesson.learningAreaName, set);
    }
    return seen;
  }, [lessons]);

  const print = () => window.print();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Class timetable"
        description={timetable.data?.className ? `${timetable.data.className} · published timetable` : 'The published timetable for this class.'}
        actions={
          <Button size="sm" variant="outline" onClick={print}>
            <Printer className="h-4 w-4" aria-hidden /> Print
          </Button>
        }
      />

      {timetable.loading ? (
        <Skeleton className="h-96" />
      ) : timetable.error ? (
        <ErrorState message={timetable.error} onRetry={() => timetable.reload()} />
      ) : !timetable.data?.published ? (
        <EmptyState
          title="No published timetable yet"
          description={timetable.data?.message ?? 'The school office publishes the timetable for the term. It will appear here once published.'}
          icon={<CalendarDays className="h-6 w-6" aria-hidden />}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Lessons per week" value={lessons.length} />
            <StatCard label="Learning areas" value={perLearningArea.length} />
            <StatCard label="Lessons today" value={todaysLessons.length} hint={dayName(today)} />
            <StatCard label="Version" value={timetable.data.versionNumber ?? '—'} hint={timetable.data.publishedAt ? `published ${formatDate(timetable.data.publishedAt)}` : undefined} />
          </div>

          <Card className="print:shadow-none">
            <CardHeader
              title="Weekly timetable"
              description="Colour shows the learning area. Breaks and lunch are shown for context."
              actions={
                <>
                  <Button size="sm" variant={dayFilter === null ? 'secondary' : 'outline'} onClick={() => setDayFilter(null)}>
                    Whole week
                  </Button>
                  {workingDays.map((day) => (
                    <Button key={day} size="sm" variant={dayFilter === day ? 'secondary' : 'outline'} onClick={() => setDayFilter(day)}>
                      {dayShort(day)}
                    </Button>
                  ))}
                </>
              }
            />
            <CardBody>
              <TimetableGrid periods={periods} lessons={dayFilter ? shown : lessons} workingDays={dayFilter ? [dayFilter] : workingDays} showClass={false} />
              <div className="mt-3 flex flex-wrap gap-3">
                {perLearningArea.map(([name, count]) => (
                  <span key={name} className="text-xs text-slate-600">
                    <Badge tone="neutral">
                      {name} · {count}/wk on {subjectDays.get(name)?.size ?? 0} day(s)
                    </Badge>
                  </span>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Today — ${dayName(today)}`} description="The lessons scheduled for today, in order." />
            <CardBody>
              {todaysLessons.length === 0 ? (
                <EmptyState title="No lessons scheduled today" description="It may be a weekend, a holiday, or a day without lessons for this class." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {todaysLessons.map((lesson) => (
                    <li key={`${lesson.dayOfWeek}-${lesson.sequence}-${lesson.learningAreaName}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="flex items-center gap-3">
                        <span className="w-24 text-xs text-slate-500">
                          {lesson.startTime}–{lesson.endTime}
                        </span>
                        <span className="text-sm font-medium text-slate-800">{lesson.learningAreaName}</span>
                      </span>
                      <span className="text-xs text-slate-500">
                        {lesson.teacherName ?? 'Teacher to be assigned'}
                        {lesson.roomName ? ` · ${lesson.roomName}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card className="print:hidden">
            <CardHeader title="Lesson list" description="Useful on a phone or for printing." />
            <CardBody>
              <Table>
                <thead>
                  <tr>
                    <Th>Day</Th>
                    <Th>Time</Th>
                    <Th>Learning area</Th>
                    <Th>Teacher</Th>
                    <Th>Room</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...shown]
                    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.sequence - b.sequence)
                    .map((lesson) => (
                      <tr key={`${lesson.dayOfWeek}-${lesson.sequence}-${lesson.learningAreaName}`} className="hover:bg-slate-50">
                        <Td className="text-sm text-slate-700">{dayShort(lesson.dayOfWeek)}</Td>
                        <Td className="text-xs text-slate-600">
                          {lesson.startTime}–{lesson.endTime}
                          {lesson.periodLabel ? <span className="block text-[11px] text-slate-400">{lesson.periodLabel}</span> : null}
                        </Td>
                        <Td className="text-sm text-slate-700">{lesson.learningAreaName}</Td>
                        <Td className="text-xs text-slate-600">{lesson.teacherName ?? '—'}</Td>
                        <Td className="text-xs text-slate-500">{lesson.roomName ?? '—'}</Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>

          <Note tone="info" title="About this timetable">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5" aria-hidden />
              The grid is versioned. If the school changes a lesson, a new version is generated, checked for clashes and published — this page always shows the
              version currently in force.
            </p>
          </Note>
        </>
      )}
    </div>
  );
}
