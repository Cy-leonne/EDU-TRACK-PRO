'use client';

import { useMemo, useState } from 'react';
import { GraduationCap, KeyRound, Pencil, Plus, Upload } from 'lucide-react';
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
  useToast,
} from '@/components/ui';
import { CsvImport } from '@/components/csv-import';
import { dayName, formatDate, titleCase } from '@/lib/utils';
import type { TeacherSummary } from '@/lib/types';

const EMPLOYMENT = ['TSC_EMPLOYED', 'BOM_EMPLOYED', 'INTERN', 'VOLUNTEER', 'CONTRACT'];

const emptyForm = {
  fullName: '',
  email: '',
  phone: '',
  staffNumber: '',
  tscNumber: '',
  nationalId: '',
  specialization: '',
  qualifications: '',
  employmentType: 'TSC_EMPLOYED',
  maxPeriodsPerDay: '7',
  maxPeriodsPerWeek: '28',
};

export default function TeachersPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const query = useDebounced(search, 250);
  const { data, error, loading, reload } = useApiQuery<TeacherSummary[]>('/teachers', { query: { search: query || undefined, pageSize: 100 } });

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TeacherSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [tempPassword, setTempPassword] = useState('');
  const [freeDays, setFreeDays] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const teachers = useMemo(() => data ?? [], [data]);

  const openCreate = () => {
    setForm(emptyForm);
    setFreeDays([]);
    setTempPassword('');
    setFormError(null);
    setCreating(true);
  };

  const openEdit = (teacher: TeacherSummary) => {
    setEditing(teacher);
    setForm({
      fullName: teacher.fullName,
      email: teacher.email,
      phone: teacher.phone ?? '',
      staffNumber: teacher.staffNumber,
      tscNumber: teacher.tscNumber ?? '',
      nationalId: '',
      specialization: teacher.specialization ?? '',
      qualifications: teacher.qualifications ?? '',
      employmentType: teacher.employmentType ?? 'TSC_EMPLOYED',
      maxPeriodsPerDay: String(teacher.maxPeriodsPerDay ?? ''),
      maxPeriodsPerWeek: String(teacher.maxPeriodsPerWeek ?? ''),
    });
    setFreeDays(teacher.prefersFreeDays ?? []);
    setFormError(null);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    const payload: Record<string, unknown> = {
      ...form,
      phone: form.phone || undefined,
      tscNumber: form.tscNumber || null,
      nationalId: form.nationalId || null,
      specialization: form.specialization || null,
      qualifications: form.qualifications || null,
      maxPeriodsPerDay: form.maxPeriodsPerDay ? Number(form.maxPeriodsPerDay) : null,
      maxPeriodsPerWeek: form.maxPeriodsPerWeek ? Number(form.maxPeriodsPerWeek) : null,
      prefersFreeDays: freeDays,
    };
    // The API generates a temporary password when none is supplied and returns
    // it once; it is never stored in plain text after that.
    if (tempPassword) payload.temporaryPassword = tempPassword;

    try {
      if (editing) {
        await api.patch(`/teachers/${editing.id}`, payload);
        toast.success('Teacher updated', `${form.fullName} has been saved.`);
      } else {
        const created = await api.post<{ temporaryPassword?: string } & TeacherSummary>('/teachers', payload);
        toast.success('Teacher created', created?.temporaryPassword ? `Temporary password: ${created.temporaryPassword}` : 'Account created.');
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

  const resetPassword = async (teacher: TeacherSummary) => {
    if (!window.confirm(`Issue a new temporary password for ${teacher.fullName}?`)) return;
    try {
      const result = await api.post<{ temporaryPassword?: string }>(`/teachers/${teacher.id}/reset-password`, {});
      toast.success('Password reset', result?.temporaryPassword ? `Share this once: ${result.temporaryPassword}` : 'A new password was issued.');
    } catch (caught) {
      toast.error('Could not reset password', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const setActive = async (teacher: TeacherSummary, isActive: boolean) => {
    try {
      await api.patch(`/teachers/${teacher.id}`, { isActive });
      toast.success(isActive ? 'Account re-enabled' : 'Account disabled', teacher.fullName);
      await reload();
    } catch (caught) {
      toast.error('Could not update', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Teaching staff"
        description="Create teacher accounts, set workload limits and record which days they prefer to stay free."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" aria-hidden /> Import from CSV
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden /> Add teacher
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader
          title={`${teachers.length} teacher${teachers.length === 1 ? '' : 's'}`}
          description="Temporary passwords are shown once at creation; the school can issue a new one at any time."
          actions={
            <Input
              placeholder="Search by name, staff number or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full sm:w-72"
              aria-label="Search teachers"
            />
          }
        />
        <CardBody>
          {loading ? (
            <Skeleton className="h-40" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => reload()} />
          ) : teachers.length === 0 ? (
            <EmptyState
              title="No teaching staff yet"
              description="Add teachers one at a time or import a CSV export from the school's staff register."
              action={
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-4 w-4" aria-hidden /> Add teacher
                </Button>
              }
              icon={<GraduationCap className="h-6 w-6" aria-hidden />}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Teacher</Th>
                  <Th>Staff / TSC</Th>
                  <Th>Employment</Th>
                  <Th>Workload limit</Th>
                  <Th>Assignments</Th>
                  <Th>Availability</Th>
                  <Th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {teachers.map((teacher) => (
                  <tr key={teacher.id} className="hover:bg-slate-50">
                    <Td>
                      <span className="block font-medium text-slate-800">{teacher.fullName}</span>
                      <span className="block text-xs text-slate-500">{teacher.email}</span>
                      {teacher.phone ? <span className="block text-xs text-slate-400">{teacher.phone}</span> : null}
                    </Td>
                    <Td>
                      <span className="block text-xs text-slate-600">{teacher.staffNumber}</span>
                      <span className="block text-xs text-slate-400">TSC {teacher.tscNumber || '—'}</span>
                    </Td>
                    <Td>
                      <Badge tone={teacher.employmentType === 'TSC_EMPLOYED' ? 'info' : 'neutral'}>{titleCase(teacher.employmentType ?? '')}</Badge>
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-600">
                        {teacher.maxPeriodsPerDay ?? '—'} / day · {teacher.maxPeriodsPerWeek ?? '—'} / week
                      </span>
                    </Td>
                    <Td>{teacher.assignmentCount ?? 0}</Td>
                    <Td>
                      {teacher.unavailableSlots?.length ? (
                        <span className="text-xs text-slate-600">{teacher.unavailableSlots.length} blocked slots</span>
                      ) : (
                        <span className="text-xs text-slate-400">Fully available</span>
                      )}
                      {teacher.prefersFreeDays?.length ? (
                        <span className="block text-xs text-slate-400">prefers {teacher.prefersFreeDays.map(dayName).join(', ')} free</span>
                      ) : null}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {teacher.isActive ? null : <Badge tone="danger">Disabled</Badge>}
                        <Button variant="ghost" size="sm" onClick={() => openEdit(teacher)} aria-label={`Edit ${teacher.fullName}`}>
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => resetPassword(teacher)} aria-label={`Reset password for ${teacher.fullName}`}>
                          <KeyRound className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setActive(teacher, !teacher.isActive)}>
                          {teacher.isActive ? 'Disable' : 'Enable'}
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {teachers.some((teacher) => teacher.lastLoginAt) ? (
        <p className="text-xs text-slate-500">
          Last sign-in recorded:{' '}
          {teachers
            .filter((teacher) => teacher.lastLoginAt)
            .slice(0, 1)
            .map((teacher) => `${teacher.fullName} · ${formatDate(teacher.lastLoginAt)}`)
            .join('')}
        </p>
      ) : null}

      <Modal
        open={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? `Edit ${editing.fullName}` : 'Add a teacher'}
        description="Teachers sign in with the email address below. Learners never receive accounts."
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
            <Button type="submit" form="teacher-form" loading={pending}>
              {editing ? 'Save changes' : 'Create teacher'}
            </Button>
          </>
        }
      >
        <form id="teacher-form" className="space-y-4" onSubmit={save}>
          {formError ? <ErrorState message={formError} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} />
            </Field>
            <Field label="Email address" required>
              <Input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </Field>
            <Field label="Phone" hint="Format +2547XXXXXXXX">
              <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+2547..." />
            </Field>
            <Field label="Staff number" required>
              <Input required value={form.staffNumber} onChange={(event) => setForm({ ...form, staffNumber: event.target.value })} placeholder="TSC/2026/014" />
            </Field>
            <Field label="TSC number">
              <Input value={form.tscNumber} onChange={(event) => setForm({ ...form, tscNumber: event.target.value })} />
            </Field>
            <Field label="National ID">
              <Input value={form.nationalId} onChange={(event) => setForm({ ...form, nationalId: event.target.value })} />
            </Field>
            <Field label="Employment type">
              <Select value={form.employmentType} onChange={(event) => setForm({ ...form, employmentType: event.target.value })}>
                {EMPLOYMENT.map((type) => (
                  <option key={type} value={type}>
                    {titleCase(type)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Specialisation">
              <Input value={form.specialization} onChange={(event) => setForm({ ...form, specialization: event.target.value })} placeholder="Mathematics & Science" />
            </Field>
            <Field label="Max periods per day" hint="Hard cap the timetable engine will respect">
              <Input type="number" min={1} max={16} value={form.maxPeriodsPerDay} onChange={(event) => setForm({ ...form, maxPeriodsPerDay: event.target.value })} />
            </Field>
            <Field label="Max periods per week">
              <Input type="number" min={1} max={80} value={form.maxPeriodsPerWeek} onChange={(event) => setForm({ ...form, maxPeriodsPerWeek: event.target.value })} />
            </Field>
            <Field label="Qualifications" className="sm:col-span-2">
              <Input value={form.qualifications} onChange={(event) => setForm({ ...form, qualifications: event.target.value })} placeholder="B.Ed (Science)" />
            </Field>
            {!editing ? (
              <Field label="Temporary password" hint="Leave blank and the system generates one, shown once" className="sm:col-span-2">
                <Input
                  type="text"
                  value={tempPassword}
                  onChange={(event) => setTempPassword(event.target.value)}
                  placeholder="At least 12 characters with mixed case and a symbol"
                />
              </Field>
            ) : null}
          </div>

          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Preferred free days (soft preference)</legend>
            <div className="grid gap-2 sm:grid-cols-4">
              {[1, 2, 3, 4, 5].map((day) => (
                <Checkbox
                  key={day}
                  label={dayName(day)}
                  checked={freeDays.includes(day)}
                  onChange={(event) =>
                    setFreeDays((prev) => (event.target.checked ? [...prev, day].slice(0, 3) : prev.filter((value) => value !== day)))
                  }
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">A preference, not a guarantee — the engine reports when it cannot honour one.</p>
          </fieldset>
        </form>
      </Modal>

      <Modal
        open={importing}
        onClose={() => setImporting(false)}
        title="Import teaching staff"
        description="Fill in the CSV template and validate it before anything is written. Each row creates one teacher account."
        footer={
          <Button variant="ghost" onClick={() => setImporting(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-3">
          <Note tone="info" title="Before you import">
            <p>Email addresses must be unique. Rows with problems are reported back and skipped — no partial records are left behind for a failed row.</p>
          </Note>
          <CsvImport
            endpoint="/teachers/import"
            templatePath="/teachers/import/template"
            entityLabel="staff"
            onImported={() => {
              setImporting(false);
              void reload();
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
