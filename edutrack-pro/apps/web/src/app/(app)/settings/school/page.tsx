'use client';

import { BRAND_DEFAULTS } from '@/lib/theme';
import { useEffect, useState } from 'react';
import { Building2, Clock, Palette, Save } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/hooks';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ErrorState,
  Field,
  Input,
  Note,
  PageHeader,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  useToast,
} from '@/components/ui';
import { useSession } from '@/lib/session';
import { dayName } from '@/lib/utils';
import type { SchoolProfile, TimetablePeriod } from '@/lib/types';

const TIMEZONES = ['Africa/Nairobi', 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Kigali', 'UTC'];

export default function SchoolSettingsPage() {
  const toast = useToast();
  const { refreshSchool } = useSession();
  const profile = useApiQuery<SchoolProfile>('/school/profile');
  const years = useApiQuery<Array<{ id: string; name: string; isCurrent: boolean; terms?: Array<{ id: string; name: string; isCurrent: boolean }> }>>('/school/academic-years');
  const periods = useApiQuery<TimetablePeriod[]>('/timetables/periods');
  const defaultBell = useApiQuery<{ periods: Array<{ dayOfWeek: number; sequence: number; label: string; startTime: string; endTime: string; isBreak: boolean; isLunch: boolean; isTeaching: boolean }> }>('/timetables/periods/default');

  const [form, setForm] = useState<Partial<SchoolProfile>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termId, setTermId] = useState('');
  const [bellPending, setBellPending] = useState(false);

  useEffect(() => {
    if (profile.data) setForm(profile.data);
  }, [profile.data]);

  useEffect(() => {
    if (!termId) {
      const current = years.data?.find((year) => year.isCurrent)?.terms?.find((term) => term.isCurrent);
      if (current) setTermId(current.id);
    }
  }, [years.data, termId]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.patch('/school/profile', {
        name: form.name,
        code: form.code,
        addressLine: form.addressLine,
        county: form.county,
        phone: form.phone,
        email: form.email,
        website: form.website,
        motto: form.motto,
        portalName: form.portalName,
        primaryColor: form.primaryColor,
        accentColor: form.accentColor,
        timezone: form.timezone,
        currency: form.currency,
        workingDays: form.workingDays,
        schoolOpenTime: form.schoolOpenTime,
        schoolCloseTime: form.schoolCloseTime,
        maxPeriodsPerDay: form.maxPeriodsPerDay ? Number(form.maxPeriodsPerDay) : undefined,
        currentAcademicYearId: form.currentAcademicYearId || undefined,
        currentTermId: form.currentTermId || undefined,
      });
      toast.success('School settings saved');
      await profile.reload();
      await refreshSchool();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Saving failed.');
    } finally {
      setPending(false);
    }
  };

  const applyBellSchedule = async () => {
    if (!termId) {
      toast.error('Choose a term first');
      return;
    }
    setBellPending(true);
    try {
      const suggestion = defaultBell.data?.periods ?? [];
      await api.post('/timetables/periods', {
        academicYearId: years.data?.find((year) => year.terms?.some((term) => term.id === termId))?.id,
        termId,
        periods: suggestion.map((period) => ({
          dayOfWeek: period.dayOfWeek,
          sequence: period.sequence,
          label: period.label,
          startTime: period.startTime,
          endTime: period.endTime,
          isBreak: period.isBreak,
          isLunch: period.isLunch,
          isTeaching: period.isTeaching,
        })),
      });
      toast.success('Bell schedule applied', 'You can fine-tune individual periods in the table below.');
      await periods.reload();
    } catch (caught) {
      toast.error('Could not apply the schedule', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBellPending(false);
    }
  };

  if (profile.loading) return <Skeleton className="h-96" />;
  if (profile.error) return <ErrorState message={profile.error} onRetry={() => profile.reload()} />;

  const teachingSlots = new Set((periods.data ?? []).filter((period) => period.isTeaching && !period.isBreak && !period.isLunch).map((period) => `${period.dayOfWeek}-${period.sequence}`));

  return (
    <div className="space-y-4">
      <PageHeader
        title="School settings"
        description="Identity, branding, the school day and the current academic context. These values drive every other screen."
        actions={
          <Button size="sm" form="school-form" type="submit" loading={pending}>
            <Save className="h-4 w-4" aria-hidden /> Save settings
          </Button>
        }
      />

      <form id="school-form" className="grid gap-4 lg:grid-cols-2" onSubmit={save}>
        {error ? (
          <div className="lg:col-span-2">
            <ErrorState message={error} />
          </div>
        ) : null}

        <Card>
          <CardHeader title="School identity" description="Shown to staff and guardians." />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="School name" required className="sm:col-span-2">
              <Input required value={form.name ?? ''} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label="School code" hint="Unique for this installation">
              <Input value={form.code ?? ''} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} />
            </Field>
            <Field label="Portal name" hint="Usually a shorter version of the school name">
              <Input value={form.portalName ?? ''} onChange={(event) => setForm({ ...form, portalName: event.target.value })} />
            </Field>
            <Field label="County">
              <Input value={form.county ?? ''} onChange={(event) => setForm({ ...form, county: event.target.value })} />
            </Field>
            <Field label="Physical address">
              <Input value={form.addressLine ?? ''} onChange={(event) => setForm({ ...form, addressLine: event.target.value })} />
            </Field>
            <Field label="Office phone">
              <Input value={form.phone ?? ''} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="+2547..." />
            </Field>
            <Field label="Office email">
              <Input type="email" value={form.email ?? ''} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </Field>
            <Field label="Motto" className="sm:col-span-2">
              <Input value={form.motto ?? ''} onChange={(event) => setForm({ ...form, motto: event.target.value })} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Branding & locale" description="Colours are applied across the interface for this school." />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="Primary colour">
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-10 w-14 rounded border border-slate-300"
                  value={form.primaryColor ?? BRAND_DEFAULTS.primary}
                  onChange={(event) => setForm({ ...form, primaryColor: event.target.value })}
                  aria-label="Primary colour"
                />
                <Input value={form.primaryColor ?? ''} onChange={(event) => setForm({ ...form, primaryColor: event.target.value })} />
              </span>
            </Field>
            <Field label="Accent colour">
              <span className="flex items-center gap-2">
                <input
                  type="color"
                  className="h-10 w-14 rounded border border-slate-300"
                  value={form.accentColor ?? BRAND_DEFAULTS.accent}
                  onChange={(event) => setForm({ ...form, accentColor: event.target.value })}
                  aria-label="Accent colour"
                />
                <Input value={form.accentColor ?? ''} onChange={(event) => setForm({ ...form, accentColor: event.target.value })} />
              </span>
            </Field>
            <Field label="Time zone" hint="Dates and times are shown in this zone">
              <Select value={form.timezone ?? 'Africa/Nairobi'} onChange={(event) => setForm({ ...form, timezone: event.target.value })}>
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Currency">
              <Input value={form.currency ?? 'KES'} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} maxLength={3} />
            </Field>
            <Field label="Academic year in use" className="sm:col-span-2">
              <Select
                value={form.currentAcademicYearId ?? ''}
                onChange={(event) => setForm({ ...form, currentAcademicYearId: event.target.value, currentTermId: '' })}
              >
                <option value="">Not set</option>
                {(years.data ?? []).map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name} {year.isCurrent ? '(current)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Term in use" className="sm:col-span-2">
              <Select value={form.currentTermId ?? ''} onChange={(event) => setForm({ ...form, currentTermId: event.target.value })}>
                <option value="">Not set</option>
                {(years.data ?? []).flatMap((year) =>
                  (year.terms ?? []).map((term) => (
                    <option key={term.id} value={term.id}>
                      {year.name} · {term.name}
                    </option>
                  )),
                )}
              </Select>
            </Field>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="The school day" description="Working days and the daily lesson limits the timetable engine must respect." />
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="School opens">
              <Input type="time" value={form.schoolOpenTime ?? '07:30'} onChange={(event) => setForm({ ...form, schoolOpenTime: event.target.value })} />
            </Field>
            <Field label="School closes">
              <Input type="time" value={form.schoolCloseTime ?? '16:30'} onChange={(event) => setForm({ ...form, schoolCloseTime: event.target.value })} />
            </Field>
            <Field label="Default period length (minutes)">
              <Input
                type="number"
                min={20}
                max={90}
                value={form.defaultPeriodMinutes ?? 40}
                onChange={(event) => setForm({ ...form, defaultPeriodMinutes: Number(event.target.value) })}
              />
            </Field>
            <Field label="Max teaching periods per day">
              <Input
                type="number"
                min={1}
                max={16}
                value={form.maxPeriodsPerDay ?? 8}
                onChange={(event) => setForm({ ...form, maxPeriodsPerDay: Number(event.target.value) })}
              />
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Working days</p>
              <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                  <Checkbox
                    key={day}
                    label={dayName(day)}
                    checked={(form.workingDays ?? []).includes(day)}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        workingDays: event.target.checked
                          ? [...(form.workingDays ?? []), day].sort((a, b) => a - b)
                          : (form.workingDays ?? []).filter((value) => value !== day),
                      })
                    }
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">Lessons are only ever scheduled on these days.</p>
            </div>
          </CardBody>
        </Card>
      </form>

      <Card>
        <CardHeader
          title="Bell schedule"
          description="The daily period structure for the selected term, including breaks and lunch."
          actions={
            <>
              <Select className="w-full sm:w-56" value={termId} onChange={(event) => setTermId(event.target.value)} aria-label="Term">
                <option value="">Select a term</option>
                {(years.data ?? []).flatMap((year) =>
                  (year.terms ?? []).map((term) => (
                    <option key={term.id} value={term.id}>
                      {year.name} · {term.name}
                    </option>
                  )),
                )}
              </Select>
              <Button size="sm" variant="secondary" onClick={applyBellSchedule} loading={bellPending}>
                <Clock className="h-4 w-4" aria-hidden /> Apply suggested day
              </Button>
            </>
          }
        />
        <CardBody>
          {periods.loading ? (
            <Skeleton className="h-40" />
          ) : (periods.data ?? []).length === 0 ? (
            <Note tone="info" title="No periods configured yet">
              <p>
                Apply the suggested day to create a standard junior-school day (7:30 start, short break, lunch, eight teaching periods), or add periods
                individually through the API.
              </p>
            </Note>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-500">
                {teachingSlots.size} teaching slot(s) across {(periods.data ?? []).length} period records.
              </p>
              <Table>
                <thead>
                  <tr>
                    <Th>Day</Th>
                    <Th>Sequence</Th>
                    <Th>Label</Th>
                    <Th>Start</Th>
                    <Th>End</Th>
                    <Th>Type</Th>
                  </tr>
                </thead>
                <tbody>
                  {(periods.data ?? [])
                    .slice()
                    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.sequence - b.sequence)
                    .slice(0, 60)
                    .map((period) => (
                      <tr key={period.id}>
                        <Td>{dayName(period.dayOfWeek)}</Td>
                        <Td>{period.sequence}</Td>
                        <Td>{period.label}</Td>
                        <Td>{period.startTime}</Td>
                        <Td>{period.endTime}</Td>
                        <Td>
                          {period.isLunch ? (
                            <Badge tone="warning">lunch</Badge>
                          ) : period.isBreak ? (
                            <Badge tone="info">break</Badge>
                          ) : (
                            <Badge tone="success">lesson</Badge>
                          )}
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            </>
          )}
        </CardBody>
      </Card>

      <Note tone="info" title="Data protection reminders">
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Learners are records, not users: they never receive sign-in details.</li>
          <li>Guardian access always requires a verified link and shows only that learner.</li>
          <li>Results stay internal school records — they are never labelled as national outcomes.</li>
          <li>Audit entries record who changed what, without copying learner data into log text.</li>
        </ul>
      </Note>

      <Card>
        <CardHeader title="Branding preview" actions={<Palette className="h-4 w-4 text-slate-400" aria-hidden />} />
        <CardBody className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg px-4 py-2 text-sm text-white" style={{ backgroundColor: form.primaryColor ?? BRAND_DEFAULTS.primary }}>
            Primary button
          </span>
          <span className="rounded-lg px-4 py-2 text-sm text-white" style={{ backgroundColor: form.accentColor ?? BRAND_DEFAULTS.accent }}>
            Accent button
          </span>
          <span className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
            <Building2 className="h-4 w-4" aria-hidden /> {form.portalName || form.name || 'School portal'}
          </span>
        </CardBody>
      </Card>
    </div>
  );
}
