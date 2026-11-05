'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Users } from 'lucide-react';
import { useApiQuery } from '@/lib/hooks';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  KeyValue,
  Note,
  PageHeader,
  ProgressBar,
  Skeleton,
  StatCard,
  Table,
  Td,
  Th,
} from '@/components/ui';
import type { Assessment } from '@/lib/types';

interface TeacherContext {
  profile?: { staffNumber?: string | null; employmentType?: string | null; maxPeriodsPerWeek?: number | null; subjectsSpecialisation?: string[] };
  classes: Array<{
    id: string;
    name: string;
    gradeName?: string;
    learnerCount?: number;
    learningAreas?: Array<{ id: string; name: string }>;
    isClassTeacher?: boolean;
  }>;
  learningAreas: Array<{ id: string; name: string }>;
  assignments?: Array<{ id: string; classId: string; className?: string; learningAreaId: string; learningAreaName?: string; lessonsPerWeek?: number }>;
  timetable?: { today?: Array<{ id: string; periodLabel?: string; startTime?: string; endTime?: string; className?: string; learningAreaName?: string; roomName?: string }> };
  summary?: { totalLearners?: number; classCount?: number; weeklyPeriods?: number; maxPeriodsPerWeek?: number };
}

export default function TeachingClassesPage() {
  const context = useApiQuery<TeacherContext>('/dashboard/teacher');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const classes = context.data?.classes ?? [];
  const assignments = context.data?.assignments ?? [];
  const selected = classes.find((klass) => klass.id === selectedId) ?? classes[0];
  const assessments = useApiQuery<Assessment[]>(selected ? '/assessments' : null, {
    query: selected ? { classId: selected.id, pageSize: 50 } : undefined,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="My classes"
        description="The classes you teach, what you teach in each, and the learners on roll."
        actions={
          <Link href="/teaching/timetable" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <CalendarDays className="h-4 w-4" aria-hidden /> My timetable
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Classes taught" value={context.data?.summary?.classCount ?? classes.length} />
        <StatCard label="Learners in my classes" value={context.data?.summary?.totalLearners ?? classes.reduce((sum, klass) => sum + (klass.learnerCount ?? 0), 0)} />
        <StatCard
          label="Weekly periods allocated"
          value={context.data?.summary?.weeklyPeriods ?? '—'}
          hint={context.data?.summary?.maxPeriodsPerWeek ? `Limit ${context.data.summary.maxPeriodsPerWeek}` : undefined}
        />
        <StatCard label="Learning areas" value={context.data?.learningAreas?.length ?? 0} />
      </div>

      {context.data?.profile?.maxPeriodsPerWeek && context.data?.summary?.weeklyPeriods ? (
        <ProgressBar
          value={Math.round(((context.data.summary.weeklyPeriods ?? 0) / context.data.profile.maxPeriodsPerWeek) * 100)}
          label={`Workload ${context.data.summary.weeklyPeriods} of ${context.data.profile.maxPeriodsPerWeek} periods per week`}
          tone={context.data.summary.weeklyPeriods > context.data.profile.maxPeriodsPerWeek ? 'danger' : 'brand'}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Class list" description="Select a class to see its details and assessments." />
          <CardBody>
            {context.loading ? (
              <Skeleton className="h-40" />
            ) : context.error ? (
              <ErrorState message={context.error} onRetry={() => context.reload()} />
            ) : classes.length === 0 ? (
              <EmptyState title="No classes yet" description="An administrator assigns you to classes and learning areas." icon={<Users className="h-6 w-6" aria-hidden />} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Class</Th>
                    <Th>Grade</Th>
                    <Th>Learners</Th>
                    <Th>What I teach</Th>
                    <Th aria-label="Select" />
                  </tr>
                </thead>
                <tbody>
                  {classes.map((klass) => {
                    const mine = assignments.filter((assignment) => assignment.classId === klass.id);
                    return (
                      <tr key={klass.id} className={`cursor-pointer hover:bg-slate-50 ${selected?.id === klass.id ? 'bg-brand-soft/60' : ''}`} onClick={() => setSelectedId(klass.id)}>
                        <Td>
                          <span className="font-medium text-slate-800">{klass.name}</span>
                          {klass.isClassTeacher ? <Badge tone="info" className="ml-2">class teacher</Badge> : null}
                        </Td>
                        <Td className="text-xs text-slate-600">{klass.gradeName ?? '—'}</Td>
                        <Td className="text-sm text-slate-700">{klass.learnerCount ?? '—'}</Td>
                        <Td>
                          <span className="flex flex-wrap gap-1">
                            {mine.length === 0 ? (
                              <span className="text-xs text-slate-400">No learning area assigned</span>
                            ) : (
                              mine.map((assignment) => (
                                <Badge key={assignment.id} tone="neutral">
                                  {assignment.learningAreaName ?? 'Learning area'}
                                  {assignment.lessonsPerWeek ? ` · ${assignment.lessonsPerWeek}/wk` : ''}
                                </Badge>
                              ))
                            )}
                          </span>
                        </Td>
                        <Td>
                          <div className="flex justify-end">
                            <Button variant="ghost" size="sm">
                              View
                            </Button>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={selected ? selected.name : 'Class details'} description={selected ? selected.gradeName : undefined} />
          <CardBody className="space-y-4">
            {!selected ? (
              <p className="text-sm text-slate-500">Select a class from the list.</p>
            ) : (
              <>
                <KeyValue
                  columns={1}
                  items={[
                    { label: 'Learners on roll', value: selected.learnerCount ?? '—' },
                    { label: 'Class teacher', value: selected.isClassTeacher ? 'You' : 'Another teacher' },
                    { label: 'Learning areas I teach here', value: assignments.filter((assignment) => assignment.classId === selected.id).map((assignment) => assignment.learningAreaName).join(', ') || '—' },
                  ]}
                />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent assessments</p>
                  {assessments.loading ? (
                    <Skeleton className="mt-2 h-20" />
                  ) : (assessments.data ?? []).length === 0 ? (
                    <p className="mt-1 text-xs text-slate-500">No assessments recorded for this class yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {assessments.data?.slice(0, 6).map((assessment) => (
                        <li key={assessment.id}>
                          <Link href={`/teaching/assessments/${assessment.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs hover:bg-slate-50">
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-slate-700">{assessment.title}</span>
                              <span className="block truncate text-slate-400">{assessment.learningAreaName}</span>
                            </span>
                            <Badge tone={assessment.status === 'PUBLISHED' ? 'success' : 'neutral'}>{assessment.status.replace(/_/g, ' ').toLowerCase()}</Badge>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <Note tone="info" title="Learner records">
        <p>
          Learner personal data is limited to what you need for teaching: name, admission number and class. Assessment numbers and guardian details are held by
          the office, not shown on this screen.
        </p>
      </Note>
    </div>
  );
}
