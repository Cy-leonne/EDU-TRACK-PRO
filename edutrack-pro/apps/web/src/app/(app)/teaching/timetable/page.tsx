'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Info } from 'lucide-react';
import { useApiQuery } from '@/lib/hooks';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Note, PageHeader, Select, Skeleton, StatCard, Table, Td, Th } from '@/components/ui';
import { TimetableGrid } from '@/components/timetable-grid';
import { formatDate } from '@/lib/utils';
import type { TimetableLesson, TimetablePeriod } from '@/lib/types';

interface TeacherEntry extends TimetableLesson {
  periodId: string;
}

interface MyTimetable {
  teacher?: { id: string; fullName: string; staffNumber?: string | null };
  version?: { id: string; versionNumber: number; status: string; publishedAt?: string | null } | null;
  periods: Array<{ id: string; dayOfWeek: number; sequence: number; label: string; startTime: string; endTime: string; isBreak: boolean; isLunch: boolean }>;
  entries: Array<{
    id: string;
    dayOfWeek: number;
    periodId: string;
    sequence: number;
    className?: string;
    classId?: string;
    learningAreaName?: string;
    roomName?: string;
    isLocked?: boolean;
  }>;
  summary?: { weeklyLessons?: number; classCount?: number; freePeriods?: number; maxPeriodsPerWeek?: number | null };
  message?: string;
}

export default function TeacherTimetablePage() {
  const mine = useApiQuery<MyTimetable>('/timetables/me');
  const [classId, setClassId] = useState('');

  const entries: TeacherEntry[] = useMemo(
    () =>
      (mine.data?.entries ?? []).map((entry) => ({
        entryId: entry.id,
        id: entry.id,
        dayOfWeek: entry.dayOfWeek,
        periodId: entry.periodId,
        sequence: entry.sequence,
        className: entry.className ?? '—',
        learningAreaName: entry.learningAreaName ?? '—',
        teacherName: mine.data?.teacher?.fullName,
        roomName: entry.roomName,
        isLocked: entry.isLocked,
      })),
    [mine.data],
  );

  const classOptions = useMemo(() => {
    const map = new Map<string, { id: string; className: string; entries: TeacherEntry[] }>();
    for (const entry of entries) {
      const key = entry.className ?? '—';
      const existing = map.get(key);
      if (existing) existing.entries.push(entry);
      else map.set(key, { id: key, className: key, entries: [entry] });
    }
    return Array.from(map.values());
  }, [entries]);

  const filtered = useMemo(() => (classId ? entries.filter((entry) => entry.className === classId) : entries), [classId, entries]);

  const byDay = useMemo(() => {
    const counts = new Map<number, number>();
    for (const entry of filtered) counts.set(entry.dayOfWeek, (counts.get(entry.dayOfWeek) ?? 0) + 1);
    return counts;
  }, [filtered]);

  const published = mine.data?.version?.status === 'PUBLISHED';

  return (
    <div className="space-y-4">
      <PageHeader
        title="My timetable"
        description="Your published teaching timetable. Only administrators can change it."
      />

      {mine.loading ? (
        <Skeleton className="h-96" />
      ) : mine.error ? (
        <ErrorState message={mine.error} onRetry={() => mine.reload()} />
      ) : !mine.data?.version ? (
        <EmptyState
          title="No published timetable yet"
          description={mine.data?.message ?? 'The school office has not published a timetable for the current term.'}
          icon={<CalendarDays className="h-6 w-6" aria-hidden />}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Weekly lessons" value={mine.data.summary?.weeklyLessons ?? entries.length} />
            <StatCard label="Classes taught" value={mine.data.summary?.classCount ?? classOptions.length} />
            <StatCard label="Free teaching slots" value={mine.data.summary?.freePeriods ?? '—'} hint="Gaps you can use for preparation" />
            <StatCard
              label="Workload limit"
              value={mine.data.summary?.maxPeriodsPerWeek ?? '—'}
              tone={
                mine.data.summary?.maxPeriodsPerWeek && (mine.data.summary.weeklyLessons ?? 0) > mine.data.summary.maxPeriodsPerWeek ? 'danger' : 'neutral'
              }
            />
          </div>

          <Card>
            <CardHeader
              title="Weekly view"
              description={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={published ? 'success' : 'warning'}>{mine.data.version.status.toLowerCase()}</Badge>
                  <span>
                    Version {mine.data.version.versionNumber}
                    {mine.data.version.publishedAt ? ` · published ${formatDate(mine.data.version.publishedAt)}` : ''}
                  </span>
                </span>
              }
              actions={
                <>
                          <Select className="w-full sm:w-48" value={classId} onChange={(event) => setClassId(event.target.value)} aria-label="Filter by class">
                    <option value="">All my classes</option>
                    {classOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.className}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => mine.reload()}>
                    Refresh
                  </Button>
                </>
              }
            />
            <CardBody className="space-y-4">
              <TimetableGrid
                periods={(mine.data.periods ?? []) as TimetablePeriod[]}
                lessons={filtered}
                workingDays={Array.from(new Set((mine.data.periods ?? []).map((period) => period.dayOfWeek))).sort((a, b) => a - b)}
              />
              <div className="grid gap-2 sm:grid-cols-5">
                {[1, 2, 3, 4, 5].map((day) => (
                  <div key={day} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
                    <span className="block font-medium text-slate-700">{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][day - 1]}</span>
                    <span className="text-slate-500">{byDay.get(day) ?? 0} lesson(s)</span>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Lesson list" description="The same timetable as a simple list — useful on a phone." />
            <CardBody>
              <Table>
                <thead>
                  <tr>
                    <Th>Day</Th>
                    <Th>Period</Th>
                    <Th>Time</Th>
                    <Th>Class</Th>
                    <Th>Learning area</Th>
                    <Th>Room</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...filtered]
                    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.sequence - b.sequence)
                    .map((entry) => {
                      const period = mine.data?.periods.find((item) => item.id === entry.periodId);
                      return (
                        <tr key={entry.entryId} className="hover:bg-slate-50">
                          <Td className="text-sm text-slate-700">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][entry.dayOfWeek - 1]}</Td>
                          <Td className="text-xs text-slate-600">{period?.label ?? `Period ${entry.sequence}`}</Td>
                          <Td className="text-xs text-slate-500">
                            {period ? `${period.startTime}–${period.endTime}` : '—'}
                          </Td>
                          <Td className="text-sm text-slate-700">{entry.className}</Td>
                          <Td className="text-sm text-slate-700">{entry.learningAreaName}</Td>
                          <Td className="text-xs text-slate-500">{entry.roomName ?? '—'}</Td>
                        </tr>
                      );
                    })}
                </tbody>
              </Table>
            </CardBody>
          </Card>

          <Note tone="info" title="Need a change?">
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5" aria-hidden />
              Ask the school office. Timetables are versioned: a change produces a new version that is re-validated against conflicts before it is published, and
              your previous version stays in the history.
            </p>
          </Note>
        </>
      )}
    </div>
  );
}
