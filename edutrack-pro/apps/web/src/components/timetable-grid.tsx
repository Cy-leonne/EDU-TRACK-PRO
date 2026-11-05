'use client';

import { useMemo } from 'react';
import { Lock, Move, TriangleAlert } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { colorFor, contrastText, dayShort, dayName } from '@/lib/utils';
import type { TimetableConflict, TimetableLesson, TimetablePeriod } from '@/lib/types';

export interface GridCell {
  period: TimetablePeriod;
  lessons: TimetableLesson[];
}

/**
 * Weekly timetable grid.
 *
 * Cells are colour-coded per learning area and are keyboard reachable: when
 * `onSelect` is provided each lesson becomes a button (the accessible
 * alternative to dragging), and `onMove` enables explicit move controls used by
 * the manual-edit workspace.
 */
export function TimetableGrid({
  periods,
  lessons,
  workingDays,
  conflicts = [],
  showClass = true,
  onSelect,
  selectedEntryId,
}: {
  periods: TimetablePeriod[];
  lessons: TimetableLesson[];
  workingDays: number[];
  conflicts?: TimetableConflict[];
  showClass?: boolean;
  onSelect?: (lesson: TimetableLesson) => void;
  selectedEntryId?: string | null;
}) {
  const days = workingDays.length ? [...workingDays].sort((a, b) => a - b) : [1, 2, 3, 4, 5];

  const byCell = useMemo(() => {
    const map = new Map<string, TimetableLesson[]>();
    for (const lesson of lessons) {
      const key = `${lesson.dayOfWeek}-${lesson.sequence}`;
      const list = map.get(key) ?? [];
      list.push(lesson);
      map.set(key, list);
    }
    return map;
  }, [lessons]);

  const conflictEntries = useMemo(() => {
    const ids = new Set<string>();
    for (const conflict of conflicts) for (const id of conflict.entryIds ?? []) ids.add(id);
    return ids;
  }, [conflicts]);

  // Period rows are keyed by sequence because every day shares the bell schedule.
  const sequences = useMemo(() => {
    const map = new Map<number, TimetablePeriod>();
    for (const period of periods) if (!map.has(period.sequence)) map.set(period.sequence, period);
    return [...map.values()].sort((a, b) => a.sequence - b.sequence);
  }, [periods]);

  if (!sequences.length) {
    return <p className="text-sm text-slate-500">No bell schedule configured for this term yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-2 py-2 text-left font-semibold text-slate-600">Period</th>
            {days.map((day) => (
              <th key={day} className="border-b border-slate-200 bg-slate-50 px-2 py-2 text-left font-semibold text-slate-600">
                <span className="hidden sm:inline">{dayName(day)}</span>
                <span className="sm:hidden">{dayShort(day)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sequences.map((period) => {
            const isNonTeaching = !period.isTeaching || period.isBreak || period.isLunch;
            if (isNonTeaching) {
              return (
                <tr key={period.sequence}>
                  <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-2 py-1.5 text-slate-500">
                    {period.startTime}–{period.endTime}
                  </td>
                  <td colSpan={days.length} className="border-b border-slate-100 bg-slate-100/70 px-2 py-1.5 text-center font-medium uppercase tracking-wide text-slate-500">
                    {period.label}
                  </td>
                </tr>
              );
            }
            return (
              <tr key={period.sequence}>
                <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-2 py-1.5 align-top text-slate-500">
                  <span className="font-medium text-slate-700">{period.label}</span>
                  <br />
                  {period.startTime}–{period.endTime}
                </td>
                {days.map((day) => {
                  const cell = byCell.get(`${day}-${period.sequence}`) ?? [];
                  return (
                    <td key={day} className="min-w-[9rem] border border-slate-100 p-1 align-top">
                      {cell.length === 0 ? <span className="block px-1 py-2 text-center text-slate-300">·</span> : null}
                      <div className="space-y-1">
                        {cell.map((lesson) => {
                          const color = colorFor(lesson.learningAreaName, lesson.learningAreaColor);
                          const hasConflict = Boolean(lesson.entryId && conflictEntries.has(lesson.entryId));
                          const body = (
                            <span className="block text-left">
                              <span className="block truncate font-semibold" style={{ color: contrastText(color) }}>
                                {lesson.learningAreaName}
                              </span>
                              {showClass && lesson.className ? <span className="block truncate opacity-90">{lesson.className}</span> : null}
                              {lesson.teacherName ? <span className="block truncate opacity-80">{lesson.teacherName}</span> : null}
                              {lesson.roomName ? <span className="block truncate opacity-80">{lesson.roomName}</span> : null}
                              <span className="mt-0.5 flex flex-wrap items-center gap-1">
                                {lesson.isDoubleLesson ? <Badge tone="info" className="!px-1 !py-0 !text-[10px]">double</Badge> : null}
                                {lesson.isLocked ? <Lock className="h-3 w-3" aria-label="Locked" /> : null}
                                {hasConflict ? <TriangleAlert className="h-3 w-3 text-rose-200" aria-label="Conflict" /> : null}
                              </span>
                            </span>
                          );
                          const base = 'block w-full rounded-md px-1.5 py-1 text-[11px] leading-tight shadow-sm transition';
                          const style = { backgroundColor: color, color: contrastText(color) };
                          if (!onSelect) {
                            return (
                              <span key={lesson.entryId ?? `${lesson.learningAreaName}-${day}-${period.sequence}`} className={base} style={style}>
                                {body}
                              </span>
                            );
                          }
                          return (
                            <button
                              key={lesson.entryId ?? `${lesson.learningAreaName}-${day}-${period.sequence}-btn`}
                              type="button"
                              onClick={() => onSelect(lesson)}
                              aria-pressed={selectedEntryId ? lesson.entryId === selectedEntryId : undefined}
                              className={`${base} focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                                selectedEntryId === lesson.entryId ? 'ring-2 ring-slate-900 ring-offset-1' : 'hover:brightness-110'
                              } ${hasConflict ? 'ring-2 ring-rose-500' : ''}`}
                              style={style}
                            >
                              {body}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Explicit move control: the keyboard/form alternative to drag-and-drop. */
export function MoveLessonForm({
  lesson,
  periods,
  workingDays,
  onSubmit,
  onCancel,
  pending,
}: {
  lesson: TimetableLesson;
  periods: TimetablePeriod[];
  workingDays: number[];
  onSubmit: (target: { dayOfWeek: number; sequence: number; periodId: string }) => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const teaching = periods.filter((period) => period.isTeaching && !period.isBreak && !period.isLunch);
  const days = workingDays.length ? workingDays : [1, 2, 3, 4, 5];

  return (
    <form
      className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const periodId = String(form.get('periodId') ?? '');
        const period = teaching.find((item) => item.id === periodId);
        if (!period) return;
        onSubmit({ dayOfWeek: Number(form.get('dayOfWeek')), sequence: period.sequence, periodId });
      }}
    >
      <label className="text-xs font-medium text-slate-600">
        Move to day
        <select name="dayOfWeek" defaultValue={lesson.dayOfWeek} className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm">
          {days.map((day) => (
            <option key={day} value={day}>
              {dayName(day)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-slate-600">
        Period
        <select name="periodId" defaultValue={lesson.entryId ? undefined : undefined} className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm">
          {teaching.map((period) => (
            <option key={period.id} value={period.id}>
              {period.label} ({period.startTime})
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-end">
        <Button type="submit" size="sm" loading={pending}>
          <Move className="h-4 w-4" aria-hidden /> Move lesson
        </Button>
      </div>
      <div className="flex items-end">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
