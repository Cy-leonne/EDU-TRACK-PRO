'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FileDown, RefreshCw, ShieldCheck } from 'lucide-react';
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
  useToast,
} from '@/components/ui';
import { formatPercent } from '@/lib/utils';
import type { AcademicYear, SchoolReports } from '@/lib/types';

export default function ReportsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('reports');
  const years = useApiQuery<AcademicYear[]>('/school/academic-years');
  const [termId, setTermId] = useState('');
  const reports = useApiQuery<SchoolReports>('/reports/school', { query: { termId: termId || undefined } });
  const auditActions = useApiQuery<string[]>('/audit-logs/actions');

  const currentTermId = useMemo(
    () => termId || years.data?.find((year) => year.isCurrent)?.terms?.find((term) => term.isCurrent)?.id || '',
    [termId, years.data],
  );

  const download = async (path: string, fileName: string) => {
    try {
      const csv = await api.exportText(path, { termId: currentTermId || undefined });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded', `${fileName} — the download is recorded in the audit log.`);
    } catch (caught) {
      toast.error('Export failed', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const data = reports.data;

  const totals = useMemo(() => {
    if (!data) return null;
    const learners = (data.enrolmentByGrade ?? []).reduce((sum, row) => sum + row.learners, 0);
    const classes = (data.enrolmentByGrade ?? []).reduce((sum, row) => sum + row.classes.length, 0);
    const assessments = data.assessmentCompletion ?? [];
    const published = assessments.filter((row) => row.status === 'PUBLISHED').length;
    const entered = assessments.reduce((sum, row) => sum + row.entered, 0);
    const expected = assessments.reduce((sum, row) => sum + row.expected, 0);
    const overLimit = (data.teacherWorkload ?? []).filter((teacher) => teacher.overLimit).length;
    const workloadAverage = data.teacherWorkload?.length
      ? Math.round((data.teacherWorkload.reduce((sum, teacher) => sum + teacher.weeklyPeriods, 0) / data.teacherWorkload.length) * 10) / 10
      : 0;
    const gaps = (data.classCoverage ?? []).reduce((sum, row) => sum + (row.missingTeacherAssignments ?? 0), 0);
    const conflicts = (data.timetableCoverage ?? []).reduce(
      (sum, timetable) => sum + (timetable.versions ?? []).reduce((inner, version) => inner + (version.conflicts ?? 0), 0),
      0,
    );
    return { learners, classes, published, assessments: assessments.length, entered, expected, overLimit, workloadAverage, gaps, conflicts };
  }, [data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports & exports"
        description="School analytics plus audited CSV exports. Figures come from your own records — no national benchmarks are implied."
        actions={
          <>
            <Select className="w-full sm:w-56" value={termId} onChange={(event) => setTermId(event.target.value)} aria-label="Term">
              <option value="">Current term</option>
              {(years.data ?? []).flatMap((year) =>
                (year.terms ?? []).map((term) => (
                  <option key={term.id} value={term.id}>
                    {year.name} · {term.name}
                  </option>
                )),
              )}
            </Select>
            <Button size="sm" variant="outline" onClick={() => reports.reload()}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
            </Button>
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'reports', label: 'School report' },
          { id: 'exports', label: 'Data exports' },
        ]}
      />

      {tab === 'reports' ? (
        reports.loading ? (
          <Skeleton className="h-64" />
        ) : reports.error ? (
          <ErrorState message={reports.error} onRetry={() => reports.reload()} />
        ) : !data || !totals ? (
          <EmptyState title="No report data yet" description="Reports fill in as classes, assessments and timetables are set up." />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Learners enrolled" value={totals.learners} hint={`${totals.classes} classes · ${data.enrolmentByGrade?.length ?? 0} grades`} />
              <StatCard
                label="Result entry"
                value={formatPercent(totals.expected ? (totals.entered / totals.expected) * 100 : 0)}
                hint={`${totals.entered} of ${totals.expected} learner results entered`}
                tone={totals.expected && totals.entered / totals.expected > 0.9 ? 'success' : 'warning'}
              />
              <StatCard
                label="Published assessments"
                value={`${totals.published}/${totals.assessments}`}
                hint="Visible to linked guardians"
                tone={totals.assessments && totals.published / totals.assessments > 0.5 ? 'success' : 'warning'}
              />
              <StatCard
                label="Coverage gaps"
                value={totals.gaps}
                hint={`${totals.conflicts} timetable conflict(s) · ${totals.overLimit} teacher(s) over limit`}
                tone={totals.gaps || totals.conflicts ? 'danger' : 'success'}
              />
            </div>

            {data.academicContext ? (
              <p className="text-xs text-slate-500">
                Reporting period: {data.academicContext.academicYearName} · {data.academicContext.termName}
              </p>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Enrolment by grade" description="Active learners and class sizes." />
                <CardBody>
                  {(data.enrolmentByGrade?.length ?? 0) === 0 ? (
                    <EmptyState title="No enrolment data" />
                  ) : (
                    <div className="space-y-3">
                      {data.enrolmentByGrade?.map((grade) => (
                        <div key={grade.gradeName}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-slate-800">{grade.gradeName}</span>
                            <span className="text-slate-500">
                              {grade.learners} learners · {grade.classes.length} class(es)
                            </span>
                          </div>
                          <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                            {grade.classes.map((klass) => (
                              <li key={klass.classId} className="flex items-center justify-between">
                                <span>{klass.name}</span>
                                <span className={klass.capacity && klass.learners > klass.capacity ? 'font-medium text-rose-700' : ''}>
                                  {klass.learners}
                                  {klass.capacity ? ` / ${klass.capacity}` : ''}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Assessment status" description="Where every assessment currently sits." />
                <CardBody className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {Object.entries(data.assessmentStatus ?? {}).map(([status, count]) => (
                      <div key={status} className="rounded-lg border border-slate-200 p-2 text-center">
                        <p className="text-xs uppercase tracking-wide text-slate-500">{status}</p>
                        <p className="text-lg font-semibold text-slate-900">{count}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">
                    Completion counts learners with a recorded outcome. Draft assessments are never visible to guardians.
                  </p>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader title="Class coverage" description="Teaching assignments per class, and any learning area still without a teacher." />
              <CardBody>
                {(data.classCoverage?.length ?? 0) === 0 ? (
                  <EmptyState title="No classes yet" />
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Class</Th>
                        <Th>Learners</Th>
                        <Th>Learning areas required</Th>
                        <Th>Teachers assigned</Th>
                        <Th>Gaps</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.classCoverage?.map((row) => (
                        <tr key={row.classId}>
                          <Td className="font-medium text-slate-800">{row.className}</Td>
                          <Td>{row.learners}</Td>
                          <Td>{row.requiredLearningAreas}</Td>
                          <Td>{row.assignedTeachers}</Td>
                          <Td>
                            {row.missingTeacherAssignments ? (
                              <span className="flex flex-wrap gap-1">
                                <Badge tone="danger">{row.missingTeacherAssignments} missing</Badge>
                                {row.gaps?.slice(0, 2).map((gap) => (
                                  <Badge key={gap} tone="warning">
                                    {gap}
                                  </Badge>
                                ))}
                              </span>
                            ) : (
                              <Badge tone="success">complete</Badge>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </CardBody>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Teacher workload" description={`Average ${totals.workloadAverage} periods per teacher per week.`} />
                <CardBody>
                  {(data.teacherWorkload?.length ?? 0) === 0 ? (
                    <EmptyState title="No workload data" />
                  ) : (
                    <Table>
                      <thead>
                        <tr>
                          <Th>Teacher</Th>
                          <Th>Classes</Th>
                          <Th>Periods</Th>
                          <Th>Load</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.teacherWorkload
                          ?.slice()
                          .sort((a, b) => b.weeklyPeriods - a.weeklyPeriods)
                          .map((teacher) => {
                            const limit = teacher.maxPeriodsPerWeek ?? null;
                            const percent = limit ? (teacher.weeklyPeriods / limit) * 100 : 0;
                            return (
                              <tr key={teacher.teacherId}>
                                <Td>
                                  <span className="block text-sm text-slate-800">{teacher.teacherName}</span>
                                  <span className="block text-xs text-slate-400">{teacher.staffNumber}</span>
                                </Td>
                                <Td>{teacher.classes}</Td>
                                <Td>
                                  {teacher.weeklyPeriods}
                                  {limit ? ` / ${limit}` : ''}
                                </Td>
                                <Td className="w-32">
                                  <ProgressBar value={limit ? percent : teacher.weeklyPeriods * 3} tone={teacher.overLimit ? 'danger' : percent > 85 ? 'warning' : 'success'} />
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
                <CardHeader title="Timetable coverage" description="Versions, scheduled lessons and outstanding conflicts." />
                <CardBody className="space-y-3">
                  {(data.timetableCoverage?.length ?? 0) === 0 ? (
                    <EmptyState title="No timetable yet" description="Generate one from the timetable workspace." />
                  ) : (
                    data.timetableCoverage?.map((timetable) => (
                      <div key={timetable.timetableId} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-800">{timetable.name}</p>
                          <StatusBadge status={timetable.status} />
                        </div>
                        <ul className="mt-2 space-y-1 text-xs text-slate-600">
                          {timetable.versions?.map((version) => (
                            <li key={version.versionNumber} className="flex items-center justify-between">
                              <span>
                                v{version.versionNumber} · {version.status.toLowerCase()}
                              </span>
                              <span>
                                {version.entries} lessons ·{' '}
                                {version.conflicts ? <span className="font-medium text-rose-700">{version.conflicts} conflicts</span> : <span className="text-success-strong">no conflicts</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                  <p className="text-xs text-slate-500">
                    Full version history, conflicts and manual adjustment live in the{' '}
                    <Link href="/timetable" className="text-royal hover:underline">
                      timetable workspace
                    </Link>
                    .
                  </p>
                </CardBody>
              </Card>
            </div>
          </div>
        )
      ) : null}

      {tab === 'exports' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="CSV exports"
              description="Every download is scoped to this school and recorded in the audit log with your name and the time."
              actions={<ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden />}
            />
            <CardBody className="grid gap-3 sm:grid-cols-2">
              <ExportCard title="Learner register" description="Admission and assessment numbers, grade, class and guardian links." onDownload={() => download('/reports/export/learners.csv', 'learner-register.csv')} />
              <ExportCard title="Teaching staff" description="Staff and TSC numbers, workload limits, assignments and blocked slots." onDownload={() => download('/reports/export/teachers.csv', 'teaching-staff.csv')} />
              <ExportCard title="Assessment results" description="Every recorded result with the school's own achievement band." onDownload={() => download('/reports/export/results.csv', 'assessment-results.csv')} />
              <ExportCard title="Published timetable" description="One row per scheduled lesson with day, period, teacher and room." onDownload={() => download('/reports/export/timetable.csv', 'timetable.csv')} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recorded action types" description="Everything auditable in this school." />
            <CardBody>
              {auditActions.loading ? (
                <Skeleton className="h-24" />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(auditActions.data ?? []).map((action) => (
                    <Badge key={action} tone="neutral">
                      {action}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-slate-500">
                Full detail, including the actor and what changed, is on the{' '}
                <Link href="/audit" className="text-royal hover:underline">
                  audit log
                </Link>
                .
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Handling exported data" />
            <CardBody className="space-y-2 text-xs text-slate-600">
              <p>Exports contain personal data about children. Store them only where the school&apos;s data-protection policy allows, and delete local copies afterwards.</p>
              <p>Passwords, tokens and password hashes are never included in any export.</p>
              <p>
                Spreadsheet-safe: values beginning with <code>=</code>, <code>+</code>, <code>-</code> or <code>@</code> are prefixed so they cannot be evaluated
                as formulas.
              </p>
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function ExportCard({ title, description, onDownload }: { title: string; description: string; onDownload: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onDownload}>
        <FileDown className="h-4 w-4" aria-hidden /> CSV
      </Button>
    </div>
  );
}
