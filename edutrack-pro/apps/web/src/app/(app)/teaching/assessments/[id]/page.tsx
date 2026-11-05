'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, FileText, Info, Rocket, Save, ShieldCheck, Undo2 } from 'lucide-react';
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
  KeyValue,
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
import { FileChip, FileUpload } from '@/components/file-upload';
import { percentRange } from '@/lib/rubric-utils';
import { formatDate, formatDateTime, titleCase } from '@/lib/utils';
import type { Assessment, ResultGrid } from '@/lib/types';

interface DraftRow {
  learnerId: string;
  numericScore: string;
  achievementLevelId: string;
  isAbsent: boolean;
  isExcused: boolean;
  comment: string;
}

export default function AssessmentDetailPage() {
  const params = useParams<{ id: string }>();
  const assessmentId = params?.id;
  const toast = useToast();

  const assessment = useApiQuery<Assessment>(assessmentId ? `/assessments/${assessmentId}` : null);
  const grid = useApiQuery<ResultGrid>(assessmentId ? `/results/grid/${assessmentId}` : null);

  const [tab, setTab] = useState('results');
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishForm, setPublishForm] = useState({ notifyParents: true, reason: '' });
  const [pending, setPending] = useState(false);
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [amendFor, setAmendFor] = useState<{ resultId: string; learnerName: string; current: string } | null>(null);
  const [amendForm, setAmendForm] = useState({ numericScore: '', comment: '', reason: '', notifyParents: true });

  // Seed the editable draft from the server grid whenever it (re)loads.
  useEffect(() => {
    if (!grid.data) return;
    const next: Record<string, DraftRow> = {};
    for (const row of grid.data.rows) {
      next[row.learnerId] = {
        learnerId: row.learnerId,
        numericScore: row.numericScore === null || row.numericScore === undefined ? '' : String(row.numericScore),
        achievementLevelId: row.achievementLevelId ?? '',
        isAbsent: row.isAbsent,
        isExcused: row.isExcused,
        comment: row.comment ?? '',
      };
    }
    setDraft(next);
    setDirty(false);
  }, [grid.data]);

  const assessmentData = assessment.data;
  const gridData = grid.data;

  const isPublished = assessmentData?.status === 'PUBLISHED' || assessmentData?.status === 'CORRECTED';
  const totalMarks = assessmentData?.totalMarks ?? null;

  const stats = useMemo(() => {
    const rows = gridData?.rows ?? [];
    const entered = rows.filter((row) => row.numericScore !== null && row.numericScore !== undefined);
    const average = entered.length ? entered.reduce((sum, row) => sum + Number(row.numericScore ?? 0), 0) / entered.length : null;
    return { count: rows.length, entered: entered.length, average };
  }, [gridData]);

  const updateRow = (learnerId: string, patch: Partial<DraftRow>) => {
    setDraft((prev) => ({ ...prev, [learnerId]: { ...prev[learnerId], ...patch } }));
    setDirty(true);
  };

  const saveDraft = async (asDraft = true) => {
    if (!assessmentId || !gridData) return;
    setSaving(true);
    setError(null);
    const results = Object.values(draft)
      .filter((row) => row.numericScore !== '' || row.achievementLevelId || row.isAbsent || row.isExcused || row.comment)
      .map((row) => ({
        learnerId: row.learnerId,
        numericScore: row.isAbsent || row.isExcused || row.numericScore === '' ? null : Number(row.numericScore),
        achievementLevelId: row.achievementLevelId || null,
        isAbsent: row.isAbsent,
        isExcused: row.isExcused,
        comment: row.comment || null,
      }));

    if (!results.length) {
      setError('Nothing to save yet — enter at least one mark or achievement level.');
      setSaving(false);
      return;
    }

    if (totalMarks) {
      const tooHigh = results.find((row) => row.numericScore !== null && row.numericScore > totalMarks);
      if (tooHigh) {
        setError(`A mark is above the assessment maximum of ${totalMarks}. Check the highlighted learner.`);
        setSaving(false);
        return;
      }
    }

    try {
      await api.post(`/results/grid/${assessmentId}`, { results, saveAsDraft: asDraft });
      toast.success(asDraft ? 'Results saved as draft' : 'Results saved');
      setDirty(false);
      await grid.reload();
      await assessment.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Saving failed.');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!assessmentId) return;
    setPending(true);
    try {
      await api.post(`/assessments/${assessmentId}/publish`, {
        notifyParents: publishForm.notifyParents,
        reason: publishForm.reason || undefined,
      });
      toast.success('Results published', publishForm.notifyParents ? 'Linked guardians have been notified.' : undefined);
      setPublishOpen(false);
      await assessment.reload();
      await grid.reload();
    } catch (caught) {
      toast.error('Publishing refused', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const changeStatus = async (status: string, reason?: string) => {
    if (!assessmentId) return;
    setPending(true);
    try {
      await api.post(`/assessments/${assessmentId}/status`, { status, reason: reason ?? null });
      toast.success(`Assessment moved to ${status.replace(/_/g, ' ').toLowerCase()}`);
      await assessment.reload();
    } catch (caught) {
      toast.error('Could not change the status', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const attachResource = async (file: { id: string; fileName: string }) => {
    if (!assessmentId) return;
    try {
      await api.post(`/assessments/${assessmentId}/resources`, { fileId: file.id, title: file.fileName, kind: 'ATTACHMENT' });
      toast.success('Attachment added', file.fileName);
      await assessment.reload();
    } catch (caught) {
      toast.error('Could not attach the file', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const removeResource = async (resourceId: string) => {
    try {
      await api.del(`/assessments/resources/${resourceId}`);
      toast.success('Attachment removed');
      await assessment.reload();
    } catch (caught) {
      toast.error('Could not remove the attachment', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const saveFeedback = async () => {
    if (!feedbackFor) return;
    const row = gridData?.rows.find((item) => item.learnerId === feedbackFor);
    if (!row?.resultId) {
      toast.error('No result yet', 'Enter and save a result for this learner before adding narrative feedback.');
      return;
    }
    setPending(true);
    try {
      await api.post('/results/feedback', { resultId: row.resultId, narrative: feedbackText, isPublished: isPublished });
      toast.success('Feedback saved', isPublished ? 'The guardian can see it.' : 'It will be visible once results are published.');
      setFeedbackFor(null);
      setFeedbackText('');
      await grid.reload();
    } catch (caught) {
      toast.error('Could not save feedback', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const amendResult = async () => {
    if (!amendFor) return;
    setPending(true);
    try {
      await api.patch(`/results/${amendFor.resultId}/amend`, {
        numericScore: amendForm.numericScore === '' ? null : Number(amendForm.numericScore),
        comment: amendForm.comment || null,
        reason: amendForm.reason,
        notifyParents: amendForm.notifyParents,
      });
      toast.success('Result corrected', 'The change and your reason are in the audit trail.');
      setAmendFor(null);
      await grid.reload();
      await assessment.reload();
    } catch (caught) {
      toast.error('Correction refused', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  if (assessment.loading) return <Skeleton className="h-96" />;
  if (assessment.error || !assessmentData) return <ErrorState message={assessment.error ?? 'Assessment not found.'} onRetry={() => assessment.reload()} />;

  const readonlyResults = isPublished;

  return (
    <div className="space-y-4">
      <PageHeader
        title={assessmentData.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={assessmentData.status} />
            <span>
              {assessmentData.className} · {assessmentData.learningAreaName} · {assessmentData.categoryName} · {formatDate(assessmentData.assessmentDate)}
            </span>
          </span>
        }
        breadcrumb={
          <Link href="/teaching/assessments" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="h-3 w-3" aria-hidden /> All assessments
          </Link>
        }
        actions={
          <>
            {assessmentData.status === 'DRAFT' ? (
              <Button variant="outline" size="sm" onClick={() => changeStatus('READY_FOR_REVIEW')} loading={pending}>
                <ShieldCheck className="h-4 w-4" aria-hidden /> Mark ready for review
              </Button>
            ) : null}
            {!isPublished ? (
              <Button size="sm" onClick={() => setPublishOpen(true)} disabled={!gridData?.summary.entered}>
                <Rocket className="h-4 w-4" aria-hidden /> Publish results
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Learners" value={gridData?.summary.expected ?? 0} hint={assessmentData.className} />
        <StatCard label="Results entered" value={gridData?.summary.entered ?? 0} tone={(gridData?.summary.entered ?? 0) ? 'success' : 'warning'} />
        <StatCard label="Missing" value={gridData?.summary.missing ?? 0} tone={(gridData?.summary.missing ?? 0) ? 'warning' : 'success'} />
        <StatCard
          label="Internal average"
          value={stats.average === null ? '—' : `${stats.average.toFixed(1)}${totalMarks ? ` / ${totalMarks}` : ''}`}
          hint="School record only — not a national outcome"
        />
      </div>

      {isPublished ? (
        <Note tone="success" title="Published">
          <p>
            Guardians of linked learners can see these results{assessmentData.publishedAt ? ` (published ${formatDateTime(assessmentData.publishedAt)})` : ''}. To change
            a mark, use “Correct” on the learner row — the reason you give is stored in the audit trail and the guardian is notified.
          </p>
        </Note>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'results', label: 'Results entry', badge: gridData?.summary.entered || undefined },
          { id: 'details', label: 'Details' },
          { id: 'attachments', label: 'Attachments', badge: assessmentData.resources?.length || undefined },
        ]}
      />

      {tab === 'results' ? (
        <Card>
          <CardHeader
            title="Results grid"
            description={
              assessmentData.usesRubric && !assessmentData.usesMarks
                ? 'Record an achievement level for each learner.'
                : `Enter a mark out of ${totalMarks ?? '—'}, an achievement level, or both.`
            }
            actions={
              <>
                <Button variant="outline" size="sm" onClick={() => grid.reload()} disabled={saving}>
                  Reload
                </Button>
                {!readonlyResults ? (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => saveDraft(true)} loading={saving}>
                      <Save className="h-4 w-4" aria-hidden /> Save draft
                    </Button>
                    <Button size="sm" onClick={() => saveDraft(false)} loading={saving} disabled={!dirty}>
                      Save &amp; mark complete
                    </Button>
                  </>
                ) : null}
              </>
            }
          />
          <CardBody className="space-y-3">
            {error ? <ErrorState message={error} /> : null}
            {grid.loading ? (
              <Skeleton className="h-40" />
            ) : !gridData || gridData.rows.length === 0 ? (
              <EmptyState title="No learners in this class yet" description="Ask an administrator to enrol learners into this class." />
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>Learner</Th>
                      <Th>{assessmentData.usesMarks ? `Mark (/${totalMarks ?? '—'})` : 'Mark'}</Th>
                      <Th>Achievement level</Th>
                      <Th>Flags</Th>
                      <Th>Comment</Th>
                      <Th>Status</Th>
                      <Th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {gridData.rows.map((row) => {
                      const value = draft[row.learnerId] ?? {
                        learnerId: row.learnerId,
                        numericScore: '',
                        achievementLevelId: '',
                        isAbsent: false,
                        isExcused: false,
                        comment: '',
                      };
                      const overMax = totalMarks && value.numericScore !== '' && Number(value.numericScore) > totalMarks;
                      return (
                        <tr key={row.learnerId} className="hover:bg-slate-50">
                          <Td>
                            <span className="block font-medium text-slate-800">{row.learnerName}</span>
                            <span className="block text-xs text-slate-500">{row.admissionNumber}</span>
                          </Td>
                          <Td>
                            <Input
                              type="number"
                              min={0}
                              max={totalMarks ?? undefined}
                              step="0.5"
                              value={value.numericScore}
                              disabled={readonlyResults || value.isAbsent || value.isExcused}
                              onChange={(event) => updateRow(row.learnerId, { numericScore: event.target.value })}
                              className={overMax ? 'border-rose-400 focus:border-rose-500' : undefined}
                              aria-label={`Mark for ${row.learnerName}`}
                            />
                            {overMax ? <span className="text-[11px] font-medium text-rose-600">Above the maximum</span> : null}
                            {row.percent !== null && row.percent !== undefined && !dirty ? (
                              <span className="text-[11px] text-slate-500">{row.percent}% · {row.achievementLevel?.label ?? 'no band'}</span>
                            ) : null}
                          </Td>
                          <Td>
                            <Select
                              value={value.achievementLevelId}
                              disabled={readonlyResults}
                              onChange={(event) => updateRow(row.learnerId, { achievementLevelId: event.target.value })}
                              aria-label={`Achievement level for ${row.learnerName}`}
                            >
                              <option value="">Not recorded</option>
                              {gridData.achievementLevels.map((level) => (
                                <option key={level.id} value={level.id}>
                                  {level.label} ({percentRange(level.minPercent, level.maxPercent)})
                                </option>
                              ))}
                            </Select>
                          </Td>
                          <Td>
                            <div className="flex flex-col gap-1">
                              <Checkbox
                                label="Absent"
                                checked={value.isAbsent}
                                disabled={readonlyResults}
                                onChange={(event) => updateRow(row.learnerId, { isAbsent: event.target.checked, isExcused: false })}
                              />
                              <Checkbox
                                label="Excused"
                                checked={value.isExcused}
                                disabled={readonlyResults}
                                onChange={(event) => updateRow(row.learnerId, { isExcused: event.target.checked, isAbsent: false })}
                              />
                            </div>
                          </Td>
                          <Td>
                            <Input
                              value={value.comment}
                              disabled={readonlyResults}
                              onChange={(event) => updateRow(row.learnerId, { comment: event.target.value })}
                              placeholder="Short note"
                              aria-label={`Comment for ${row.learnerName}`}
                            />
                          </Td>
                          <Td>
                            <StatusBadge status={row.status} />
                            {row.updatedAt ? <span className="block text-[11px] text-slate-400">{formatDateTime(row.updatedAt)}</span> : null}
                          </Td>
                          <Td>
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setFeedbackFor(row.learnerId);
                                  setFeedbackText(row.feedback?.[0]?.body ?? '');
                                }}
                              >
                                Feedback
                              </Button>
                              {row.resultId && isPublished ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-amber-700 hover:bg-amber-50"
                                  onClick={() => {
                                    setAmendFor({
                                      resultId: row.resultId as string,
                                      learnerName: row.learnerName,
                                      current: row.numericScore === null || row.numericScore === undefined ? '—' : String(row.numericScore),
                                    });
                                    setAmendForm({ numericScore: row.numericScore === null || row.numericScore === undefined ? '' : String(row.numericScore), comment: row.comment ?? '', reason: '', notifyParents: true });
                                  }}
                                >
                                  <Undo2 className="h-3.5 w-3.5" aria-hidden /> Correct
                                </Button>
                              ) : null}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                {!readonlyResults ? (
                  <p className="flex items-start gap-2 text-xs text-slate-500">
                    <Info className="mt-0.5 h-3.5 w-3.5" aria-hidden />
                    Marks above the maximum are refused. Save as draft while working; publishing releases results to guardians and locks direct editing (use
                    “Correct” afterwards, with a reason, which is audited).
                  </p>
                ) : null}
              </>
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'details' ? (
        <Card>
          <CardHeader title="Assessment details" />
          <CardBody className="space-y-4">
            <KeyValue
              columns={3}
              items={[
                { label: 'Term', value: assessmentData.termName ?? '—' },
                { label: 'Category', value: assessmentData.categoryName },
                { label: 'Strand', value: assessmentData.strandName ?? '—' },
                { label: 'Sub-strand', value: assessmentData.subStrandName ?? '—' },
                { label: 'Assessment date', value: formatDate(assessmentData.assessmentDate) },
                { label: 'Due date', value: assessmentData.dueDate ? formatDate(assessmentData.dueDate) : '—' },
                { label: 'Total marks', value: totalMarks ?? '—' },
                { label: 'Marks used', value: assessmentData.usesMarks ? 'Yes' : 'No' },
                { label: 'Rubric used', value: assessmentData.usesRubric ? 'Yes' : 'No' },
                { label: 'Created by', value: assessmentData.createdByName ?? '—' },
                { label: 'Published', value: assessmentData.publishedAt ? formatDateTime(assessmentData.publishedAt) : 'Not published' },
                { label: 'Externally reported', value: assessmentData.isExternallyReported ? 'Flagged' : 'No' },
              ]}
            />
            {assessmentData.description ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{assessmentData.description}</p>
              </div>
            ) : null}
            {assessmentData.instructions ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Instructions</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{assessmentData.instructions}</p>
              </div>
            ) : null}
            {assessmentData.correctionReason ? (
              <Note tone="warning" title="Last correction">
                <p>{assessmentData.correctionReason}</p>
              </Note>
            ) : null}
            {isPublished ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => changeStatus('CORRECTED', 'Corrected after publication')} loading={pending}>
                  Mark as corrected
                </Button>
                <Button variant="ghost" size="sm" onClick={() => changeStatus('DRAFT', 'Returned to draft for further work')} loading={pending}>
                  Return to draft
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'attachments' ? (
        <Card>
          <CardHeader
            title="Attachments"
            description="Question papers, mark schemes or learner work — stored privately and validated before saving."
            actions={<FileText className="h-4 w-4 text-slate-400" aria-hidden />}
          />
          <CardBody className="space-y-4">
            {!isPublished ? (
              <FileUpload purpose="ASSESSMENT" label="Attach a PDF or image to this assessment" onUploaded={attachResource} />
            ) : (
              <Note tone="info" title="Published assessment">
                <p>Attachments can still be added for the record, but results are locked. Corrections go through the “Correct” action on each learner row.</p>
              </Note>
            )}
            {isPublished ? <FileUpload purpose="ASSESSMENT" label="Add a supporting document" onUploaded={attachResource} /> : null}

            {(assessmentData.resources?.length ?? 0) === 0 ? (
              <EmptyState title="No attachments yet" description="Upload the question paper, a mark scheme or a photo of the activity." />
            ) : (
              <ul className="space-y-2">
                {assessmentData.resources?.map((resource) => (
                  <li key={resource.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-800">{resource.title ?? resource.fileName ?? 'Attachment'}</span>
                      <span className="block text-xs text-slate-500">
                        {resource.kind ? titleCase(resource.kind) : 'Attachment'} · added {formatDate(resource.createdAt)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {resource.fileId ? <FileChip fileId={resource.fileId} fileName={resource.fileName ?? 'Download'} /> : null}
                      {resource.externalUrl ? (
                        <a href={resource.externalUrl} target="_blank" rel="noreferrer" className="text-xs text-royal hover:underline">
                          Open link
                        </a>
                      ) : null}
                      <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50" onClick={() => removeResource(resource.id)}>
                        Remove
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* ------------------------------------------------------ publish modal */}
      <Modal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title="Publish results"
        description="Publishing releases results to linked guardians and writes an audit entry."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button onClick={publish} loading={pending}>
              <Rocket className="h-4 w-4" aria-hidden /> Publish results
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {gridData?.summary.missing ? (
            <Note tone="warning" title={`${gridData.summary.missing} learner(s) have no result`}>
              <p>You can still publish — those learners simply have no result recorded. Some schools prefer to complete entry first.</p>
            </Note>
          ) : (
            <Note tone="success" title="Every learner has a recorded outcome">
              <p>Nothing is outstanding for this assessment.</p>
            </Note>
          )}
          <div className="space-y-2">
            <Checkbox label="Notify linked guardians" checked={publishForm.notifyParents} onChange={(event) => setPublishForm({ ...publishForm, notifyParents: event.target.checked })} />
            <p className="text-xs text-slate-500">Notifications are in-app by default. Email is sent only if the school has configured an email provider.</p>
          </div>
          <Field label="Reason / note" hint="Optional, stored with the publication">
            <Input value={publishForm.reason} onChange={(event) => setPublishForm({ ...publishForm, reason: event.target.value })} />
          </Field>
          <div className="rounded-lg border border-slate-200 p-3 text-sm">
            <p className="font-medium text-slate-700">Before you publish</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-600">
              <li>Marks are within the assessment maximum.</li>
              <li>Achievement levels are the school&apos;s own bands, not national grades.</li>
              <li>Comments are appropriate to share with a guardian.</li>
            </ul>
          </div>
        </div>
      </Modal>

      {/* ----------------------------------------------------- feedback modal */}
      <Modal
        open={Boolean(feedbackFor)}
        onClose={() => setFeedbackFor(null)}
        title="Narrative feedback"
        description="Describe what the learner did well and what to work on next."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFeedbackFor(null)}>
              Cancel
            </Button>
            <Button onClick={saveFeedback} loading={pending}>
              Save feedback
            </Button>
          </>
        }
      >
        <Field label="Feedback" required>
          <Textarea
            value={feedbackText}
            onChange={(event) => setFeedbackText(event.target.value)}
            placeholder="e.g. Explains the process clearly; needs to show units in every step."
            className="min-h-[140px]"
          />
        </Field>
        <p className="mt-2 text-xs text-slate-500">
          {isPublished ? 'This will be visible to the guardian immediately.' : 'Feedback is stored with the result and becomes visible when results are published.'}
        </p>
      </Modal>

      {/* ------------------------------------------------------- amend modal */}
      <Modal
        open={Boolean(amendFor)}
        onClose={() => setAmendFor(null)}
        title={`Correct result · ${amendFor?.learnerName ?? ''}`}
        description="Corrections keep the original value in the audit trail and require a reason."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAmendFor(null)}>
              Cancel
            </Button>
            <Button onClick={amendResult} loading={pending} disabled={amendForm.reason.trim().length < 5}>
              Save correction
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <KeyValue columns={1} items={[{ label: 'Current mark', value: amendFor?.current ?? '—' }]} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="New mark" required>
              <Input type="number" min={0} max={totalMarks ?? undefined} step="0.5" value={amendForm.numericScore} onChange={(event) => setAmendForm({ ...amendForm, numericScore: event.target.value })} />
            </Field>
            <Field label="Comment">
              <Input value={amendForm.comment} onChange={(event) => setAmendForm({ ...amendForm, comment: event.target.value })} />
            </Field>
          </div>
          <Field label="Reason for the correction" required hint="Stored in the audit trail — at least five characters">
            <Textarea value={amendForm.reason} onChange={(event) => setAmendForm({ ...amendForm, reason: event.target.value })} placeholder="Marked the wrong question during moderation." />
          </Field>
          <Checkbox label="Notify guardians of the correction" checked={amendForm.notifyParents} onChange={(event) => setAmendForm({ ...amendForm, notifyParents: event.target.checked })} />
          <ProgressBar value={100} label="Original value is preserved automatically" tone="brand" />
        </div>
      </Modal>
    </div>
  );
}
