'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Building2, CalendarDays, GraduationCap, Lock, LockOpen, Rocket, ShieldCheck, Trash2, Users } from 'lucide-react';
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
  Select,
  Skeleton,
  StatusBadge,
  Tabs,
  useToast,
} from '@/components/ui';
import { MoveLessonForm, TimetableGrid } from '@/components/timetable-grid';
import { dayName, formatDateTime, titleCase } from '@/lib/utils';
import type { TimetableConflict, TimetableLesson, TimetablePeriod, TimetableVersionSummary } from '@/lib/types';

interface VersionView {
  version: TimetableVersionSummary & { timetableId?: string; validationSummary?: Record<string, number | string> | null };
  timetable?: { id: string; name: string; status: string; termName?: string | null; academicYearName?: string };
  periods: TimetablePeriod[];
  entries: TimetableLesson[];
  conflicts: TimetableConflict[];
  classes?: Array<{ id: string; name: string; gradeName?: string }>;
  teachers?: Array<{ id: string; name: string; staffNumber?: string }>;
  rooms?: Array<{ id: string; name: string; code?: string | null }>;
  diagnostics?: Array<{ code: string; severity: string; message: string; suggestion?: string | null }>;
  stats?: Record<string, number | string>;
}

export default function TimetableVersionPage() {
  const params = useParams<{ versionId: string }>();
  const versionId = params?.versionId;
  const toast = useToast();

  const view = useApiQuery<VersionView>(versionId ? `/timetables/versions/${versionId}` : null);
  const schoolGrid = useApiQuery<{ classes: Array<{ classId: string; className: string; weeklyPeriods: number; lessons: TimetableLesson[] }> }>(
    versionId ? `/timetables/versions/${versionId}/school-grid` : null,
  );

  const [tab, setTab] = useState('class');
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedTeacherName, setSelectedTeacherName] = useState('');
  const [selectedLesson, setSelectedLesson] = useState<TimetableLesson | null>(null);
  const [moveTarget, setMoveTarget] = useState<TimetableLesson | null>(null);
  const [pending, setPending] = useState(false);
  const [publishNotes, setPublishNotes] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);

  const periods = useMemo(() => view.data?.periods ?? [], [view.data]);
  // The API returns entries with `id`; the grid works with `entryId`, so normalise once here.
  const entries = useMemo<TimetableLesson[]>(
    () => (view.data?.entries ?? []).map((entry) => ({ ...entry, entryId: entry.entryId ?? entry.id })),
    [view.data],
  );
  const conflicts = view.data?.conflicts ?? [];
  const workingDays = useMemo(() => [...new Set(periods.map((period) => period.dayOfWeek))].sort((a, b) => a - b), [periods]);

  const classOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) if (entry.className) map.set(entry.className, entry.className);
    return [...map.values()].sort();
  }, [entries]);

  const teacherOptions = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) if (entry.teacherName) map.set(entry.teacherName, (map.get(entry.teacherName) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  const roomOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) if (entry.roomName) map.set(entry.roomName, entry.roomName);
    return [...map.values()].sort();
  }, [entries]);

  const isPublished = view.data?.version?.status === 'PUBLISHED' || view.data?.version?.status === 'SUPERSEDED';
  const stats = (view.data?.stats ?? view.data?.version?.validationSummary ?? {}) as Record<string, number | string>;
  const blockingConflicts = conflicts.filter((conflict) => conflict.severity === 'ERROR');

  const classEntries = useMemo(() => (selectedClassId ? entries.filter((entry) => entry.className === selectedClassId) : entries), [entries, selectedClassId]);
  const teacherEntries = useMemo(() => (selectedTeacherName ? entries.filter((entry) => entry.teacherName === selectedTeacherName) : []), [entries, selectedTeacherName]);

  const revalidate = async (silent = false) => {
    if (!versionId) return;
    try {
      const validation = await api.post<{ validated: boolean; summary: { errors: number; warnings: number } }>(`/timetables/${versionId}/validate`, {});
      if (!silent) {
        toast[validation.validated ? 'success' : 'warning'](
          validation.validated ? 'Validation passed' : 'Conflicts remain',
          `${validation.summary?.errors ?? 0} error(s) · ${validation.summary?.warnings ?? 0} warning(s).`,
        );
      }
      await view.reload();
    } catch (caught) {
      toast.error('Validation failed to run', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const moveLesson = async (target: { dayOfWeek: number; sequence: number; periodId: string }) => {
    if (!moveTarget?.entryId || !versionId) return;
    setPending(true);
    try {
      const result = await api.patch<{ conflicts?: TimetableConflict[]; warnings?: TimetableConflict[] }>('/timetables/entries/move', {
        versionId,
        entryId: moveTarget.entryId,
        dayOfWeek: target.dayOfWeek,
        periodId: target.periodId,
        sequence: target.sequence,
      });
      toast.success('Lesson moved', `Revalidated automatically: ${result?.conflicts?.length ?? 0} hard conflict(s).`);
      setMoveTarget(null);
      setSelectedLesson(null);
      await view.reload();
      await schoolGrid.reload();
    } catch (caught) {
      // The API refuses a move that would break a hard constraint — that is the
      // point of the check, so surface the reason verbatim.
      toast.error('Move rejected', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const toggleLock = async (lesson: TimetableLesson) => {
    if (!lesson.entryId) return;
    try {
      await api.patch(`/timetables/entries/${lesson.entryId}/lock`, { locked: !lesson.isLocked });
      toast.success(lesson.isLocked ? 'Lesson unlocked' : 'Lesson locked', 'Locked lessons are kept when the timetable is regenerated.');
      await view.reload();
    } catch (caught) {
      toast.error('Could not change the lock', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const deleteLesson = async (lesson: TimetableLesson) => {
    if (!lesson.entryId) return;
    if (!window.confirm('Remove this lesson from the draft? The requirement will show as unplaced until it is scheduled again.')) return;
    try {
      await api.del(`/timetables/entries/${lesson.entryId}`);
      toast.success('Lesson removed');
      setSelectedLesson(null);
      await view.reload();
      await schoolGrid.reload();
    } catch (caught) {
      toast.error('Could not remove the lesson', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const publish = async () => {
    if (!versionId) return;
    setPending(true);
    try {
      await api.post('/timetables/publish', { versionId, notes: publishNotes || null });
      toast.success('Timetable published', 'Teachers and guardians can now see it.');
      setPublishOpen(false);
      await view.reload();
    } catch (caught) {
      toast.error('Publishing refused', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  if (view.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (view.error || !view.data) {
    return <ErrorState message={view.error ?? 'This timetable version could not be loaded.'} onRetry={() => view.reload()} />;
  }

  const version = view.data.version;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Timetable · v${version.versionNumber}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={version.status} />
            {version.isCurrent ? <Badge tone="success">current</Badge> : null}
            <span>
              {view.data.timetable?.name} · {entries.length} lessons
              {version.publishedAt ? ` · published ${formatDateTime(version.publishedAt)}` : ''}
            </span>
          </span>
        }
        breadcrumb={
          <Link href="/timetable" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="h-3 w-3" aria-hidden /> Back to the workspace
          </Link>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => revalidate()}>
              <ShieldCheck className="h-4 w-4" aria-hidden /> Revalidate
            </Button>
            {isPublished ? (
              <Badge tone="info">
                <Lock className="h-3 w-3" aria-hidden /> read-only while published
              </Badge>
            ) : (
              <Button size="sm" onClick={() => setPublishOpen(true)} disabled={blockingConflicts.length > 0}>
                <Rocket className="h-4 w-4" aria-hidden /> Publish version
              </Button>
            )}
          </>
        }
      />

      {blockingConflicts.length ? (
        <Note tone="warning" title={`${blockingConflicts.length} blocking conflict(s) on this version`}>
          <ul className="space-y-1">
            {blockingConflicts.slice(0, 6).map((conflict, index) => (
              <li key={index}>
                <span className="font-medium">{conflict.message}</span>
                {conflict.suggestion ? <span className="block">Fix: {conflict.suggestion}</span> : null}
                <span className="block text-[11px]">
                  {conflict.dayOfWeek ? dayName(conflict.dayOfWeek) : ''} {conflict.className ? `· ${conflict.className}` : ''}{' '}
                  {conflict.teacherName ? `· ${conflict.teacherName}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1">Publication is blocked until every hard conflict is resolved.</p>
        </Note>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'class', label: 'By class', badge: classOptions.length || undefined },
          { id: 'teacher', label: 'By teacher', badge: teacherOptions.length || undefined },
          { id: 'school', label: 'Whole school', badge: schoolGrid.data?.classes?.length || undefined },
          { id: 'room', label: 'By room', badge: roomOptions.length || undefined },
        ]}
      />

      {tab === 'class' ? (
        <Card>
          <CardHeader
            title="Class timetable"
            description="Select a lesson to move, lock or remove it. Every edit is revalidated straight away."
            actions={
              <Select className="w-full sm:w-64" value={selectedClassId} onChange={(event) => setSelectedClassId(event.target.value)} aria-label="Choose a class">
                <option value="">All classes (overlaid)</option>
                {classOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            }
          />
          <CardBody className="space-y-3">
            {entries.length === 0 ? (
              <EmptyState title="This version has no lessons" description="Generate the timetable, or adjust the class requirements and generate again." icon={<CalendarDays className="h-6 w-6" aria-hidden />} />
            ) : (
              <>
                <TimetableGrid
                  periods={periods}
                  lessons={classEntries}
                  workingDays={workingDays}
                  conflicts={conflicts}
                  selectedEntryId={selectedLesson?.entryId ?? null}
                  onSelect={(lesson) => (isPublished ? setSelectedLesson(lesson) : setSelectedLesson(lesson))}
                />
                {selectedLesson ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {selectedLesson.learningAreaName} · {selectedLesson.className}
                        </p>
                        <p className="text-xs text-slate-500">
                          {dayName(selectedLesson.dayOfWeek)} · {selectedLesson.periodLabel} ({selectedLesson.startTime}–{selectedLesson.endTime})
                          {selectedLesson.teacherName ? ` · ${selectedLesson.teacherName}` : ''}
                          {selectedLesson.roomName ? ` · ${selectedLesson.roomName}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {isPublished ? (
                          <Badge tone="info">Published versions are read-only — duplicate this version to edit</Badge>
                        ) : (
                          <>
                            <Button size="sm" variant="secondary" onClick={() => setMoveTarget(selectedLesson)}>
                              Move lesson
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => toggleLock(selectedLesson)}>
                              {selectedLesson.isLocked ? <LockOpen className="h-4 w-4" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
                              {selectedLesson.isLocked ? 'Unlock' : 'Lock'}
                            </Button>
                            <Button size="sm" variant="ghost" className="text-rose-700 hover:bg-rose-50" onClick={() => deleteLesson(selectedLesson)}>
                              <Trash2 className="h-4 w-4" aria-hidden /> Remove
                            </Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setSelectedLesson(null)}>
                          Clear
                        </Button>
                      </div>
                    </div>
                    {moveTarget ? (
                      <div className="mt-3">
                        <p className="mb-1 text-xs font-medium text-slate-600">
                          The form alternative to dragging — the same validation applies:
                        </p>
                        <MoveLessonForm
                          lesson={moveTarget}
                          periods={periods}
                          workingDays={workingDays}
                          pending={pending}
                          onCancel={() => setMoveTarget(null)}
                          onSubmit={moveLesson}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Tip: select any lesson to see the move, lock and remove controls.</p>
                )}
              </>
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'teacher' ? (
        <Card>
          <CardHeader
            title="Teacher timetable"
            description="A teacher's personal weekly view. Hard constraints guarantee no double-booking."
            actions={
              <Select className="w-full sm:w-64" value={selectedTeacherName} onChange={(event) => setSelectedTeacherName(event.target.value)} aria-label="Choose a teacher">
                <option value="">Select a teacher</option>
                {teacherOptions.map(([name, count]) => (
                  <option key={name} value={name}>
                    {name} ({count} periods)
                  </option>
                ))}
              </Select>
            }
          />
          <CardBody>
            {!selectedTeacherName ? (
              <EmptyState title="Choose a teacher" description="Their week appears here, colour-coded by learning area." icon={<GraduationCap className="h-6 w-6" aria-hidden />} />
            ) : teacherEntries.length === 0 ? (
              <EmptyState title="No lessons for this teacher in this version" />
            ) : (
              <>
                <TimetableGrid periods={periods} lessons={teacherEntries} workingDays={workingDays} conflicts={conflicts} />
                <p className="mt-2 text-xs text-slate-500">
                  {teacherEntries.length} periods this week, {new Set(teacherEntries.map((entry) => entry.dayOfWeek)).size} teaching day(s).
                </p>
              </>
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'school' ? (
        <Card>
          <CardHeader title="Whole-school grid" description="Every class side by side — used to spot clashes across the school quickly." />
          <CardBody className="space-y-4">
            {schoolGrid.loading ? (
              <Skeleton className="h-40" />
            ) : (schoolGrid.data?.classes ?? []).length === 0 ? (
              <EmptyState title="Nothing to show yet" />
            ) : (
              schoolGrid.data?.classes.map((klass) => (
                <div key={klass.classId}>
                  <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Users className="h-4 w-4 text-slate-400" aria-hidden /> {klass.className}
                    <span className="text-xs font-normal text-slate-500">{klass.weeklyPeriods} periods / week</span>
                  </p>
                  <TimetableGrid periods={periods} lessons={klass.lessons} workingDays={workingDays} conflicts={conflicts} showClass={false} />
                </div>
              ))
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'room' ? (
        <Card>
          <CardHeader
            title="Room usage"
            description="Only available when rooms are allocated to lessons. Room clashes are reported as hard conflicts."
            actions={<Building2 className="h-4 w-4 text-slate-400" aria-hidden />}
          />
          <CardBody className="space-y-4">
            {roomOptions.length === 0 ? (
              <EmptyState
                title="No rooms allocated in this version"
                description="Enable “check room clashes” when generating, after creating rooms and marking them as required for specific learning areas."
              />
            ) : (
              roomOptions.map((room) => (
                <div key={room}>
                  <p className="mb-1 text-sm font-semibold text-slate-800">{room}</p>
                  <TimetableGrid
                    periods={periods}
                    lessons={entries.filter((entry) => entry.roomName === room)}
                    workingDays={workingDays}
                    conflicts={conflicts}
                    showClass
                  />
                </div>
              ))
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Version statistics" description="Quality signals recorded when this version was generated." />
        <CardBody className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(stats).length === 0 ? (
            <p className="text-xs text-slate-500">No statistics recorded for this version.</p>
          ) : (
            Object.entries(stats).map(([key, value]) => (
              <div key={key}>
                <p className="text-xs uppercase tracking-wide text-slate-500">{titleCase(key.replace(/([A-Z])/g, ' $1'))}</p>
                <p className="font-medium text-slate-800">{String(value)}</p>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      {view.data.diagnostics?.length ? (
        <Card>
          <CardHeader title="Engine diagnostics" description="What the solver could not fully honour, and the trade-offs it made." />
          <CardBody className="space-y-2">
            {view.data.diagnostics.map((item, index) => (
              <div
                key={index}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  item.severity === 'ERROR' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {item.message}
                </p>
                {item.suggestion ? <p className="mt-0.5">Suggestion: {item.suggestion}</p> : null}
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Modal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title={`Publish version v${version.versionNumber}`}
        description="Publication runs the full conflict check first; a version with hard conflicts cannot be published."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button onClick={publish} loading={pending}>
              <Rocket className="h-4 w-4" aria-hidden /> Publish
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Note for the record">
            <Input value={publishNotes} onChange={(event) => setPublishNotes(event.target.value)} placeholder="Optional note stored with the version" />
          </Field>
          <p className="text-xs text-slate-500">
            The previously published version is marked superseded and stays available for audit. Teachers and guardians see this version immediately.
          </p>
        </div>
      </Modal>
    </div>
  );
}
