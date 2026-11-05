'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  Copy,
  Info,
  Play,
  Rocket,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/hooks';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, ErrorState, Field, Input, Modal, Note, PageHeader, ProgressBar, Select, Skeleton, StatCard, StatusBadge, Table, Tabs, Td, Th, buttonClass, useToast } from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/utils';
import type { AcademicYear, ClassSummary, Timetable, TimetableConflict, TimetableDiagnostic, TimetablePreflight, TimetableVersionSummary } from '@/lib/types';

/**
 * Shape returned by POST /timetables/generate. A failed pre-flight comes back
 * with status FAILED and the blocking diagnostics rather than throwing, so the
 * UI can show exactly what to fix.
 */
interface GenerateResult {
  jobId: string;
  status: 'COMPLETED' | 'FAILED';
  timetableId?: string;
  versionId?: string;
  versionNumber?: number;
  assigned: number;
  unplaced: number;
  conflicts: TimetableConflict[];
  diagnostics: TimetableDiagnostic[];
  stats: Record<string, number | string>;
  feasibility?: { feasible: boolean; blockingIssues?: TimetableDiagnostic[]; warnings?: TimetableDiagnostic[] };
  durationMs: number;
  message: string;
}

interface ConflictRow extends TimetableConflict {
  id?: string;
  period?: { label: string; startTime: string; endTime: string } | null;
  entryId?: string | null;
}

export default function TimetableWorkspacePage() {
  const toast = useToast();
  const [tab, setTab] = useState('overview');

  const years = useApiQuery<AcademicYear[]>('/school/academic-years');
  const preflight = useApiQuery<TimetablePreflight>('/timetables/preflight');
  const timetables = useApiQuery<Timetable[]>('/timetables', { query: { pageSize: 50 } });

  const currentYear = years.data?.find((year) => year.isCurrent) ?? years.data?.[0];
  const currentTermId = currentYear?.terms?.find((term) => term.isCurrent)?.id ?? currentYear?.terms?.[0]?.id ?? '';

  const [classIds, setClassIds] = useState<string[]>([]);
  const [config, setConfig] = useState({
    seed: '20261013',
    maxConsecutiveSameArea: '2',
    maxConsecutiveTeacherPeriods: '4',
    balanceDailyLoad: true,
    avoidTeacherGaps: true,
    respectTeacherFreeDays: true,
    useRooms: false,
    preferDoubleLessons: false,
  });
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [publishing, setPublishing] = useState<TimetableVersionSummary | null>(null);
  const [publishNotes, setPublishNotes] = useState('');
  const [pending, setPending] = useState(false);

  const classes = useApiQuery<ClassSummary[]>('/classes', { query: { pageSize: 100 } });
  const selectedClassIds = classIds.length ? classIds : (classes.data ?? []).map((klass) => klass.id);

  const activeTimetable = useMemo(
    () => (timetables.data ?? []).find((item) => item.termId === currentTermId) ?? (timetables.data ?? [])[0],
    [timetables.data, currentTermId],
  );

  const versions = useMemo<TimetableVersionSummary[]>(() => activeTimetable?.versions ?? [], [activeTimetable]);

  // The conflicts endpoint returns a flat list with class/teacher/period context.
  const conflicts = useApiQuery<ConflictRow[]>(activeTimetable?.currentVersionId ? `/timetables/${activeTimetable.currentVersionId}/conflicts` : null);
  const conflictRows = Array.isArray(conflicts.data) ? conflicts.data : [];

  const blocking = preflight.data?.issues?.filter((issue) => issue.severity === 'ERROR') ?? [];
  const warnings = preflight.data?.issues?.filter((issue) => issue.severity === 'WARNING') ?? [];

  const generate = async () => {
    if (!currentYear || !currentTermId) {
      toast.error('No term selected', 'Create the current academic year and term first.');
      return;
    }
    setGenerating(true);
    setResult(null);
    try {
      const payload = {
        academicYearId: currentYear.id,
        termId: currentTermId,
        classIds: selectedClassIds,
        keepLockedEntries: true,
        config: {
          seed: config.seed ? Number(config.seed) : undefined,
          maxConsecutiveSameArea: Number(config.maxConsecutiveSameArea),
          maxConsecutiveTeacherPeriods: Number(config.maxConsecutiveTeacherPeriods),
          balanceDailyLoad: config.balanceDailyLoad,
          avoidTeacherGaps: config.avoidTeacherGaps,
          respectTeacherFreeDays: config.respectTeacherFreeDays,
          useRooms: config.useRooms,
          preferDoubleLessons: config.preferDoubleLessons,
        },
      };
      const generated = await api.post<GenerateResult>('/timetables/generate', payload);
      setResult(generated);
      setResultOpen(true);
      await timetables.reload();
      await conflicts.reload();
      toast[generated.status === 'FAILED' ? 'error' : generated.unplaced ? 'warning' : 'success'](
        generated.status === 'FAILED' ? 'Generation refused' : 'Generation finished',
        generated.status === 'FAILED' ? generated.message : `${generated.assigned} lesson(s) placed${generated.unplaced ? `, ${generated.unplaced} unplaced` : ''}.`,
      );
    } catch (caught) {
      toast.error('Generation failed', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setGenerating(false);
    }
  };

  const validateVersion = async (version: TimetableVersionSummary) => {
    setPending(true);
    try {
      const validation = await api.post<{ validated: boolean; conflicts: TimetableConflict[]; summary: { errors: number; warnings: number } }>(
        `/timetables/${version.id}/validate`,
        {},
      );
      toast[validation.validated ? 'success' : 'error'](
        validation.validated ? 'Validation passed' : 'Validation found blocking conflicts',
        `${validation.summary?.errors ?? 0} error(s) · ${validation.summary?.warnings ?? 0} warning(s) · ${validation.conflicts?.length ?? 0} conflict row(s).`,
      );
      await timetables.reload();
      await conflicts.reload();
    } catch (caught) {
      toast.error('Validation failed to run', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const publish = async () => {
    if (!activeTimetable || !publishing) return;
    setPending(true);
    try {
      await api.post('/timetables/publish', { versionId: publishing.id, notes: publishNotes || null });
      toast.success('Timetable published', 'Teachers and guardians can now see it.');
      setPublishing(null);
      setPublishNotes('');
      await timetables.reload();
    } catch (caught) {
      toast.error('Publishing refused', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const unpublish = async (version: TimetableVersionSummary) => {
    if (!window.confirm('Unpublish this timetable? Teachers and guardians will stop seeing a current timetable until another version is published.')) return;
    try {
      await api.post(`/timetables/versions/${version.id}/unpublish`, {});
      toast.success('Timetable unpublished');
      await timetables.reload();
    } catch (caught) {
      toast.error('Could not unpublish', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const duplicate = async (version: TimetableVersionSummary) => {
    try {
      const copy = await api.post<{ id: string }>(`/timetables/versions/${version.id}/duplicate`, {});
      toast.success('Draft copy created', 'Edit the draft, revalidate and publish when ready.');
      await timetables.reload();
      return copy;
    } catch (caught) {
      toast.error('Could not duplicate', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const currentVersion = activeTimetable?.currentVersion ?? versions.find((version) => version.isCurrent) ?? versions[0];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Timetable workspace"
        description="Generate a whole-school timetable from real class, teacher and room data — then review, adjust, validate and publish."
        actions={
          <>
            {activeTimetable && currentVersion ? (
              <Link
                href={`/timetable/${currentVersion.id}`}
                className={buttonClass('outline', 'sm')}
              >
                <CalendarClock className="h-4 w-4" aria-hidden /> Open grid
              </Link>
            ) : null}
            <Button size="sm" onClick={generate} loading={generating}>
              <Play className="h-4 w-4" aria-hidden /> Generate timetable
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Bell schedule"
          value={`${preflight.data?.teachingSlotCount ?? 0} slots`}
          hint={preflight.data ? `${preflight.data.school.workingDays.length} teaching day(s) · max ${preflight.data.school.maxPeriodsPerDay}/day` : ''}
          icon={<CalendarClock className="h-5 w-5" aria-hidden />}
        />
        <StatCard label="Classes to schedule" value={preflight.data?.classes.length ?? 0} hint={`${preflight.data?.assignments.length ?? 0} teaching assignments`} />
        <StatCard
          label="Blocking issues"
          value={blocking.length}
          tone={blocking.length ? 'danger' : 'success'}
          hint={blocking.length ? 'Generation is refused until these are fixed' : 'Ready to generate'}
          icon={blocking.length ? <AlertTriangle className="h-5 w-5" aria-hidden /> : <BadgeCheck className="h-5 w-5" aria-hidden />}
        />
        <StatCard
          label="Published version"
          value={activeTimetable?.status === 'PUBLISHED' ? `v${currentVersion?.versionNumber ?? 1}` : 'None'}
          hint={activeTimetable?.publishedAt ? formatRelative(activeTimetable.publishedAt) : 'Not published yet'}
          tone={activeTimetable?.status === 'PUBLISHED' ? 'success' : 'warning'}
        />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Generate', badge: blocking.length ? '!' : undefined },
          { id: 'versions', label: 'Versions', badge: versions.length || undefined },
          { id: 'conflicts', label: 'Conflicts', badge: conflictRows.length || undefined },
          { id: 'history', label: 'History' },
        ]}
      />

      {tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Readiness checks"
                description="The engine validates the inputs before it schedules anything. Blocking issues are never silently skipped."
              />
              <CardBody className="space-y-3">
                {preflight.loading ? (
                  <Skeleton className="h-32" />
                ) : preflight.error ? (
                  <ErrorState message={preflight.error} onRetry={() => preflight.reload()} />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={preflight.data?.ready ? 'success' : 'danger'}>
                        {preflight.data?.ready ? 'Ready to generate' : `${preflight.data?.blockingIssueCount ?? 0} blocking issue(s)`}
                      </Badge>
                      {preflight.data?.warningCount ? <Badge tone="warning">{preflight.data.warningCount} warning(s)</Badge> : null}
                    </div>
                    {blocking.length ? (
                      <ul className="space-y-2">
                        {blocking.map((issue, index) => (
                          <li key={index} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                            <p className="font-semibold">{issue.message}</p>
                            {issue.suggestion ? <p className="mt-0.5">Fix: {issue.suggestion}</p> : null}
                            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-rose-700/80">{issue.code}</p>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {warnings.length ? (
                      <ul className="space-y-2">
                        {warnings.map((issue, index) => (
                          <li key={index} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            <p className="font-semibold">{issue.message}</p>
                            {issue.suggestion ? <p className="mt-0.5">Suggestion: {issue.suggestion}</p> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {!blocking.length && !warnings.length ? (
                      <p className="text-sm text-success-strong">Every class has requirements, learners and a teacher for each learning area.</p>
                    ) : null}
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Class readiness" description="A class can only be scheduled if its weekly requirements fit inside the teaching week." />
              <CardBody>
                <Table>
                  <thead>
                    <tr>
                      <Th>Class</Th>
                      <Th>Learners</Th>
                      <Th>Required periods</Th>
                      <Th>Fit</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(preflight.data?.classes ?? []).map((klass) => {
                      const percent = klass.capacity ? (klass.requiredPeriods / klass.capacity) * 100 : 0;
                      return (
                        <tr key={klass.classId}>
                          <Td className="font-medium text-slate-800">{klass.className}</Td>
                          <Td>{klass.learners}</Td>
                          <Td>
                            {klass.requiredPeriods} / {klass.capacity}
                          </Td>
                          <Td>
                            <ProgressBar value={percent} tone={klass.feasible ? (percent > 95 ? 'warning' : 'success') : 'danger'} />
                            {!klass.feasible ? <span className="text-[11px] text-rose-700">{klass.issue ?? 'Does not fit the week'}</span> : null}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Generation settings" description="Soft preferences guide the solver; hard constraints are always enforced." />
            <CardBody className="space-y-3">
              <Field label="Academic year">
                <Input readOnly value={currentYear?.name ?? '—'} />
              </Field>
              <Field label="Term" hint="Only the current term is generated at a time">
                <Input readOnly value={currentYear?.terms?.find((term) => term.id === currentTermId)?.name ?? '—'} />
              </Field>
              <Field label="Classes to include" hint={`${selectedClassIds.length} of ${classes.data?.length ?? 0} selected`}>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {(classes.data ?? []).map((klass) => (
                    <Checkbox
                      key={klass.id}
                      label={`${klass.name} (${klass.learnerCount ?? 0} learners)`}
                      checked={selectedClassIds.includes(klass.id)}
                      onChange={(event) =>
                        setClassIds((prev) => {
                          const base = prev.length ? prev : (classes.data ?? []).map((item) => item.id);
                          return event.target.checked ? [...base, klass.id] : base.filter((id) => id !== klass.id);
                        })
                      }
                    />
                  ))}
                </div>
              </Field>
              <Field label="Random seed" hint="Same seed and data produce the same timetable — generation is reproducible. Leave blank for a fresh attempt.">
                <Input value={config.seed} onChange={(event) => setConfig({ ...config, seed: event.target.value })} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Max same subject in a row">
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={config.maxConsecutiveSameArea}
                    onChange={(event) => setConfig({ ...config, maxConsecutiveSameArea: event.target.value })}
                  />
                </Field>
                <Field label="Max teacher periods in a row">
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={config.maxConsecutiveTeacherPeriods}
                    onChange={(event) => setConfig({ ...config, maxConsecutiveTeacherPeriods: event.target.value })}
                  />
                </Field>
              </div>
              <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                <Checkbox label="Spread lessons evenly across the week" checked={config.balanceDailyLoad} onChange={(event) => setConfig({ ...config, balanceDailyLoad: event.target.checked })} />
                <Checkbox label="Avoid gaps in a teacher's day" checked={config.avoidTeacherGaps} onChange={(event) => setConfig({ ...config, avoidTeacherGaps: event.target.checked })} />
                <Checkbox
                  label="Respect preferred free days"
                  checked={config.respectTeacherFreeDays}
                  onChange={(event) => setConfig({ ...config, respectTeacherFreeDays: event.target.checked })}
                />
                <Checkbox label="Use rooms and check room clashes" checked={config.useRooms} onChange={(event) => setConfig({ ...config, useRooms: event.target.checked })} />
                <Checkbox label="Prefer double lessons where requested" checked={config.preferDoubleLessons} onChange={(event) => setConfig({ ...config, preferDoubleLessons: event.target.checked })} />
              </div>
              <Button className="w-full" loading={generating} onClick={generate} disabled={Boolean(blocking.length)}>
                <Sparkles className="h-4 w-4" aria-hidden /> Generate from live data
              </Button>
              {blocking.length ? <p className="text-xs text-rose-700">Resolve the blocking issues above first — the engine will not guess.</p> : null}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === 'versions' ? (
        <Card>
          <CardHeader
            title="Version history"
            description="Draft → validated → published → superseded. Only one version is current at a time, and nothing is ever overwritten."
            actions={
              <Button variant="outline" size="sm" onClick={() => timetables.reload()}>
                Refresh
              </Button>
            }
          />
          <CardBody>
            {timetables.loading ? (
              <Skeleton className="h-40" />
            ) : versions.length === 0 ? (
              <EmptyState title="No timetable versions yet" description="Generate the first draft from the panel on the Generate tab." icon={<CalendarClock className="h-6 w-6" aria-hidden />} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Version</Th>
                    <Th>Status</Th>
                    <Th>Lessons</Th>
                    <Th>Conflicts</Th>
                    <Th>Generated</Th>
                    <Th>Published</Th>
                    <Th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {versions
                    .slice()
                    .sort((a, b) => b.versionNumber - a.versionNumber)
                    .map((version) => (
                      <tr key={version.id} className={version.isCurrent ? 'bg-success-soft/40' : undefined}>
                        <Td>
                          <span className="font-medium text-slate-800">v{version.versionNumber}</span>
                          {version.isCurrent ? <Badge tone="success" className="ml-2">current</Badge> : null}
                          {version.notes ? <span className="block max-w-md truncate text-xs text-slate-500">{version.notes}</span> : null}
                        </Td>
                        <Td>
                          <StatusBadge status={version.status} />
                        </Td>
                        <Td>{version.entryCount}</Td>
                        <Td>
                          {version.conflictCount ? (
                            <Badge tone="danger">{version.conflictCount}</Badge>
                          ) : (
                            <span className="text-xs text-success-strong">none</span>
                          )}
                        </Td>
                        <Td className="text-xs text-slate-500">{formatDateTime(version.generatedAt)}</Td>
                        <Td className="text-xs text-slate-500">
                          {version.publishedAt ? formatDateTime(version.publishedAt) : '—'}
                          {version.publishedByName ? <span className="block text-[11px]">by {version.publishedByName}</span> : null}
                        </Td>
                        <Td>
                          <div className="flex flex-wrap justify-end gap-1">
                            <Link
                              href={`/timetable/${version.id}`}
                              className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold text-royal transition-colors duration-120 hover:bg-royal-soft"
                            >
                              Open
                            </Link>
                            <Button variant="ghost" size="sm" onClick={() => validateVersion(version)} loading={pending}>
                              <ShieldCheck className="h-4 w-4" aria-hidden /> Validate
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => duplicate(version)}>
                              <Copy className="h-4 w-4" aria-hidden /> Duplicate
                            </Button>
                            {version.status === 'PUBLISHED' ? (
                              <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50" onClick={() => unpublish(version)}>
                                <Undo2 className="h-4 w-4" aria-hidden /> Unpublish
                              </Button>
                            ) : (
                              <Button variant="secondary" size="sm" onClick={() => setPublishing(version)}>
                                <Rocket className="h-4 w-4" aria-hidden /> Publish
                              </Button>
                            )}
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

      {tab === 'conflicts' ? (
        <Card>
          <CardHeader
            title="Conflict panel"
            description="Hard-constraint breaches with the suggested resolution. A version with blocking conflicts cannot be published."
            actions={
              <Button variant="outline" size="sm" onClick={() => conflicts.reload()}>
                Re-check
              </Button>
            }
          />
          <CardBody className="space-y-2">
            {!activeTimetable?.currentVersionId ? (
              <EmptyState title="No version to check yet" />
            ) : conflicts.loading ? (
              <Skeleton className="h-32" />
            ) : conflictRows.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success-strong">
                <BadgeCheck className="h-4 w-4" aria-hidden /> No conflicts detected in the current version.
              </p>
            ) : (
              conflictRows.map((conflict, index) => (
                <div
                  key={index}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    conflict.severity === 'ERROR' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'
                  }`}
                >
                  <p className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                    {conflict.message}
                  </p>
                  <p className="mt-0.5">
                    {conflict.dayOfWeek ? `Day ${conflict.dayOfWeek}` : ''} {conflict.sequence ? `· period ${conflict.sequence}` : ''}{' '}
                    {conflict.className ? `· ${conflict.className}` : ''} {conflict.teacherName ? `· ${conflict.teacherName}` : ''}
                  </p>
                  {conflict.suggestion ? <p className="mt-1">Suggested fix: {conflict.suggestion}</p> : null}
                  <p className="mt-0.5 text-[11px] uppercase tracking-wide opacity-70">{conflict.code}</p>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'history' ? (
        <Card>
          <CardHeader
            title="Audit history"
            description="Every generation, edit, validation and publication is recorded with who did it and when."
            actions={<ScrollText className="h-4 w-4 text-slate-400" aria-hidden />}
          />
          <CardBody>
            {!activeTimetable ? (
              <EmptyState title="No timetable record yet" />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {versions
                  .slice()
                  .sort((a, b) => b.versionNumber - a.versionNumber)
                  .map((version) => (
                    <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <span className="font-medium text-slate-800">v{version.versionNumber}</span>{' '}
                        <StatusBadge status={version.status} className="ml-1" />
                        {version.isCurrent ? <Badge tone="success" className="ml-1">current</Badge> : null}
                        <span className="block text-xs text-slate-500">
                          {version.entryCount} lessons · generated {formatDateTime(version.generatedAt)}
                          {version.supersededAt ? ` · superseded ${formatDateTime(version.supersededAt)}` : ''}
                        </span>
                      </span>
                      <span className="text-xs text-slate-500">
                        {version.publishedAt ? `published ${formatDateTime(version.publishedAt)}` : 'never published'}
                        {version.publishedByName ? ` by ${version.publishedByName}` : ''}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* ---------------------------------------------------- result modal */}
      <Modal
        open={resultOpen && Boolean(result)}
        onClose={() => setResultOpen(false)}
        title="Generation result"
        description="What the engine produced, and anything it could not place."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResultOpen(false)}>
              Close
            </Button>
            {result?.versionId ? (
              <Link
                href={`/timetable/${result.versionId}`}
                className={buttonClass('primary', 'md')}
              >
                <CalendarClock className="h-4 w-4" aria-hidden /> Review the draft
              </Link>
            ) : null}
          </>
        }
      >
        {result ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Lessons placed" value={result.assigned} tone="success" />
              <StatCard label="Unplaced lessons" value={result.unplaced} tone={result.unplaced ? 'warning' : 'success'} />
              <StatCard
                label="Diagnostics"
                value={result.diagnostics?.length ?? 0}
                tone={result.diagnostics?.some((item) => item.severity === 'ERROR') ? 'danger' : 'neutral'}
              />
            </div>

            {result.stats ? (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Solver statistics</p>
                <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  {Object.entries(result.stats).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-slate-500">{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
                      <dd className="font-medium text-slate-800">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            <Note tone={result.status === 'FAILED' ? 'warning' : result.unplaced ? 'warning' : 'success'} title={result.status === 'FAILED' ? 'Generation was not started' : result.unplaced ? 'Some lessons could not be placed' : 'All lessons placed'}>
              <p>{result.message}</p>
              {result.feasibility?.blockingIssues?.length ? (
                <ul className="mt-1 list-disc pl-4">
                  {result.feasibility.blockingIssues.map((item, index) => (
                    <li key={index}>{item.message}</li>
                  ))}
                </ul>
              ) : null}
            </Note>

            {result.diagnostics?.length ? (
              <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
                {result.diagnostics.map((item, index) => (
                  <li
                    key={index}
                    className={`rounded border px-2 py-1 ${
                      item.severity === 'ERROR' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'
                    }`}
                  >
                    <span className="font-semibold">{item.message}</span>
                    {item.suggestion ? <span className="block">Fix: {item.suggestion}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* --------------------------------------------------- publish modal */}
      <Modal
        open={Boolean(publishing)}
        onClose={() => setPublishing(null)}
        title={`Publish version v${publishing?.versionNumber ?? ''}`}
        description="Publication runs the full conflict check first. If anything blocks it, nothing is published."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPublishing(null)}>
              Cancel
            </Button>
            <Button onClick={publish} loading={pending}>
              <Rocket className="h-4 w-4" aria-hidden /> Publish
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Note tone="info" title="What publishing does">
            <ul className="list-disc space-y-0.5 pl-4">
              <li>Teachers see their own lessons and their classes&apos; timetables.</li>
              <li>Guardians see their linked learner&apos;s class timetable.</li>
              <li>The previous published version is marked superseded — it stays available for audit.</li>
            </ul>
          </Note>
          <Field label="Note for the record" hint="Optional, shown in the version history">
            <Input value={publishNotes} onChange={(event) => setPublishNotes(event.target.value)} placeholder="Published after the staff meeting on…" />
          </Field>
          {publishing?.conflictCount ? (
            <Note tone="warning" title={`${publishing.conflictCount} conflict(s) on this version`}>
              <p>Publishing will be refused while blocking conflicts remain. Open the grid and use the conflict panel to resolve them.</p>
            </Note>
          ) : null}
          <p className="flex items-start gap-2 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5" aria-hidden />
            Only administrators can publish. Manual edits re-run validation immediately so an invalid grid cannot be saved as published.
          </p>
        </div>
      </Modal>
    </div>
  );
}
