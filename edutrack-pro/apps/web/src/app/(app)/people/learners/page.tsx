'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Pencil, Plus, Upload, UserRound, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, useDebounced } from '@/lib/hooks';
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
  Table,
  Td,
  Th,
  Textarea,
  useToast,
} from '@/components/ui';
import { CsvImport } from '@/components/csv-import';
import { formatDate } from '@/lib/utils';
import type { ClassSummary, GradeLevel, LearnerSummary } from '@/lib/types';

const GENDERS = ['MALE', 'FEMALE', 'UNDISCLOSED', 'OTHER'];
const STATUSES = ['ACTIVE', 'TRANSFERRED', 'GRADUATED', 'WITHDRAWN', 'SUSPENDED'];

function LearnersPageInner() {
  const toast = useToast();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [gradeId, setGradeId] = useState('');
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search, 300);

  const grades = useApiQuery<GradeLevel[]>('/school/grades');
  const classes = useApiQuery<ClassSummary[]>('/classes', { query: { pageSize: 100 } });
  const { data, error, loading, reload } = useApiQuery<LearnerSummary[]>('/learners', {
    query: { search: debounced || undefined, gradeId: gradeId || undefined, classId: classId || undefined, status: status || undefined, page, pageSize: 25 },
  });

  const [editing, setEditing] = useState<LearnerSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    admissionNumber: '',
    assessmentNumber: '',
    upiNumber: '',
    firstName: '',
    middleName: '',
    lastName: '',
    gender: 'UNDISCLOSED',
    dateOfBirth: '',
    gradeId: '',
    currentClassId: '',
    status: 'ACTIVE',
    enrolledOn: '',
    isBoarding: false,
    specialNeeds: '',
    medicalNotes: '',
    homeLocation: '',
    notes: '',
  });

  const learners = useMemo(() => data ?? [], [data]);

  const openCreate = () => {
    setForm({
      admissionNumber: '',
      assessmentNumber: '',
      upiNumber: '',
      firstName: '',
      middleName: '',
      lastName: '',
      gender: 'UNDISCLOSED',
      dateOfBirth: '',
      gradeId: grades.data?.[0]?.id ?? '',
      currentClassId: '',
      status: 'ACTIVE',
      enrolledOn: new Date().toISOString().slice(0, 10),
      isBoarding: false,
      specialNeeds: '',
      medicalNotes: '',
      homeLocation: '',
      notes: '',
    });
    setFormError(null);
    setCreating(true);
  };

  const openEdit = (learner: LearnerSummary) => {
    setEditing(learner);
    setForm({
      admissionNumber: learner.admissionNumber,
      assessmentNumber: learner.assessmentNumber ?? '',
      upiNumber: learner.upiNumber ?? '',
      firstName: learner.firstName,
      middleName: learner.middleName ?? '',
      lastName: learner.lastName,
      gender: learner.gender,
      dateOfBirth: learner.dateOfBirth ?? '',
      gradeId: learner.gradeId ?? '',
      currentClassId: learner.currentClassId ?? '',
      status: learner.status,
      enrolledOn: learner.enrolledOn ?? '',
      isBoarding: Boolean(learner.isBoarding),
      specialNeeds: learner.specialNeeds ?? '',
      medicalNotes: '',
      homeLocation: '',
      notes: '',
    });
    setFormError(null);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    const payload: Record<string, unknown> = {
      ...form,
      assessmentNumber: form.assessmentNumber || null,
      upiNumber: form.upiNumber || null,
      middleName: form.middleName || null,
      dateOfBirth: form.dateOfBirth || null,
      enrolledOn: form.enrolledOn || null,
      currentClassId: form.currentClassId || null,
      specialNeeds: form.specialNeeds || null,
      medicalNotes: form.medicalNotes || null,
      homeLocation: form.homeLocation || null,
      notes: form.notes || null,
    };
    try {
      if (editing) {
        await api.patch(`/learners/${editing.id}`, payload);
        toast.success('Learner updated', `${form.firstName} ${form.lastName}`);
      } else {
        await api.post('/learners', payload);
        toast.success('Learner registered', `${form.firstName} ${form.lastName} added to the register.`);
      }
      setCreating(false);
      setEditing(null);
      await reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Saving failed.');
    } finally {
      setPending(false);
    }
  };

  const classOptions = (classes.data ?? []).filter((klass) => !form.gradeId || klass.gradeId === form.gradeId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Learners"
        description="The learner register for Grades 7–9. Learners are records, not users — they never sign in."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" aria-hidden /> Import from CSV
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden /> Register learner
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader
          title="Register"
          description="The admission number must be unique. The assessment number is a school record and is never used on its own to prove who a guardian is."
          actions={
            <div className="flex flex-wrap gap-2">
              <Input className="w-full sm:w-56" placeholder="Search name or admission no." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search learners" />
              <Select className="w-full sm:w-40" value={gradeId} onChange={(event) => setGradeId(event.target.value)} aria-label="Filter by grade">
                <option value="">All grades</option>
                {(grades.data ?? []).map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name}
                  </option>
                ))}
              </Select>
              <Select className="w-full sm:w-44" value={classId} onChange={(event) => setClassId(event.target.value)} aria-label="Filter by class">
                <option value="">All classes</option>
                {(classes.data ?? []).map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </Select>
              <Select className="w-full sm:w-36" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
                <option value="">Any status</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value.charAt(0) + value.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        <CardBody>
          {loading ? (
            <Skeleton className="h-40" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => reload()} />
          ) : learners.length === 0 ? (
            <EmptyState
              title="No learners match these filters"
              description="Adjust the filters, or register a learner or import the class register from CSV."
              icon={<Users className="h-6 w-6" aria-hidden />}
            />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>Learner</Th>
                    <Th>Admission / assessment</Th>
                    <Th>Grade & class</Th>
                    <Th>Status</Th>
                    <Th>Guardians</Th>
                    <Th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {learners.map((learner) => (
                    <tr key={learner.id} className="hover:bg-slate-50">
                      <Td>
                        <span className="block font-medium text-slate-800">{learner.fullName}</span>
                        <span className="block text-xs text-slate-500">
                          {learner.gender?.toLowerCase() ?? ''} {learner.dateOfBirth ? `· born ${formatDate(learner.dateOfBirth)}` : ''}
                        </span>
                      </Td>
                      <Td>
                        <span className="block text-xs text-slate-600">{learner.admissionNumber}</span>
                        <span className="block text-xs text-slate-400">Assessment {learner.assessmentNumber || '—'}</span>
                      </Td>
                      <Td>
                        <span className="block text-sm text-slate-700">{learner.gradeName}</span>
                        <span className="block text-xs text-slate-500">{learner.className ?? 'Not placed in a class'}</span>
                      </Td>
                      <Td>
                        <Badge tone={learner.status === 'ACTIVE' ? 'success' : 'neutral'}>{learner.status.toLowerCase()}</Badge>
                        {learner.isBoarding ? <Badge tone="info" className="ml-1">boarding</Badge> : null}
                      </Td>
                      <Td>
                        {learner.guardianCount ? (
                          <Link href="/people/parents" className="text-xs font-medium text-royal hover:underline">
                            {learner.guardianCount} linked
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">none</span>
                        )}
                      </Td>
                      <Td>
                        <div className="flex justify-end">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(learner)} aria-label={`Edit ${learner.fullName}`}>
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>Showing {learners.length} learner(s)</span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={learners.length < 25} onClick={() => setPage((value) => value + 1)}>
                    Next
                  </Button>
                </span>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Modal
        open={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? `Edit ${editing.fullName}` : 'Register a learner'}
        description="Only the admission number is required. Everything else can be completed later."
        size="lg"
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
            <Button type="submit" form="learner-form" loading={pending}>
              {editing ? 'Save changes' : 'Register learner'}
            </Button>
          </>
        }
      >
        <form id="learner-form" className="space-y-4" onSubmit={save}>
          {formError ? <ErrorState message={formError} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Admission number" required>
              <Input required value={form.admissionNumber} onChange={(event) => setForm({ ...form, admissionNumber: event.target.value })} placeholder="NHJS/2026/0123" />
            </Field>
            <Field label="Assessment number" hint="School record only">
              <Input value={form.assessmentNumber} onChange={(event) => setForm({ ...form, assessmentNumber: event.target.value })} />
            </Field>
            <Field label="First name" required>
              <Input required value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
            </Field>
            <Field label="Middle name">
              <Input value={form.middleName} onChange={(event) => setForm({ ...form, middleName: event.target.value })} />
            </Field>
            <Field label="Last name" required>
              <Input required value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
            </Field>
            <Field label="UPI number">
              <Input value={form.upiNumber} onChange={(event) => setForm({ ...form, upiNumber: event.target.value })} />
            </Field>
            <Field label="Gender">
              <Select value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value })}>
                {GENDERS.map((gender) => (
                  <option key={gender} value={gender}>
                    {gender.charAt(0) + gender.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date of birth">
              <Input type="date" value={form.dateOfBirth} onChange={(event) => setForm({ ...form, dateOfBirth: event.target.value })} />
            </Field>
            <Field label="Grade" required>
              <Select
                required
                value={form.gradeId}
                onChange={(event) => setForm({ ...form, gradeId: event.target.value, currentClassId: '' })}
              >
                <option value="">Select a grade</option>
                {(grades.data ?? []).map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Class" hint="Only classes in the selected grade are listed">
              <Select value={form.currentClassId} onChange={(event) => setForm({ ...form, currentClassId: event.target.value })}>
                <option value="">Not placed yet</option>
                {classOptions.map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name} ({klass.learnerCount ?? 0}/{klass.capacity ?? '—'})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value.charAt(0) + value.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Enrolled on">
              <Input type="date" value={form.enrolledOn} onChange={(event) => setForm({ ...form, enrolledOn: event.target.value })} />
            </Field>
            <Field label="Home location">
              <Input value={form.homeLocation} onChange={(event) => setForm({ ...form, homeLocation: event.target.value })} />
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox label="Boarding learner" checked={form.isBoarding} onChange={(event) => setForm({ ...form, isBoarding: event.target.checked })} />
            </div>
            <Field label="Special needs" className="sm:col-span-2">
              <Textarea value={form.specialNeeds} onChange={(event) => setForm({ ...form, specialNeeds: event.target.value })} placeholder="Support the school should know about" />
            </Field>
            <Field label="Medical notes" className="sm:col-span-2" hint="Visible to staff only">
              <Textarea value={form.medicalNotes} onChange={(event) => setForm({ ...form, medicalNotes: event.target.value })} />
            </Field>
          </div>
        </form>
      </Modal>

      <Modal
        open={importing}
        onClose={() => setImporting(false)}
        title="Import learners"
        description="Validate the CSV first — the importer reports every problem row before anything is written."
        size="lg"
        footer={
          <Button variant="ghost" onClick={() => setImporting(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-3">
          <Note tone="info" title="How matching works">
            <p>Learners are matched on admission number: existing learners are updated, new ones are created, and unknown grades or classes are reported rather than guessed.</p>
          </Note>
          <CsvImport
            endpoint="/learners/import"
            templatePath="/learners/import/template"
            entityLabel="learners"
            onImported={() => {
              setImporting(false);
              void reload();
            }}
          />
        </div>
      </Modal>

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <UserRound className="h-3.5 w-3.5" aria-hidden />
        Learner records are protected: results and resources are only released to guardians whose link the school has verified.
      </p>
    </div>
  );
}

export default function LearnersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <LearnersPageInner />
    </Suspense>
  );
}
