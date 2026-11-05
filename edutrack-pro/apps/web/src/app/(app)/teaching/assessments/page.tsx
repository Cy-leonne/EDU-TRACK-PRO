'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, ListChecks, Plus, Search } from 'lucide-react';
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
  ProgressBar,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
  Table,
  Tabs,
  Td,
  Th,
  Textarea,
  useToast,
} from '@/components/ui';
import { formatDate } from '@/lib/utils';
import type { AcademicYear, Assessment, AssessmentCategory, ClassSummary, LearningArea, Rubric, Strand } from '@/lib/types';

interface TeacherContext {
  classes: Array<{ id: string; name: string; gradeName?: string }>;
  learningAreas: LearningArea[];
  assessments?: { recent?: Assessment[] };
}

export default function AssessmentsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('list');
  const [status, setStatus] = useState('');
  const [classId, setClassId] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);

  const context = useApiQuery<TeacherContext>('/dashboard/teacher');
  const dashboard = useApiQuery<{ counts?: { upcomingDue: number; drafts: number; published: number; awaitingReview: number }; missingResults?: Assessment[] }>('/assessments/dashboard');
  const assessments = useApiQuery<Assessment[]>('/assessments', {
    query: { status: status || undefined, classId: classId || undefined, search: debounced || undefined, pageSize: 100 },
  });

  const categories = useApiQuery<AssessmentCategory[]>('/assessments/categories');
  const rubrics = useApiQuery<Rubric[]>('/assessments/rubrics');
  const years = useApiQuery<AcademicYear[]>('/school/academic-years');

  const currentYear = years.data?.find((year) => year.isCurrent) ?? years.data?.[0];
  const currentTerm = currentYear?.terms?.find((term) => term.isCurrent) ?? currentYear?.terms?.[0];

  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    instructions: '',
    classId: '',
    learningAreaId: '',
    categoryId: '',
    strandId: '',
    subStrandId: '',
    rubricId: '',
    assessmentDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    totalMarks: '20',
    usesMarks: true,
    usesRubric: false,
    isExternallyReported: false,
  });

  const strands = useApiQuery<Strand[]>(form.learningAreaId ? '/learning-areas/strands' : null, {
    query: form.learningAreaId ? { learningAreaId: form.learningAreaId } : undefined,
  });

  const list = useMemo(() => assessments.data ?? [], [assessments.data]);

  const openCreate = () => {
    setForm({
      title: '',
      description: '',
      instructions: '',
      classId: context.data?.classes?.[0]?.id ?? '',
      learningAreaId: context.data?.learningAreas?.[0]?.id ?? '',
      categoryId: categories.data?.[0]?.id ?? '',
      strandId: '',
      subStrandId: '',
      rubricId: '',
      assessmentDate: new Date().toISOString().slice(0, 10),
      dueDate: '',
      totalMarks: '20',
      usesMarks: true,
      usesRubric: false,
      isExternallyReported: false,
    });
    setError(null);
    setCreating(true);
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentYear || !currentTerm) {
      setError('The school calendar is not set up yet. Ask an administrator to open the current year and term.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const created = await api.post<Assessment>('/assessments', {
        title: form.title,
        description: form.description || null,
        instructions: form.instructions || null,
        academicYearId: currentYear.id,
        termId: currentTerm.id,
        classId: form.classId,
        learningAreaId: form.learningAreaId,
        categoryId: form.categoryId,
        strandId: form.strandId || null,
        subStrandId: form.subStrandId || null,
        rubricId: form.usesRubric ? form.rubricId || null : null,
        assessmentDate: form.assessmentDate,
        dueDate: form.dueDate || null,
        totalMarks: form.usesMarks && form.totalMarks ? Number(form.totalMarks) : null,
        usesMarks: form.usesMarks,
        usesRubric: form.usesRubric,
        isExternallyReported: form.isExternallyReported,
      });
      toast.success('Assessment created', 'Now record the results for each learner.');
      setCreating(false);
      await assessments.reload();
      await dashboard.reload();
      if (created?.id) window.location.href = `/teaching/assessments/${created.id}`;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the assessment.');
    } finally {
      setPending(false);
    }
  };

  const selectedClass = context.data?.classes?.find((klass) => klass.id === form.classId);
  const classLearningAreas = useMemo(() => {
    // Only learning areas the teacher actually teaches this class are offered.
    const areas = context.data?.learningAreas ?? [];
    return areas;
  }, [context.data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assessments"
        description="Competency-based assessments tied to strands and sub-strands, with a draft → review → published → corrected lifecycle."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden /> New assessment
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Drafts" value={dashboard.data?.counts?.drafts ?? 0} hint="Not yet visible to guardians" />
        <StatCard label="Awaiting review" value={dashboard.data?.counts?.awaitingReview ?? 0} tone={(dashboard.data?.counts?.awaitingReview ?? 0) ? 'warning' : 'neutral'} />
        <StatCard label="Published" value={dashboard.data?.counts?.published ?? 0} tone="success" hint="Guardians can see these" />
        <StatCard label="Missing result entries" value={dashboard.data?.missingResults?.length ?? 0} tone={(dashboard.data?.missingResults?.length ?? 0) ? 'warning' : 'success'} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'list', label: 'All assessments', badge: list.length || undefined },
          { id: 'missing', label: 'Missing results', badge: dashboard.data?.missingResults?.length || undefined },
        ]}
      />

      {tab === 'list' ? (
        <Card>
          <CardHeader
            title="Assessments you can work on"
            description="Only assessments for classes you teach appear here."
            actions={
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
                  <Input className="w-full pl-8 sm:w-52" placeholder="Search title" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search assessments" />
                </div>
                <Select className="w-full sm:w-40" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
                  <option value="">Any status</option>
                  {['DRAFT', 'READY_FOR_REVIEW', 'PUBLISHED', 'CORRECTED', 'ARCHIVED'].map((value) => (
                    <option key={value} value={value}>
                      {value.replace(/_/g, ' ').toLowerCase()}
                    </option>
                  ))}
                </Select>
                <Select className="w-full sm:w-44" value={classId} onChange={(event) => setClassId(event.target.value)} aria-label="Filter by class">
                  <option value="">All my classes</option>
                  {(context.data?.classes ?? []).map((klass) => (
                    <option key={klass.id} value={klass.id}>
                      {klass.name}
                    </option>
                  ))}
                </Select>
              </div>
            }
          />
          <CardBody>
            {assessments.loading ? (
              <Skeleton className="h-40" />
            ) : assessments.error ? (
              <ErrorState message={assessments.error} onRetry={() => assessments.reload()} />
            ) : list.length === 0 ? (
              <EmptyState
                title="No assessments yet"
                description="Create your first assessment to start recording outcomes against strands."
                action={
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4" aria-hidden /> New assessment
                  </Button>
                }
                icon={<ClipboardCheck className="h-6 w-6" aria-hidden />}
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Assessment</Th>
                    <Th>Class & area</Th>
                    <Th>Date</Th>
                    <Th>Category</Th>
                    <Th>Results</Th>
                    <Th>Status</Th>
                    <Th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((assessment) => (
                    <tr key={assessment.id} className="hover:bg-slate-50">
                      <Td>
                        <Link href={`/teaching/assessments/${assessment.id}`} className="font-medium text-slate-800 hover:text-royal hover:underline">
                          {assessment.title}
                        </Link>
                        {assessment.strandName ? <span className="block text-xs text-slate-500">{assessment.strandName}{assessment.subStrandName ? ` · ${assessment.subStrandName}` : ''}</span> : null}
                      </Td>
                      <Td>
                        <span className="block text-sm text-slate-700">{assessment.className}</span>
                        <span className="block text-xs text-slate-500">{assessment.learningAreaName}</span>
                      </Td>
                      <Td className="text-xs text-slate-600">{formatDate(assessment.assessmentDate)}</Td>
                      <Td className="text-xs text-slate-600">{assessment.categoryName}</Td>
                      <Td className="w-40">
                        {assessment.resultSummary ? (
                          <>
                            <ProgressBar
                              value={assessment.resultSummary.completionPercent}
                              tone={assessment.resultSummary.completionPercent === 100 ? 'success' : assessment.resultSummary.entered ? 'warning' : 'danger'}
                            />
                            <span className="text-[11px] text-slate-500">
                              {assessment.resultSummary.entered}/{assessment.resultSummary.totalLearners} entered
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>
                        <StatusBadge status={assessment.status} />
                      </Td>
                      <Td>
                        <div className="flex justify-end">
                          <Link href={`/teaching/assessments/${assessment.id}`} className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold text-royal transition-colors duration-120 hover:bg-royal-soft">
                            Open
                          </Link>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'missing' ? (
        <Card>
          <CardHeader title="Assessments awaiting results" description="Learners without a recorded outcome." />
          <CardBody className="space-y-2">
            {(dashboard.data?.missingResults?.length ?? 0) === 0 ? (
              <EmptyState title="Nothing outstanding" description="Every assessment you own has complete result entry." icon={<ListChecks className="h-6 w-6" aria-hidden />} />
            ) : (
              dashboard.data?.missingResults?.map((assessment) => (
                <Link
                  key={assessment.id}
                  href={`/teaching/assessments/${assessment.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{assessment.title}</span>
                    <span className="block text-xs text-slate-500">
                      {assessment.className} · {assessment.learningAreaName} · {formatDate(assessment.assessmentDate)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {assessment.resultSummary ? <Badge tone="warning">{assessment.resultSummary.missing} missing</Badge> : null}
                    <StatusBadge status={assessment.status} />
                  </span>
                </Link>
              ))
            )}
          </CardBody>
        </Card>
      ) : null}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New assessment"
        description="Record outcomes against a strand so progress can be tracked over time."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" form="assessment-form" loading={pending}>
              Create assessment
            </Button>
          </>
        }
      >
        <form id="assessment-form" className="space-y-3" onSubmit={create}>
          {error ? <ErrorState message={error} /> : null}
          <Field label="Title" required>
            <Input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Numbers and algebra CAT" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Class" required>
              <Select required value={form.classId} onChange={(event) => setForm({ ...form, classId: event.target.value })}>
                <option value="">Select a class</option>
                {(context.data?.classes ?? []).map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Learning area" required>
              <Select required value={form.learningAreaId} onChange={(event) => setForm({ ...form, learningAreaId: event.target.value, strandId: '', subStrandId: '' })}>
                <option value="">Select a learning area</option>
                {classLearningAreas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category" required>
              <Select required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
                <option value="">Select a category</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" required>
              <Input type="date" required value={form.assessmentDate} onChange={(event) => setForm({ ...form, assessmentDate: event.target.value })} />
            </Field>
            <Field label="Strand" hint="Optional, but recommended for CBE tracking">
              <Select
                value={form.strandId}
                onChange={(event) => setForm({ ...form, strandId: event.target.value, subStrandId: '' })}
                disabled={!form.learningAreaId}
              >
                <option value="">Not linked to a strand</option>
                {(strands.data ?? []).map((strand) => (
                  <option key={strand.id} value={strand.id}>
                    {strand.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sub-strand">
              <Select value={form.subStrandId} onChange={(event) => setForm({ ...form, subStrandId: event.target.value })} disabled={!form.strandId}>
                <option value="">Not linked to a sub-strand</option>
                {(strands.data ?? []).find((strand) => strand.id === form.strandId)?.subStrands?.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due date" hint="Used to flag late hand-ins">
              <Input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
            </Field>
            <Field label="Total marks" hint="Required when marking numerically">
              <Input
                type="number"
                min={1}
                max={10000}
                value={form.totalMarks}
                onChange={(event) => setForm({ ...form, totalMarks: event.target.value })}
                disabled={!form.usesMarks}
              />
            </Field>
          </div>

          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <Checkbox label="Record numerical marks" checked={form.usesMarks} onChange={(event) => setForm({ ...form, usesMarks: event.target.checked })} />
            <Checkbox label="Assess against a rubric" checked={form.usesRubric} onChange={(event) => setForm({ ...form, usesRubric: event.target.checked })} />
            {form.usesRubric ? (
              <Field label="Rubric">
                <Select value={form.rubricId} onChange={(event) => setForm({ ...form, rubricId: event.target.value })}>
                  <option value="">Select a rubric</option>
                  {(rubrics.data ?? []).map((rubric) => (
                    <option key={rubric.id} value={rubric.id}>
                      {rubric.title ?? rubric.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Checkbox
              label="This assessment is reported to an external body (flagged for the record only)"
              checked={form.isExternallyReported}
              onChange={(event) => setForm({ ...form, isExternallyReported: event.target.checked })}
            />
          </div>

          <Field label="Description">
            <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What the assessment covers" />
          </Field>
          <Field label="Instructions for learners">
            <Textarea value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} placeholder="Attempt all questions…" />
          </Field>

          {currentTerm ? (
            <Note tone="info" title={`Recording into ${currentYear?.name} · ${currentTerm.name}`}>
              <p>Change the current year or term in School settings if this assessment belongs to a different period.</p>
            </Note>
          ) : (
            <Note tone="warning" title="No current term">
              <p>The school calendar has no current year/term. Ask an administrator to set it before creating assessments.</p>
            </Note>
          )}
        </form>
      </Modal>

      {selectedClass ? <p className="text-xs text-slate-500">Selected class: {selectedClass.name}</p> : null}
    </div>
  );
}
