'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Plus, TriangleAlert, UserPlus, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/hooks';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Note,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  Tabs,
  Td,
  Th,
  useToast,
} from '@/components/ui';
import { formatDate } from '@/lib/utils';
import type { AcademicYear, ClassSummary, GradeLevel, LearnerSummary, TeacherSummary } from '@/lib/types';

interface RosterRow {
  id: string; // ClassEnrollment id — used to withdraw the placement
  learnerId: string;
  learnerName: string;
  admissionNumber: string;
  assessmentNumber?: string | null;
  gender?: string | null;
  status: string;
  enrolledAt?: string | null;
}

export default function ClassesPage() {
  const toast = useToast();
  const [tab, setTab] = useState('classes');
  const years = useApiQuery<AcademicYear[]>('/school/academic-years');
  const grades = useApiQuery<GradeLevel[]>('/school/grades');
  const classes = useApiQuery<ClassSummary[]>('/classes', { query: { pageSize: 100 } });
  const teachers = useApiQuery<TeacherSummary[]>('/teachers', { query: { pageSize: 200 } });
  const learners = useApiQuery<LearnerSummary[]>('/learners', { query: { pageSize: 300, status: 'ACTIVE' } });
  const validation = useApiQuery<{
    valid: boolean;
    missingGrades: Array<{ id: string; fullName: string; admissionNumber: string }>;
    duplicateAdmissionNumbers: Array<{ admissionNumber: string; count: number }>;
    classOverCapacity: Array<{ id: string; name: string; learnerCount: number; capacity: number | null }>;
    learnersWithoutClass: Array<{ id: string; fullName: string; admissionNumber: string; gradeName?: string | null }>;
    summary: Record<string, number>;
  }>('/classes/validation/enrollments');

  const [editing, setEditing] = useState<ClassSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', stream: '', gradeId: '', academicYearId: '', classTeacherId: '', capacity: '45', isActive: true, notes: '' });

  const [enrolmentClass, setEnrolmentClass] = useState<ClassSummary | null>(null);
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [selectedLearners, setSelectedLearners] = useState<string[]>([]);
  const [learnerFilter, setLearnerFilter] = useState('');

  const classList = useMemo(() => classes.data ?? [], [classes.data]);
  const currentYearId = years.data?.find((year) => year.isCurrent)?.id ?? years.data?.[0]?.id ?? '';

  const saveClass = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    const payload = { ...form, stream: form.stream || null, classTeacherId: form.classTeacherId || null, capacity: form.capacity ? Number(form.capacity) : null, notes: form.notes || null };
    try {
      if (editing) {
        await api.patch(`/classes/${editing.id}`, payload);
        toast.success('Class updated', form.name);
      } else {
        await api.post('/classes', payload);
        toast.success('Class created', form.name);
      }
      setCreating(false);
      setEditing(null);
      await classes.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Saving failed.');
    } finally {
      setPending(false);
    }
  };

  const openEnrolment = async (klass: ClassSummary) => {
    setEnrolmentClass(klass);
    setRoster(null);
    setSelectedLearners([]);
    try {
      const data = await api.get<RosterRow[]>(`/classes/${klass.id}/learners`);
      setRoster(Array.isArray(data) ? data : []);
    } catch (caught) {
      toast.error('Could not load the class list', caught instanceof ApiError ? caught.message : undefined);
      setRoster([]);
    }
  };

  const enrolSelected = async () => {
    if (!enrolmentClass || selectedLearners.length === 0) return;
    setPending(true);
    try {
      const result = await api.post<{ enrolled: number; skipped?: number }>('/classes/enrollments/bulk', {
        classId: enrolmentClass.id,
        learnerIds: selectedLearners,
      });
      toast.success('Enrolment complete', `${result?.enrolled ?? selectedLearners.length} learner(s) placed in ${enrolmentClass.name}.`);
      setSelectedLearners([]);
      await openEnrolment(enrolmentClass);
      await classes.reload();
    } catch (caught) {
      toast.error('Enrolment failed', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  /** Withdrawing closes the enrolment and clears the learner's current class. */
  const removeFromClass = async (row: RosterRow) => {
    if (!enrolmentClass) return;
    if (!window.confirm(`Withdraw ${row.learnerName} from ${enrolmentClass.name}? The placement is kept on record as TRANSFERRED.`)) return;
    try {
      await api.del(`/classes/enrollments/${row.id}?status=TRANSFERRED`);
      toast.success('Removed from class', row.learnerName);
      await openEnrolment(enrolmentClass);
      await classes.reload();
    } catch (caught) {
      toast.error('Could not remove', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const assignable = (learners.data ?? []).filter((learner) => {
    if (!enrolmentClass) return false;
    if (learner.currentClassId === enrolmentClass.id) return false;
    if (learner.gradeId && learner.gradeId !== enrolmentClass.gradeId) return false;
    if (learnerFilter) {
      const needle = learnerFilter.toLowerCase();
      if (!learner.fullName.toLowerCase().includes(needle) && !learner.admissionNumber.toLowerCase().includes(needle)) return false;
    }
    return true;
  });

  const issues = validation.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Classes & enrolment"
        description="Create the streams for each grade, place learners, and check the register for gaps."
        actions={
          <Button
            size="sm"
            onClick={() => {
              setForm({ name: '', stream: '', gradeId: grades.data?.[0]?.id ?? '', academicYearId: currentYearId, classTeacherId: '', capacity: '45', isActive: true, notes: '' });
              setFormError(null);
              setCreating(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden /> New class
          </Button>
        }
      />

      {issues && !issues.valid ? (
        <Note tone="warning" title="Enrolment needs attention">
          <ul className="list-disc space-y-0.5 pl-4">
            {issues.learnersWithoutClass?.length ? <li>{issues.learnersWithoutClass.length} active learner(s) are not in any class.</li> : null}
            {issues.classOverCapacity?.length ? <li>{issues.classOverCapacity.length} class(es) are over capacity.</li> : null}
            {issues.duplicateAdmissionNumbers?.length ? <li>{issues.duplicateAdmissionNumbers.length} duplicate admission number(s) found.</li> : null}
            {issues.missingGrades?.length ? <li>{issues.missingGrades.length} learner(s) have no grade recorded.</li> : null}
          </ul>
        </Note>
      ) : issues?.valid ? (
        <p className="flex items-center gap-2 text-xs text-success-strong">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Enrolment checks pass: every active learner is placed and no class is over capacity.
        </p>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'classes', label: 'Classes', badge: classList.length || undefined },
          { id: 'grades', label: 'Grades', badge: grades.data?.length || undefined },
          { id: 'issues', label: 'Register checks', badge: issues && !issues.valid ? '!' : undefined },
        ]}
      />

      {tab === 'classes' ? (
        <Card>
          <CardHeader title="Class list" description="Each class belongs to one grade and one academic year." />
          <CardBody>
            {classes.loading ? (
              <Skeleton className="h-40" />
            ) : classes.error ? (
              <ErrorState message={classes.error} onRetry={() => classes.reload()} />
            ) : classList.length === 0 ? (
              <EmptyState title="No classes yet" description="Create the streams for Grades 7, 8 and 9 before enrolling learners." icon={<Users className="h-6 w-6" aria-hidden />} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Class</Th>
                    <Th>Grade</Th>
                    <Th>Class teacher</Th>
                    <Th>Enrolment</Th>
                    <Th>Teaching assignments</Th>
                    <Th>Status</Th>
                    <Th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {classList.map((klass) => {
                    const over = klass.capacity ? (klass.learnerCount ?? 0) > klass.capacity : false;
                    return (
                      <tr key={klass.id} className="hover:bg-slate-50">
                        <Td>
                          <span className="block font-medium text-slate-800">{klass.name}</span>
                          <span className="block text-xs text-slate-500">{klass.academicYearName}</span>
                        </Td>
                        <Td>{klass.gradeName}</Td>
                        <Td>{klass.classTeacherName ?? <span className="text-xs text-slate-400">not assigned</span>}</Td>
                        <Td>
                          <span className={over ? 'text-sm font-medium text-rose-700' : 'text-sm text-slate-700'}>
                            {klass.learnerCount ?? 0}
                            {klass.capacity ? ` / ${klass.capacity}` : ''}
                          </span>
                          {over ? (
                            <Badge tone="danger" className="ml-2">
                              <TriangleAlert className="h-3 w-3" aria-hidden /> over capacity
                            </Badge>
                          ) : null}
                        </Td>
                        <Td>{klass.assignmentCount ?? 0}</Td>
                        <Td>
                          <StatusBadge status={klass.isActive ? 'ACTIVE' : 'INACTIVE'} />
                        </Td>
                        <Td>
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button variant="secondary" size="sm" onClick={() => openEnrolment(klass)}>
                              <UserPlus className="h-4 w-4" aria-hidden /> Enrol
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditing(klass);
                                setForm({
                                  name: klass.name,
                                  stream: klass.stream ?? '',
                                  gradeId: klass.gradeId,
                                  academicYearId: klass.academicYearId,
                                  classTeacherId: klass.classTeacherId ?? '',
                                  capacity: String(klass.capacity ?? ''),
                                  isActive: klass.isActive,
                                  notes: '',
                                });
                              }}
                            >
                              Edit
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
      ) : null}

      {tab === 'grades' ? (
        <Card>
          <CardHeader title="Junior school grades" description="Grades 7–9 are seeded per the CBE structure; classes are created inside each grade." />
          <CardBody>
            <Table>
              <thead>
                <tr>
                  <Th>Grade</Th>
                  <Th>Classes</Th>
                  <Th>Learners</Th>
                </tr>
              </thead>
              <tbody>
                {(grades.data ?? []).map((grade) => (
                  <tr key={grade.id}>
                    <Td className="font-medium text-slate-800">{grade.name}</Td>
                    <Td>{grade.classCount}</Td>
                    <Td>{grade.learnerCount}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      ) : null}

      {tab === 'issues' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Learners without a class" description="Active learners who are not in a class list yet." />
            <CardBody>
              {(issues?.learnersWithoutClass?.length ?? 0) === 0 ? (
                <p className="text-sm text-success-strong">Every active learner is placed.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {issues?.learnersWithoutClass.map((learner) => (
                    <li key={learner.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                      <span className="text-slate-800">{learner.fullName}</span>
                      <span className="text-xs text-slate-500">
                        {learner.admissionNumber} · {learner.gradeName ?? 'grade missing'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Capacity & integrity" />
            <CardBody className="space-y-3 text-sm">
              <div>
                <p className="font-medium text-slate-700">Classes over capacity</p>
                {(issues?.classOverCapacity?.length ?? 0) === 0 ? (
                  <p className="text-xs text-slate-500">None.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-xs text-rose-700">
                    {issues?.classOverCapacity.map((klass) => (
                      <li key={klass.id}>
                        {klass.name}: {klass.learnerCount} learners in a class of {klass.capacity}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="font-medium text-slate-700">Duplicate admission numbers</p>
                {(issues?.duplicateAdmissionNumbers?.length ?? 0) === 0 ? (
                  <p className="text-xs text-slate-500">None.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-xs text-rose-700">
                    {issues?.duplicateAdmissionNumbers.map((item) => (
                      <li key={item.admissionNumber}>
                        {item.admissionNumber} appears {item.count} times
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="font-medium text-slate-700">Learners missing a grade</p>
                {(issues?.missingGrades?.length ?? 0) === 0 ? (
                  <p className="text-xs text-slate-500">None.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-xs text-rose-700">
                    {issues?.missingGrades.slice(0, 10).map((learner) => (
                      <li key={learner.id}>
                        {learner.fullName} ({learner.admissionNumber})
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* ------------------------------------------------- class create/edit */}
      <Modal
        open={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? `Edit ${editing.name}` : 'Create a class'}
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="class-form" loading={pending}>
              {editing ? 'Save changes' : 'Create class'}
            </Button>
          </>
        }
      >
        <form id="class-form" className="grid gap-3 sm:grid-cols-2" onSubmit={saveClass}>
          {formError ? (
            <div className="sm:col-span-2">
              <ErrorState message={formError} />
            </div>
          ) : null}
          <Field label="Class name" required className="sm:col-span-2">
            <Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Grade 7 Tumaini" />
          </Field>
          <Field label="Grade" required>
            <Select required value={form.gradeId} onChange={(event) => setForm({ ...form, gradeId: event.target.value })}>
              <option value="">Select a grade</option>
              {(grades.data ?? []).map((grade) => (
                <option key={grade.id} value={grade.id}>
                  {grade.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Stream / nickname">
            <Input value={form.stream} onChange={(event) => setForm({ ...form, stream: event.target.value })} placeholder="Tumaini" />
          </Field>
          <Field label="Academic year" required>
            <Select required value={form.academicYearId} onChange={(event) => setForm({ ...form, academicYearId: event.target.value })}>
              {(years.data ?? []).map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                  {year.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Capacity" hint="Used for over-capacity warnings">
            <Input type="number" min={1} value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} />
          </Field>
          <Field label="Class teacher" className="sm:col-span-2">
            <Select value={form.classTeacherId} onChange={(event) => setForm({ ...form, classTeacherId: event.target.value })}>
              <option value="">Not assigned</option>
              {(teachers.data ?? []).map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName} ({teacher.staffNumber})
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Checkbox label="Class is active" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
          </div>
        </form>
      </Modal>

      {/* ------------------------------------------------------- enrolment */}
      <Modal
        open={Boolean(enrolmentClass)}
        onClose={() => setEnrolmentClass(null)}
        title={`Enrolment · ${enrolmentClass?.name ?? ''}`}
        description="Place learners into this class, or remove them from the class list."
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEnrolmentClass(null)}>
              Close
            </Button>
            <Button onClick={enrolSelected} disabled={!selectedLearners.length} loading={pending}>
              <UserPlus className="h-4 w-4" aria-hidden /> Enrol {selectedLearners.length || ''} selected
            </Button>
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Current class list</h3>
            {roster === null ? (
              <Skeleton className="h-40" />
            ) : roster.length === 0 ? (
              <EmptyState title="Nobody is in this class yet" description="Use the panel on the right to place learners." />
            ) : (
              <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
                {roster.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-slate-800">{row.learnerName}</span>
                      <span className="block text-xs text-slate-500">
                        {row.admissionNumber} · enrolled {formatDate(row.enrolledAt)}
                      </span>
                    </span>
                    <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50" onClick={() => removeFromClass(row)}>
                      Withdraw
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Available learners in this grade</h3>
            <Input className="mb-2" placeholder="Filter by name or admission number" value={learnerFilter} onChange={(event) => setLearnerFilter(event.target.value)} />
            {learners.loading ? (
              <Skeleton className="h-40" />
            ) : assignable.length === 0 ? (
              <EmptyState title="Nobody left to place" description="Every active learner in this grade already has a class, or the filter matched nothing." />
            ) : (
              <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
                {assignable.slice(0, 200).map((learner) => (
                  <li key={learner.id} className="rounded-lg border border-slate-100 px-3 py-2">
                    <Checkbox
                      label={
                        <span>
                          <span className="block text-sm text-slate-800">{learner.fullName}</span>
                          <span className="block text-xs text-slate-500">
                            {learner.admissionNumber} · {learner.className ?? 'no class yet'}
                          </span>
                        </span>
                      }
                      checked={selectedLearners.includes(learner.id)}
                      onChange={(event) =>
                        setSelectedLearners((prev) => (event.target.checked ? [...prev, learner.id] : prev.filter((id) => id !== learner.id)))
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-slate-500">
              A learner can only be in one active class at a time. Moving a learner keeps the old enrolment for audit.
            </p>
          </div>
        </div>
      </Modal>

      {currentYearId ? (
        <p className="text-xs text-slate-500">
          Current academic year: {years.data?.find((year) => year.isCurrent)?.name ?? '—'} · started {formatDate(years.data?.find((year) => year.isCurrent)?.startDate)}
        </p>
      ) : null}
    </div>
  );
}
