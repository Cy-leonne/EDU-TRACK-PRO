'use client';

import { useMemo, useState } from 'react';
import { ClipboardCheck, TrendingDown, TrendingUp } from 'lucide-react';
import { useApiQuery } from '@/lib/hooks';
import { useFamily } from '@/lib/family';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Note,
  PageHeader,
  ProgressBar,
  Select,
  Skeleton,
  StatCard,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { colorFor, formatDate } from '@/lib/utils';
import type { LearnerResult, LearnerProgressArea } from '@/lib/types';

/**
 * Results and progress for one child.
 *
 * The API serves published results only for learners this guardian is verified
 * against, and it hides anything still in draft. Corrections made after
 * publication are flagged so a guardian can see the mark changed.
 */
export default function FamilyResultsPage() {
  const family = useFamily();
  const learnerId = family.learnerId;
  const [learningAreaId, setLearningAreaId] = useState('');
  const [termId, setTermId] = useState('');

  const results = useApiQuery<{ learnerId: string; results: LearnerResult[] }>(learnerId ? `/results/learner/${learnerId}` : null, {
    query: { learningAreaId: learningAreaId || undefined, termId: termId || undefined },
  });
  const progress = useApiQuery<LearnerProgressArea[]>(learnerId ? `/results/learner/${learnerId}/progress` : null, {
    query: { termId: termId || undefined },
  });

  const rows = useMemo(() => results.data?.results ?? [], [results.data]);
  const areas = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const row of rows) if (row.learningAreaId) map.set(row.learningAreaId, { id: row.learningAreaId, name: row.learningAreaName });
    return Array.from(map.values());
  }, [rows]);
  const terms = useMemo(() => Array.from(new Set(rows.map((row) => row.termName).filter(Boolean))) as string[], [rows]);

  const averages = useMemo(() => {
    const entered = rows.filter((row) => row.percent !== null && row.percent !== undefined);
    if (!entered.length) return { average: null as number | null, best: null as number | null, corrected: 0 };
    const values = entered.map((row) => Number(row.percent));
    return {
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      best: Math.max(...values),
      corrected: rows.filter((row) => row.wasCorrected).length,
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Results & progress"
        description="Published results only. Teachers publish a result once marking and moderation are complete."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Published results" value={rows.length} />
        <StatCard label="Average across subjects" value={averages.average === null ? '—' : `${averages.average.toFixed(1)}%`} hint="School's internal record" />
        <StatCard label="Best result" value={averages.best === null ? '—' : `${averages.best}%`} tone="success" />
        <StatCard label="Corrected after publishing" value={averages.corrected} tone={averages.corrected ? 'warning' : 'neutral'} />
      </div>

      <Card>
        <CardHeader
          title="Result list"
          description="Newest first, with the school's achievement band and any narrative feedback."
          actions={
            <div className="flex flex-wrap gap-2">
              <Select className="w-full sm:w-48" value={learningAreaId} onChange={(event) => setLearningAreaId(event.target.value)} aria-label="Filter by learning area">
                <option value="">All learning areas</option>
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </Select>
              <Select className="w-full sm:w-40" value={termId} onChange={(event) => setTermId(event.target.value)} aria-label="Filter by term">
                <option value="">All terms</option>
                {terms.map((term) => (
                  <option key={term} value={term}>
                    {term}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        <CardBody>
          {results.loading ? (
            <Skeleton className="h-40" />
          ) : results.error ? (
            <ErrorState message={results.error} onRetry={() => results.reload()} />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No published results yet"
              description="Once a teacher publishes results for this class they appear here."
              icon={<ClipboardCheck className="h-6 w-6" aria-hidden />}
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Assessment</Th>
                  <Th>Learning area</Th>
                  <Th>Date</Th>
                  <Th>Score</Th>
                  <Th>Achievement</Th>
                  <Th>Teacher&apos;s feedback</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <Td>
                      <span className="block font-medium text-slate-800">{row.assessmentTitle}</span>
                      <span className="block text-xs text-slate-500">
                        {row.categoryName}
                        {row.termName ? ` · ${row.termName}` : ''}
                      </span>
                      {row.wasCorrected ? <Badge tone="warning" className="mt-1">corrected</Badge> : null}
                    </Td>
                    <Td>
                      <span className="flex items-center gap-2 text-sm text-slate-700">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorFor(row.learningAreaName, row.learningAreaColor) }} aria-hidden />
                        {row.learningAreaName}
                      </span>
                    </Td>
                    <Td className="text-xs text-slate-600">{formatDate(row.assessmentDate)}</Td>
                    <Td>
                      {row.isAbsent ? (
                        <Badge tone="neutral">absent</Badge>
                      ) : row.isExcused ? (
                        <Badge tone="neutral">excused</Badge>
                      ) : (
                        <>
                          <span className="block text-sm font-semibold text-slate-800">
                            {row.numericScore ?? '—'}
                            {row.totalMarks ? <span className="text-xs font-normal text-slate-500"> / {row.totalMarks}</span> : null}
                          </span>
                          {row.percent !== null && row.percent !== undefined ? <span className="block text-[11px] text-slate-500">{row.percent}%</span> : null}
                        </>
                      )}
                    </Td>
                    <Td>
                      {row.achievementLevel ? (
                        <>
                          <Badge tone="info">{row.achievementLevel.label}</Badge>
                          {row.achievementLevel.description ? <span className="mt-0.5 block max-w-[16rem] text-[11px] text-slate-500">{row.achievementLevel.description}</span> : null}
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">Not recorded</span>
                      )}
                    </Td>
                    <Td className="text-xs text-slate-600">
                      {row.comment ? <span className="block">{row.comment}</span> : null}
                      {(row.feedback ?? []).map((entry) => (
                        <span key={entry.id} className="mt-1 block rounded-lg bg-slate-50 px-2 py-1">
                          {entry.body ?? entry.narrative}
                        </span>
                      ))}
                      {!row.comment && (row.feedback ?? []).length === 0 ? '—' : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Progress per learning area" description="Trend across published results this term." />
        <CardBody className="space-y-4">
          {progress.loading ? (
            <Skeleton className="h-32" />
          ) : (progress.data ?? []).length === 0 ? (
            <EmptyState title="No progress data yet" description="Progress needs at least one published result." />
          ) : (
            progress.data?.map((area) => (
              <div key={area.learningAreaId} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorFor(area.learningAreaName, area.colorHex) }} aria-hidden />
                    {area.learningAreaName}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {area.latestAchievement ? <Badge tone="info">{area.latestAchievement}</Badge> : null}
                    {area.trend === 'UP' ? (
                      <span className="inline-flex items-center gap-1 text-success-strong">
                        <TrendingUp className="h-3.5 w-3.5" aria-hidden /> improving
                      </span>
                    ) : area.trend === 'DOWN' ? (
                      <span className="inline-flex items-center gap-1 text-rose-700">
                        <TrendingDown className="h-3.5 w-3.5" aria-hidden /> needs support
                      </span>
                    ) : area.trend === 'FLAT' ? (
                      <span>steady</span>
                    ) : (
                      <span>not enough results to judge a trend</span>
                    )}
                  </span>
                </div>
                <ProgressBar value={Math.round(area.averagePercent)} tone={area.averagePercent >= 60 ? 'success' : area.averagePercent >= 40 ? 'warning' : 'danger'} />
                <ul className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                  {area.points.map((point) => (
                    <li key={`${area.learningAreaName}-${point.label}`} className="rounded-lg bg-slate-100 px-2 py-1">
                      {point.label}: <span className="font-medium text-slate-700">{point.percent}%</span>
                      {point.achievement ? ` · ${point.achievement}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      <Note tone="info" title="How to read these results">
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Achievement bands are defined by this school in its own assessment set-up. They are not official national grades.</li>
          <li>A result flagged “corrected” was changed after publishing; the teacher recorded a reason, which the school can retrieve from its audit trail.</li>
          <li>Talk to the class teacher if a mark looks wrong — corrections are recorded, not deleted.</li>
        </ul>
      </Note>
    </div>
  );
}
