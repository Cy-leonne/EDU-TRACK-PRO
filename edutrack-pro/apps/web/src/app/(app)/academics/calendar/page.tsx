'use client';

import { useState } from 'react';
import { CalendarPlus, CheckCircle2, Plus, Unlock } from 'lucide-react';
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
  Skeleton,
  Table,
  Td,
  Th,
  useToast,
} from '@/components/ui';
import { formatDate } from '@/lib/utils';
import type { AcademicYear, Term } from '@/lib/types';

/**
 * Academic years and terms.
 *
 * The current year and current term drive every date-aware screen: assessment
 * defaults, timetable scope and the results-release gate for guardians.
 */
export default function CalendarPage() {
  const toast = useToast();
  const years = useApiQuery<AcademicYear[]>('/school/academic-years');
  const terms = useApiQuery<Term[]>('/school/terms');
  const [yearModal, setYearModal] = useState(false);
  const [termModal, setTermModal] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [yearForm, setYearForm] = useState({ name: '', startDate: '', endDate: '', isCurrent: false, notes: '' });
  const [termForm, setTermForm] = useState({ academicYearId: '', number: '1', name: '', startDate: '', endDate: '', isCurrent: true });

  const createYear = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    try {
      await api.post('/school/academic-years', { ...yearForm, notes: yearForm.notes || null });
      toast.success('Academic year created', yearForm.name);
      setYearModal(false);
      await years.reload();
      await terms.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Saving failed.');
    } finally {
      setPending(false);
    }
  };

  const createTerm = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    try {
      await api.post('/school/terms', { ...termForm, number: Number(termForm.number), name: termForm.name || `Term ${termForm.number}` });
      toast.success('Term created');
      setTermModal(false);
      await terms.reload();
      await years.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Saving failed.');
    } finally {
      setPending(false);
    }
  };

  const markCurrentTerm = async (term: Term) => {
    try {
      await api.patch(`/school/terms/${term.id}`, { isCurrent: true });
      toast.success('Current term updated', `${term.name} of ${term.academicYear?.name ?? ''}`);
      await terms.reload();
      await years.reload();
    } catch (caught) {
      toast.error('Could not switch terms', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const toggleResultsRelease = async (term: Term) => {
    const release = !term.resultsPublishedAt;
    if (release && !window.confirm(`Release ${term.name} results to guardians? They will see every published result for that term.`)) return;
    try {
      await api.post(`/school/terms/${term.id}/results-publication`, { published: release });
      toast.success(release ? 'Results released to guardians' : 'Results hidden from guardians', term.name);
      await terms.reload();
    } catch (caught) {
      toast.error('Could not change the release state', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const lockYear = async (year: AcademicYear) => {
    try {
      await api.patch(`/school/academic-years/${year.id}`, { isLocked: !year.isLocked });
      toast.success(year.isLocked ? 'Year unlocked' : 'Year locked', year.name);
      await years.reload();
    } catch (caught) {
      toast.error('Could not update the year', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Academic years & terms"
        description="Set the school calendar. The current term is the default for new assessments and the timetable."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setTermModal(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New term
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setYearForm({ name: String(new Date().getFullYear()), startDate: '', endDate: '', isCurrent: false, notes: '' });
                setYearModal(true);
              }}
            >
              <CalendarPlus className="h-4 w-4" aria-hidden /> New academic year
            </Button>
          </>
        }
      />

      <Note tone="info" title="How release works">
        <p>
          Publishing an assessment makes it visible to a linked guardian. Releasing a term is an additional gate the school uses at the end of term. Both
          are recorded in the audit log.
        </p>
      </Note>

      <Card>
        <CardHeader title="Academic years" description="Years hold the classes, enrolment and timetable scopes." />
        <CardBody>
          {years.loading ? (
            <Skeleton className="h-32" />
          ) : years.error ? (
            <ErrorState message={years.error} onRetry={() => years.reload()} />
          ) : (years.data ?? []).length === 0 ? (
            <EmptyState title="No academic year yet" description="Create the current year before adding classes." />
          ) : (
            <div className="space-y-3">
              {(years.data ?? []).map((year) => (
                <div key={year.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        {year.name}
                        {year.isCurrent ? <Badge tone="success">current</Badge> : null}
                        {year.isLocked ? <Badge tone="danger">locked</Badge> : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDate(year.startDate)} → {formatDate(year.endDate)} · {year.terms?.length ?? 0} term(s) ·{' '}
                        {year._count?.classes ?? 0} class(es)
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!year.isCurrent ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            await api.patch(`/school/academic-years/${year.id}`, { isCurrent: true });
                            toast.success('Current year changed', year.name);
                            await years.reload();
                          }}
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden /> Make current
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="sm" onClick={() => lockYear(year)}>
                        <Unlock className="h-4 w-4" aria-hidden /> {year.isLocked ? 'Unlock' : 'Lock'}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <Table>
                      <thead>
                        <tr>
                          <Th>Term</Th>
                          <Th>Dates</Th>
                          <Th>Assessments</Th>
                          <Th>Results to guardians</Th>
                          <Th>Current</Th>
                          <Th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {(year.terms ?? []).map((term) => (
                          <tr key={term.id}>
                            <Td className="font-medium text-slate-800">{term.name}</Td>
                            <Td className="text-xs text-slate-600">
                              {formatDate(term.startDate)} → {formatDate(term.endDate)}
                            </Td>
                            <Td>{term._count?.assessments ?? 0}</Td>
                            <Td>
                              {term.resultsPublishedAt ? (
                                <Badge tone="success">released {formatDate(term.resultsPublishedAt)}</Badge>
                              ) : (
                                <Badge tone="neutral">not released</Badge>
                              )}
                            </Td>
                            <Td>{term.isCurrent ? <Badge tone="success">current</Badge> : null}</Td>
                            <Td>
                              <div className="flex flex-wrap justify-end gap-1">
                                {!term.isCurrent ? (
                                  <Button variant="ghost" size="sm" onClick={() => markCurrentTerm(term)}>
                                    Set current
                                  </Button>
                                ) : null}
                                <Button variant={term.resultsPublishedAt ? 'ghost' : 'secondary'} size="sm" onClick={() => toggleResultsRelease(term)}>
                                  {term.resultsPublishedAt ? 'Hide from guardians' : 'Release results'}
                                </Button>
                              </div>
                            </Td>
                          </tr>
                        ))}
                        {(year.terms ?? []).length === 0 ? (
                          <tr>
                            <Td colSpan={6} className="text-center text-xs text-slate-500">
                              No terms yet for {year.name}.
                            </Td>
                          </tr>
                        ) : null}
                      </tbody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={yearModal}
        onClose={() => setYearModal(false)}
        title="New academic year"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setYearModal(false)}>
              Cancel
            </Button>
            <Button type="submit" form="year-form" loading={pending}>
              Create year
            </Button>
          </>
        }
      >
        <form id="year-form" className="space-y-3" onSubmit={createYear}>
          {formError ? <ErrorState message={formError} /> : null}
          <Field label="Name" required hint="Usually the calendar year, e.g. 2027">
            <Input required value={yearForm.name} onChange={(event) => setYearForm({ ...yearForm, name: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" required>
              <Input type="date" required value={yearForm.startDate} onChange={(event) => setYearForm({ ...yearForm, startDate: event.target.value })} />
            </Field>
            <Field label="Ends" required>
              <Input type="date" required value={yearForm.endDate} onChange={(event) => setYearForm({ ...yearForm, endDate: event.target.value })} />
            </Field>
          </div>
          <Checkbox label="Make this the current academic year" checked={yearForm.isCurrent} onChange={(event) => setYearForm({ ...yearForm, isCurrent: event.target.checked })} />
        </form>
      </Modal>

      <Modal
        open={termModal}
        onClose={() => setTermModal(false)}
        title="New term"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTermModal(false)}>
              Cancel
            </Button>
            <Button type="submit" form="term-form" loading={pending}>
              Create term
            </Button>
          </>
        }
      >
        <form id="term-form" className="space-y-3" onSubmit={createTerm}>
          {formError ? <ErrorState message={formError} /> : null}
          <Field label="Academic year" required>
            <select
              required
              value={termForm.academicYearId}
              onChange={(event) => setTermForm({ ...termForm, academicYearId: event.target.value })}
              className="h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
            >
              <option value="">Select a year</option>
              {(years.data ?? []).map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Term number" required>
              <Input type="number" min={1} max={3} required value={termForm.number} onChange={(event) => setTermForm({ ...termForm, number: event.target.value })} />
            </Field>
            <Field label="Term name" hint="Defaults to “Term N”">
              <Input value={termForm.name} onChange={(event) => setTermForm({ ...termForm, name: event.target.value })} placeholder="Term 1" />
            </Field>
            <Field label="Starts" required>
              <Input type="date" required value={termForm.startDate} onChange={(event) => setTermForm({ ...termForm, startDate: event.target.value })} />
            </Field>
            <Field label="Ends" required>
              <Input type="date" required value={termForm.endDate} onChange={(event) => setTermForm({ ...termForm, endDate: event.target.value })} />
            </Field>
          </div>
          <Checkbox label="Make this the current term" checked={termForm.isCurrent} onChange={(event) => setTermForm({ ...termForm, isCurrent: event.target.checked })} />
        </form>
      </Modal>
    </div>
  );
}
