'use client';

import { BRAND_DEFAULTS } from '@/lib/theme';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarOff, CheckCircle2, Plus, Trash2, UserCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/hooks';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Note,
  PageHeader,
  ProgressBar,
  Select,
  Skeleton,
  Table,
  Tabs,
  Td,
  Th,
  useToast,
} from '@/components/ui';
import { dayName, dayShort, titleCase } from '@/lib/utils';
import type { ClassSummary, CoverageReport, LearningArea, TeacherAssignment, TeacherSummary, TimetablePeriod } from '@/lib/types';

export default function AssignmentsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('assignments');
  const assignments = useApiQuery<TeacherAssignment[]>('/teacher-assignments', { query: { pageSize: 500 } });
  const coverage = useApiQuery<CoverageReport>('/teacher-assignments/coverage');
  const teachers = useApiQuery<TeacherSummary[]>('/teachers', { query: { pageSize: 200 } });
  const classes = useApiQuery<ClassSummary[]>('/classes', { query: { pageSize: 100 } });
  const areas = useApiQuery<LearningArea[]>('/learning-areas');

  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({ teacherId: '', classId: '', learningAreaId: '', isPrimary: true, lessonsPerWeek: '' });

  /* -------------------------------------------------------- availability */
  const periods = useApiQuery<TimetablePeriod[]>('/timetables/periods');
  const [availabilityTeacher, setAvailabilityTeacher] = useState<TeacherSummary | null>(null);
  const [blocked, setBlocked] = useState<Record<string, { dayOfWeek: number; periodIndex: number; reason?: string }>>({});
  // The endpoint returns the full grid with an isAvailable flag; only the
  // blocked slots are interesting here.
  const availability = useApiQuery<Array<{ dayOfWeek: number; periodIndex: number; isAvailable: boolean; reason?: string | null }>>(
    availabilityTeacher ? `/teacher-assignments/availability/${availabilityTeacher.id}` : null,
  );

  const teachingSlots = useMemo(() => {
    const map = new Map<number, TimetablePeriod>();
    for (const period of periods.data ?? []) {
      if (period.isTeaching && !period.isBreak && !period.isLunch && !map.has(period.sequence)) map.set(period.sequence, period);
    }
    return [...map.values()].sort((a, b) => a.sequence - b.sequence);
  }, [periods.data]);

  const list = useMemo(() => assignments.data ?? [], [assignments.data]);
  const grouped = useMemo(() => {
    const map = new Map<string, TeacherAssignment[]>();
    for (const item of list) {
      const key = item.classId;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()].map(([classId, items]) => ({ classId, className: items[0].className, items }));
  }, [list]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      await api.post('/teacher-assignments', {
        ...form,
        lessonsPerWeek: form.lessonsPerWeek ? Number(form.lessonsPerWeek) : null,
      });
      toast.success('Assignment created');
      setCreating(false);
      setForm({ teacherId: '', classId: '', learningAreaId: '', isPrimary: true, lessonsPerWeek: '' });
      await assignments.reload();
      await coverage.reload();
    } catch (caught) {
      toast.error('Could not create the assignment', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const remove = async (item: TeacherAssignment) => {
    if (!window.confirm(`Remove ${item.teacherName} from ${item.learningAreaName} for ${item.className}?`)) return;
    try {
      await api.del(`/teacher-assignments/${item.id}`);
      toast.success('Assignment removed');
      await assignments.reload();
      await coverage.reload();
    } catch (caught) {
      toast.error('Could not remove', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const openAvailability = async (teacher: TeacherSummary) => {
    setAvailabilityTeacher(teacher);
    setBlocked({});
    try {
      const existing = await api.get<Array<{ dayOfWeek: number; periodIndex: number; isAvailable: boolean; reason?: string | null }>>(
        `/teacher-assignments/availability/${teacher.id}`,
      );
      const map: Record<string, { dayOfWeek: number; periodIndex: number; reason?: string }> = {};
      for (const slot of existing ?? []) {
        if (slot.isAvailable) continue;
        map[`${slot.dayOfWeek}-${slot.periodIndex}`] = { dayOfWeek: slot.dayOfWeek, periodIndex: slot.periodIndex, reason: slot.reason ?? undefined };
      }
      setBlocked(map);
    } catch {
      setBlocked({});
    }
  };

  const saveAvailability = async () => {
    if (!availabilityTeacher) return;
    setPending(true);
    try {
      await api.post('/teacher-assignments/availability', {
        teacherId: availabilityTeacher.id,
        unavailable: Object.values(blocked).map((slot) => ({ dayOfWeek: slot.dayOfWeek, periodIndex: slot.periodIndex, reason: slot.reason ?? null })),
      });
      toast.success('Availability saved', `${Object.keys(blocked).length} slot(s) blocked for ${availabilityTeacher.fullName}.`);
      setAvailabilityTeacher(null);
      await coverage.reload();
      await teachers.reload();
    } catch (caught) {
      toast.error('Could not save availability', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const days = [1, 2, 3, 4, 5];
  const issues = coverage.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Teaching assignments"
        description="Who teaches each learning area to each class. The timetable engine refuses to schedule a lesson that has no valid assignment."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setTab('availability')}>
              <CalendarOff className="h-4 w-4" aria-hidden /> Teacher availability
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Assign teacher
            </Button>
          </>
        }
      />

      {issues ? (
        issues.isReady ? (
          <p className="flex items-center gap-2 text-sm text-success-strong">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Coverage looks complete: every required period has a teacher and no one is over their weekly limit.
          </p>
        ) : (
          <Note tone="warning" title="Coverage gaps will block timetable generation">
            <ul className="list-disc space-y-0.5 pl-4">
              {issues.missingTeacherAssignments?.length ? (
                <li>
                  {issues.missingTeacherAssignments.length} class/learning-area pair(s) have no teacher, e.g.{' '}
                  {issues.missingTeacherAssignments
                    .slice(0, 3)
                    .map((item) => `${item.learningAreaName} — ${item.className}`)
                    .join(', ')}
                </li>
              ) : null}
              {issues.classesWithoutRequirements?.length ? <li>{issues.classesWithoutRequirements.length} class(es) have no weekly period requirements.</li> : null}
              {issues.overloadedTeachers?.length ? (
                <li>
                  {issues.overloadedTeachers.length} teacher(s) are over their weekly limit:{' '}
                  {issues.overloadedTeachers.map((teacher) => `${teacher.teacherName} (${teacher.weeklyPeriods}/${teacher.maxPeriodsPerWeek})`).join(', ')}
                </li>
              ) : null}
              {issues.classesWithoutLearners?.length ? <li>{issues.classesWithoutLearners.length} class(es) have no learners enrolled.</li> : null}
            </ul>
          </Note>
        )
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'assignments', label: 'Assignments', badge: list.length || undefined },
          { id: 'coverage', label: 'Coverage & workload' },
          { id: 'availability', label: 'Availability' },
        ]}
      />

      {tab === 'assignments' ? (
        <Card>
          <CardHeader title="Assignments by class" description="Each class needs one teacher per learning area it studies." />
          <CardBody className="space-y-4">
            {assignments.loading ? (
              <Skeleton className="h-40" />
            ) : assignments.error ? (
              <ErrorState message={assignments.error} onRetry={() => assignments.reload()} />
            ) : grouped.length === 0 ? (
              <EmptyState
                title="No teaching assignments yet"
                description="Assign a teacher to each class and learning area before generating a timetable."
                icon={<UserCheck className="h-6 w-6" aria-hidden />}
              />
            ) : (
              grouped.map((group) => (
                <div key={group.classId} className="rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                    <p className="text-sm font-semibold text-slate-800">{group.className}</p>
                    <span className="text-xs text-slate-500">{group.items.length} assignment(s)</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {group.items.map((item) => (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span className="flex items-center gap-2 text-sm">
                          <span className="h-3 w-3 rounded" style={{ backgroundColor: item.learningAreaColor || BRAND_DEFAULTS.accent }} aria-hidden />
                          <span className="font-medium text-slate-700">{item.learningAreaName}</span>
                        </span>
                        <span className="flex items-center gap-2 text-sm text-slate-600">
                          {item.teacherName}
                          {item.isPrimary ? <Badge tone="info">primary</Badge> : null}
                          <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50" onClick={() => remove(item)} aria-label="Remove assignment">
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'coverage' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Teacher workload" description={`${issues?.totalRequiredPeriods ?? 0} required periods across ${issues?.classesChecked ?? 0} class(es).`} />
            <CardBody className="space-y-3">
              {(issues?.teacherWorkloads?.length ?? 0) === 0 ? (
                <EmptyState title="No workload data yet" />
              ) : (
                issues?.teacherWorkloads
                  .slice()
                  .sort((a, b) => b.weeklyPeriods - a.weeklyPeriods)
                  .map((teacher) => {
                    const max = teacher.maxPeriodsPerWeek ?? null;
                    const percent = max ? (teacher.weeklyPeriods / max) * 100 : 0;
                    return (
                      <div key={teacher.teacherId}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-700">
                            {teacher.teacherName} {teacher.staffNumber ? <span className="text-slate-400">· {teacher.staffNumber}</span> : null}
                          </span>
                          <span className={teacher.overLimit ? 'font-semibold text-rose-700' : 'text-slate-500'}>
                            {teacher.weeklyPeriods}
                            {max ? ` / ${max}` : ''} periods
                          </span>
                        </div>
                        <ProgressBar value={max ? percent : teacher.weeklyPeriods * 3} tone={teacher.overLimit ? 'danger' : percent > 85 ? 'warning' : 'success'} />
                      </div>
                    );
                  })
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Gaps to close" description="Items the timetable engine will refuse to publish over." />
            <CardBody className="space-y-4 text-sm">
              <div>
                <p className="font-medium text-slate-700">Missing teacher assignments</p>
                {(issues?.missingTeacherAssignments?.length ?? 0) === 0 ? (
                  <p className="text-xs text-success-strong">None — every required period has a teacher.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-xs text-amber-800">
                    {issues?.missingTeacherAssignments.map((item) => (
                      <li key={`${item.classId}-${item.learningAreaId}`} className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {item.learningAreaName} for {item.className}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="font-medium text-slate-700">Classes without learners</p>
                {(issues?.classesWithoutLearners?.length ?? 0) === 0 ? (
                  <p className="text-xs text-success-strong">Every class has learners.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-xs text-amber-800">
                    {issues?.classesWithoutLearners.map((klass) => (
                      <li key={klass.id}>{klass.name}</li>
                    ))}
                  </ul>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => coverage.reload()}>
                Re-check coverage
              </Button>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === 'availability' ? (
        <Card>
          <CardHeader title="Teacher availability" description="Blocked slots are hard constraints: the engine will never place a lesson in them." />
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th>Teacher</Th>
                  <Th>Weekly limit</Th>
                  <Th>Blocked slots</Th>
                  <Th>Preferred free days</Th>
                  <Th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {(teachers.data ?? []).map((teacher) => (
                  <tr key={teacher.id}>
                    <Td>
                      <span className="block font-medium text-slate-800">{teacher.fullName}</span>
                      <span className="block text-xs text-slate-500">{teacher.staffNumber}</span>
                    </Td>
                    <Td className="text-xs text-slate-600">{teacher.maxPeriodsPerWeek ?? '—'} periods / week</Td>
                    <Td>
                      {teacher.unavailableSlots?.length ? (
                        <Badge tone="warning">{teacher.unavailableSlots.length} blocked</Badge>
                      ) : (
                        <span className="text-xs text-slate-400">available all week</span>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-600">{teacher.prefersFreeDays?.length ? teacher.prefersFreeDays.map(dayName).join(', ') : '—'}</Td>
                    <Td>
                      <div className="flex justify-end">
                        <Button variant="secondary" size="sm" onClick={() => openAvailability(teacher)}>
                          Edit availability
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      {/* ----------------------------------------------------- create modal */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Assign a teacher"
        description="The engine only schedules lessons where a valid assignment exists."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" form="assignment-form" loading={pending}>
              Create assignment
            </Button>
          </>
        }
      >
        <form id="assignment-form" className="space-y-3" onSubmit={create}>
          <Field label="Teacher" required>
            <Select required value={form.teacherId} onChange={(event) => setForm({ ...form, teacherId: event.target.value })}>
              <option value="">Select a teacher</option>
              {(teachers.data ?? []).map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName} · {teacher.staffNumber}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Class" required>
              <Select required value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value })}>
                <option value="">Select a class</option>
                {(classes.data ?? []).map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Learning area" required>
              <Select required value={form.learningAreaId} onChange={(event) => setForm({ ...form, learningAreaId: event.target.value })}>
                <option value="">Select a learning area</option>
                {(areas.data ?? []).map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Lessons per week override" hint="Leave blank to use the class requirement">
            <Input
              type="number"
              min={1}
              max={20}
              value={form.lessonsPerWeek}
              onChange={(event) => setForm({ ...form, lessonsPerWeek: event.target.value })}
            />
          </Field>
          <Link href="/academics/classes" className="text-xs text-royal hover:underline">
            Manage class lists and capacity →
          </Link>
        </form>
      </Modal>

      {/* ------------------------------------------------ availability modal */}
      <Modal
        open={Boolean(availabilityTeacher)}
        onClose={() => setAvailabilityTeacher(null)}
        title={`Availability · ${availabilityTeacher?.fullName ?? ''}`}
        description="Click a slot to block or unblock it. Blocked slots are respected as hard constraints."
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAvailabilityTeacher(null)}>
              Cancel
            </Button>
            <Button loading={pending} onClick={saveAvailability}>
              Save availability
            </Button>
          </>
        }
      >
        {availability.loading ? (
          <Skeleton className="h-40" />
        ) : teachingSlots.length === 0 ? (
          <Note tone="warning" title="No bell schedule yet">
            <p>
              Configure the school day first (school settings → periods) so availability can be expressed per period.{' '}
              <Link href="/settings/school" className="underline">
                Open school settings
              </Link>
            </p>
          </Note>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr>
                  <th className="border-b border-slate-200 px-2 py-1 text-left text-slate-600">Period</th>
                  {days.map((day) => (
                    <th key={day} className="border-b border-slate-200 px-2 py-1 text-left text-slate-600">
                      {dayShort(day)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teachingSlots.map((period) => (
                  <tr key={period.id}>
                    <td className="border-b border-slate-100 px-2 py-1 text-slate-500">
                      {period.label}
                      <span className="block text-[10px]">{period.startTime}</span>
                    </td>
                    {days.map((day) => {
                      const key = `${day}-${period.sequence}`;
                      const isBlocked = Boolean(blocked[key]);
                      return (
                        <td key={day} className="border-b border-slate-100 p-0.5">
                          <button
                            type="button"
                            aria-pressed={isBlocked}
                            aria-label={`${dayName(day)} ${period.label} ${isBlocked ? 'blocked' : 'available'}`}
                            onClick={() =>
                              setBlocked((prev) => {
                                const next = { ...prev };
                                if (next[key]) delete next[key];
                                else next[key] = { dayOfWeek: day, periodIndex: period.sequence };
                                return next;
                              })
                            }
                            className={`h-8 w-full rounded text-[10px] font-medium transition ${
                              isBlocked ? 'bg-rose-100 text-rose-700 hover:bg-rose-200' : 'bg-success-soft text-success-strong hover:bg-success-soft'
                            }`}
                          >
                            {isBlocked ? 'blocked' : 'free'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">{Object.keys(blocked).length} slot(s) blocked. Reasons can be added by the school office for the record.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
