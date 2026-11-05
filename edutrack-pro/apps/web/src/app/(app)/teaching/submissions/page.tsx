'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Inbox, Send, Undo2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/hooks';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, ErrorState, Field, Input, Modal, Note, PageHeader, ProgressBar, Select, Skeleton, StatusBadge, Table, Td, Textarea, Th, buttonClass, useToast } from '@/components/ui';
import { FileChip } from '@/components/file-upload';
import { formatDate, formatDateTime, titleCase } from '@/lib/utils';
import type { Assignment, Submission, SubmissionSummary } from '@/lib/types';

/**
 * Hand-in inbox.
 *
 * Learners have no accounts, so a guardian (or a teacher on their behalf) submits
 * work against an assignment. Every hand-in records who submitted it, and every
 * review is notified back to the guardians.
 */
export default function SubmissionsPage() {
  const toast = useToast();
  const assignments = useApiQuery<Assignment[]>('/resources/assignments', { query: { pageSize: 100 } });
  const [assignmentId, setAssignmentId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [reviewing, setReviewing] = useState<Submission | null>(null);
  const [reviewForm, setReviewForm] = useState({ status: 'ACCEPTED', score: '', feedback: '', returnedReason: '' });
  const [pending, setPending] = useState(false);

  const effectiveAssignmentId = assignmentId || assignments.data?.[0]?.id || '';
  const summary = useApiQuery<SubmissionSummary>(effectiveAssignmentId ? `/submissions/summary/${effectiveAssignmentId}` : null);
  // Deliberately unfiltered by status: this fetch supplies the per-learner detail
  // (attachment, submitter, note) for whichever rows the summary shows.
  const inbox = useApiQuery<Submission[]>('/submissions', {
    query: { assignmentId: effectiveAssignmentId || undefined, pageSize: 100 },
  });

  const rows = useMemo(() => {
    const list = summary.data?.rows ?? [];
    if (!statusFilter) return list;
    return list.filter((row) => row.status === statusFilter);
  }, [summary.data, statusFilter]);

  // The summary is keyed per learner and stays deliberately small; the full hand-in
  // records (attachment, who submitted, the guardian's note) come from the list
  // endpoint, which the API scopes to the classes this teacher actually teaches.
  const detailByLearner = useMemo(() => {
    const map = new Map<string, Submission>();
    for (const item of inbox.data ?? []) {
      if (!effectiveAssignmentId || item.assignmentId === effectiveAssignmentId) map.set(item.learnerId ?? '', item);
    }
    return map;
  }, [inbox.data, effectiveAssignmentId]);

  const openReview = (submission: Submission, mode: 'accept' | 'return') => {
    setReviewing(submission);
    setReviewForm({
      status: mode === 'accept' ? 'ACCEPTED' : 'RETURNED',
      score: submission.score != null ? String(submission.score) : '',
      feedback: submission.feedback ?? '',
      returnedReason: submission.returnedReason ?? '',
    });
  };

  const submitReview = async () => {
    if (!reviewing) return;
    setPending(true);
    try {
      await api.patch(`/submissions/${reviewing.id}/review`, {
        status: reviewForm.status,
        score: reviewForm.score === '' ? null : Number(reviewForm.score),
        feedback: reviewForm.feedback || null,
        returnedReason: reviewForm.status === 'RETURNED' ? reviewForm.returnedReason : null,
      });
      toast.success('Review saved', 'The guardians have been notified.');
      setReviewing(null);
      await summary.reload();
      await inbox.reload();
    } catch (caught) {
      toast.error('Could not save the review', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const openAssignments = (assignments.data ?? []).filter((assignment) => assignment.publishedAt);
  const completion = summary.data?.completion;
  const activeAssignment = summary.data?.assignment;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hand-ins"
        description="Work submitted by guardians on behalf of their child, and teacher reviews. Learners never sign in themselves."
      />

      <Card>
        <CardHeader
          title="Choose an assignment"
          description="Only published assignments can receive hand-ins."
          actions={
            <Select className="w-full sm:w-80" value={effectiveAssignmentId} onChange={(event) => setAssignmentId(event.target.value)} aria-label="Assignment">
              <option value="">Select an assignment</option>
              {openAssignments.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>
                  {assignment.title} · {assignment.className}
                </option>
              ))}
            </Select>
          }
        />
        <CardBody>
          {assignments.loading ? (
            <Skeleton className="h-24" />
          ) : openAssignments.length === 0 ? (
            <EmptyState
              title="No published assignments"
              description="Create an assignment under Resources & assignments, then hand-ins will appear here."
              action={
                <Link href="/teaching/resources" className={buttonClass('primary', 'md')}>
                  Go to assignments
                </Link>
              }
              icon={<Inbox className="h-6 w-6" aria-hidden />}
            />
          ) : !activeAssignment ? (
            <p className="text-sm text-slate-500">Select an assignment above.</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-4">
              <div className="lg:col-span-3">
                <p className="text-sm font-semibold text-slate-800">{activeAssignment.title}</p>
                <p className="text-xs text-slate-500">
                  {activeAssignment.className} · {activeAssignment.learningAreaName} · due {formatDate(activeAssignment.dueDate)}
                  {activeAssignment.maxScore ? ` · out of ${activeAssignment.maxScore}` : ''}
                </p>
                {completion ? (
                  <div className="mt-3 space-y-2">
                    <ProgressBar value={completion.completionPercent} label={`${completion.handedIn} of ${completion.expected} handed in (${completion.completionPercent}%)`} />
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge tone="neutral">{completion.missing} not handed in</Badge>
                      <Badge tone="warning">{completion.late} late</Badge>
                      <Badge tone="info">{completion.reviewed} reviewed</Badge>
                      <Badge tone="danger">{completion.returned} returned for rework</Badge>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600 lg:col-span-1">
                <p className="font-semibold text-slate-700">Hand-in guidance</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>Guardians photograph work and upload it from the family portal.</li>
                  <li>Hand-ins after the due date are flagged late automatically.</li>
                  <li>Returning work requires a reason the guardian will see.</li>
                </ul>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Hand-ins for this assignment"
          description="Late and returned hand-ins are listed with their reason."
          actions={
            <div className="flex flex-wrap gap-2">
              <Select className="w-full sm:w-44" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
                <option value="">All hand-ins</option>
                {['SUBMITTED', 'LATE', 'REVIEWED', 'ACCEPTED', 'RETURNED'].map((status) => (
                  <option key={status} value={status}>
                    {titleCase(status)}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="outline" onClick={() => summary.reload()}>
                Refresh
              </Button>
            </div>
          }
        />
        <CardBody>
          {summary.loading ? (
            <Skeleton className="h-40" />
          ) : summary.error ? (
            <ErrorState message={summary.error} onRetry={() => summary.reload()} />
          ) : rows.length === 0 ? (
            <EmptyState
              title={statusFilter ? 'Nothing matches that status' : 'No hand-ins yet'}
              description={
                statusFilter
                  ? 'Try clearing the filter.'
                  : 'When a guardian uploads their child’s work it appears here for review.'
              }
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Learner</Th>
                  <Th>Hand-in</Th>
                  <Th>When</Th>
                  <Th>Review</Th>
                  <Th>Status</Th>
                  <Th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const detail = detailByLearner.get(row.learnerId);
                  return (
                    <tr key={row.learnerId} className="hover:bg-slate-50">
                      <Td>
                        <span className="block font-medium text-slate-800">{row.learnerName}</span>
                        <span className="block text-xs text-slate-500">{row.admissionNumber}</span>
                      </Td>
                      <Td>
                        <div className="space-y-1">
                          {detail?.file?.id ? <FileChip fileId={detail.file.id} fileName={detail.file.name ?? 'Attachment'} /> : null}
                          {detail?.linkUrl ? (
                            <a href={detail.linkUrl} target="_blank" rel="noreferrer" className="block text-xs text-royal hover:underline">
                              Open link
                            </a>
                          ) : null}
                          {detail?.note ? <p className="max-w-xs text-xs text-slate-600">{detail.note}</p> : null}
                          {!detail ? <span className="text-xs text-slate-400">Nothing handed in</span> : null}
                          {detail?.submittedByName ? <span className="block text-[11px] text-slate-400">submitted by {detail.submittedByName}</span> : null}
                        </div>
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {row.submittedAt ? formatDateTime(row.submittedAt) : '—'}
                        {row.isLate ? <Badge tone="warning" className="ml-1">late</Badge> : null}
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {row.score != null ? <span className="font-medium text-slate-800">{row.score}</span> : '—'}
                        {row.feedback ? <span className="block max-w-xs text-[11px] text-slate-500">{row.feedback}</span> : null}
                      </Td>
                      <Td>
                        {row.status === 'MISSING' ? <Badge tone="neutral">not handed in</Badge> : <StatusBadge status={row.status} />}
                      </Td>
                      <Td>
                        {row.submissionId ? (
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => openReview({ ...(detail ?? ({} as Submission)), id: row.submissionId as string }, 'accept')}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Accept
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openReview({ ...(detail ?? ({} as Submission)), id: row.submissionId as string }, 'return')}
                            >
                              <Undo2 className="h-3.5 w-3.5" aria-hidden /> Return
                            </Button>
                          </div>
                        ) : (
                          <span className="block text-right text-[11px] text-slate-400">nothing to review</span>
                        )}
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
        <CardHeader title="All my classes — recent hand-ins" description="Across every assignment you own." />
        <CardBody>
          {inbox.loading ? (
            <Skeleton className="h-32" />
          ) : (inbox.data ?? []).length === 0 ? (
            <EmptyState title="Nothing handed in yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {inbox.data?.slice(0, 12).map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">{row.learnerName}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {row.assignmentTitle} · {row.className}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    <StatusBadge status={row.status} />
                    {formatDateTime(row.submittedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Modal
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        title={`Review · ${reviewing?.learnerName ?? ''}`}
        description="Accepting or returning work notifies the guardians."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewing(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitReview}
              loading={pending}
              disabled={reviewForm.status === 'RETURNED' && reviewForm.returnedReason.trim().length < 5}
            >
              <Send className="h-4 w-4" aria-hidden /> Save review
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {reviewing?.note ? (
            <Note tone="info" title="Guardian's note">
              <p>{reviewing.note}</p>
            </Note>
          ) : null}
          <Field label="Decision">
            <Select value={reviewForm.status} onChange={(event) => setReviewForm({ ...reviewForm, status: event.target.value })}>
              <option value="ACCEPTED">Accept the work</option>
              <option value="REVIEWED">Mark as reviewed (no score)</option>
              <option value="RETURNED">Return for rework</option>
            </Select>
          </Field>
          <Field label="Score" hint={activeAssignment?.maxScore ? `Out of ${activeAssignment.maxScore}` : 'Optional'}>
            <Input type="number" min={0} max={activeAssignment?.maxScore ?? undefined} value={reviewForm.score} onChange={(event) => setReviewForm({ ...reviewForm, score: event.target.value })} />
          </Field>
          <Field label="Feedback to the family">
            <Textarea value={reviewForm.feedback} onChange={(event) => setReviewForm({ ...reviewForm, feedback: event.target.value })} placeholder="Well organised; the diagram needs labels." />
          </Field>
          {reviewForm.status === 'RETURNED' ? (
            <Field label="What needs to be redone" required hint="Shown to the guardian">
              <Textarea value={reviewForm.returnedReason} onChange={(event) => setReviewForm({ ...reviewForm, returnedReason: event.target.value })} />
            </Field>
          ) : null}
          <Checkbox label="The guardians will be notified in the portal" checked disabled />
        </div>
      </Modal>
    </div>
  );
}
