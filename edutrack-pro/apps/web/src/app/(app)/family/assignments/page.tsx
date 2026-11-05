'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Send, Upload } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/hooks';
import { useFamily } from '@/lib/family';
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
import { formatDate, formatDateTime } from '@/lib/utils';
import type { Submission } from '@/lib/types';

interface OpenAssignment {
  id: string;
  title: string;
  instructions?: string | null;
  classId: string;
  className?: string;
  learningAreaName?: string;
  dueDate?: string | null;
  maxScore?: number | null;
}

/**
 * Assignments and hand-in for one child.
 *
 * Learners have no accounts, so a guardian submits on the learner's behalf. The
 * API records who submitted, whether it was late, and the teacher's review
 * comes back as a notification.
 */
export default function FamilyAssignmentsPage() {
  const toast = useToast();
  const family = useFamily();
  const learnerId = family.learnerId;
  const [tab, setTab] = useState('open');
  const [handingIn, setHandingIn] = useState<OpenAssignment | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ fileId: '', fileName: '', linkUrl: '', note: '' });

  const assignments = useApiQuery<OpenAssignment[]>('/resources/assignments', { query: { classId: family.learner?.classId, pageSize: 100 } });
  const submissions = useApiQuery<Submission[]>('/submissions', { query: { learnerId: learnerId ?? undefined, pageSize: 50 } });

  const handedInAssignmentIds = useMemo(() => new Set((submissions.data ?? []).map((item) => item.assignmentId)), [submissions.data]);
  const open = useMemo(() => (assignments.data ?? []).filter((item) => !handedInAssignmentIds.has(item.id)), [assignments.data, handedInAssignmentIds]);

  useEffect(() => {
    if (!handingIn) return;
    setForm({ fileId: '', fileName: '', linkUrl: '', note: '' });
    setError(null);
  }, [handingIn]);

  const handIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!handingIn || !learnerId) return;
    if (!form.fileId && !form.linkUrl && form.note.trim().length < 3) {
      setError('Attach a photo or PDF of the work, paste a link, or describe what was done.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.post('/submissions', {
        assignmentId: handingIn.id,
        learnerId,
        fileId: form.fileId || null,
        linkUrl: form.linkUrl || null,
        note: form.note || null,
      });
      toast.success('Work handed in', 'The teacher has been notified. You can watch for the review here.');
      setHandingIn(null);
      await submissions.reload();
      await family.reload(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The hand-in could not be saved.');
    } finally {
      setPending(false);
    }
  };

  const rows = submissions.data ?? [];
  const accepted = rows.filter((row) => row.status === 'ACCEPTED').length;
  const returned = rows.filter((row) => row.status === 'RETURNED').length;

  return (
    <div className="space-y-4">
      <PageHeader title="Assignments" description={`Work set for ${family.learner?.className ?? 'this class'} and what has been handed in.`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open assignments" value={open.length} tone={open.length ? 'info' : 'neutral'} />
        <StatCard label="Handed in" value={rows.length} />
        <StatCard label="Accepted" value={accepted} tone="success" />
        <StatCard label="Returned for rework" value={returned} tone={returned ? 'warning' : 'neutral'} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'open', label: 'To do', badge: open.length || undefined },
          { id: 'handed', label: 'Handed in', badge: rows.length || undefined },
        ]}
      />

      {tab === 'open' ? (
        <Card>
          <CardHeader
            title="Work to hand in"
            description="Take a photo of the finished work with your phone, or upload a PDF."
            actions={
              <Button size="sm" variant="outline" onClick={() => assignments.reload()}>
                Refresh
              </Button>
            }
          />
          <CardBody>
            {assignments.loading ? (
              <Skeleton className="h-40" />
            ) : assignments.error ? (
              <ErrorState message={assignments.error} onRetry={() => assignments.reload()} />
            ) : open.length === 0 ? (
              <EmptyState
                title="Nothing outstanding"
                description="Everything set for this class has been handed in."
                icon={<BookOpen className="h-6 w-6" aria-hidden />}
              />
            ) : (
              <ul className="space-y-3">
                {open.map((assignment) => {
                  const overdue = assignment.dueDate && new Date(assignment.dueDate) < new Date();
                  return (
                    <li key={assignment.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{assignment.title}</p>
                          <p className="text-xs text-slate-500">
                            {assignment.learningAreaName}
                            {assignment.dueDate ? ` · due ${formatDate(assignment.dueDate)}` : ''}
                            {assignment.maxScore ? ` · out of ${assignment.maxScore}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {overdue ? <Badge tone="danger">past due</Badge> : <Badge tone="info">open</Badge>}
                          <Button size="sm" onClick={() => setHandingIn(assignment)}>
                            <Upload className="h-4 w-4" aria-hidden /> Hand in
                          </Button>
                        </div>
                      </div>
                      {assignment.instructions ? <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{assignment.instructions}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'handed' ? (
        <Card>
          <CardHeader title="Handed-in work" description="Includes the teacher's review and any feedback." />
          <CardBody>
            {submissions.loading ? (
              <Skeleton className="h-40" />
            ) : rows.length === 0 ? (
              <EmptyState title="Nothing handed in yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Assignment</Th>
                    <Th>Handed in</Th>
                    <Th>Attachment</Th>
                    <Th>Status</Th>
                    <Th>Review</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <Td>
                        <span className="block font-medium text-slate-800">{row.assignmentTitle}</span>
                        <span className="block text-xs text-slate-500">{row.learningAreaName}</span>
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {formatDateTime(row.submittedAt)}
                        {row.isLate ? <Badge tone="warning" className="ml-1">late</Badge> : null}
                        {row.submittedByName ? <span className="block text-[11px] text-slate-400">by {row.submittedByName}</span> : null}
                      </Td>
                      <Td>
                        {row.file?.id ? (
                          <FileChip fileId={row.file.id} fileName={row.file.name ?? 'Attachment'} />
                        ) : row.linkUrl ? (
                          <a href={row.linkUrl} target="_blank" rel="noreferrer" className="text-xs text-royal hover:underline">
                            Link
                          </a>
                        ) : (
                          <span className="text-xs text-slate-400">Note only</span>
                        )}
                        {row.note ? <p className="mt-1 max-w-xs text-xs text-slate-600">{row.note}</p> : null}
                      </Td>
                      <Td>
                        <StatusBadge status={row.status} />
                        {row.returnedReason ? <span className="mt-0.5 block max-w-xs text-[11px] text-amber-700">{row.returnedReason}</span> : null}
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {row.score != null ? <span className="block font-medium text-slate-800">Score: {row.score}{row.maxScore ? ` / ${row.maxScore}` : ''}</span> : null}
                        {row.feedback ? <span className="block">{row.feedback}</span> : null}
                        {row.reviewedByName ? <span className="block text-[11px] text-slate-400">reviewed by {row.reviewedByName}</span> : null}
                        {row.score == null && !row.feedback && !row.reviewedByName ? 'Awaiting review' : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Modal
        open={Boolean(handingIn)}
        onClose={() => setHandingIn(null)}
        title={handingIn ? `Hand in: ${handingIn.title}` : 'Hand in work'}
        description="Upload a clear photo of each page, or a PDF. Files are stored privately."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setHandingIn(null)}>
              Cancel
            </Button>
            <Button type="submit" form="handin-form" loading={pending}>
              <Send className="h-4 w-4" aria-hidden /> Submit work
            </Button>
          </>
        }
      >
        <form id="handin-form" className="space-y-3" onSubmit={handIn}>
          {error ? <ErrorState message={error} /> : null}
          {handingIn?.instructions ? (
            <Note tone="info" title="What the teacher asked for">
              <p className="whitespace-pre-wrap">{handingIn.instructions}</p>
            </Note>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-800">Photo or PDF of the work</p>
            <FileUpload
              purpose="SUBMISSION"
              label="Upload the work"
              accept="image/*,application/pdf"
              onUploaded={(file) => setForm((current) => ({ ...current, fileId: file.id, fileName: file.fileName }))}
            />
            {form.fileId ? <FileChip fileId={form.fileId} fileName={form.fileName} onRemove={() => setForm((current) => ({ ...current, fileId: '', fileName: '' }))} /> : null}
          </div>
          <Field label="Or paste a link to the work" hint="Optional — e.g. a shared document">
            <Input type="url" value={form.linkUrl} onChange={(event) => setForm({ ...form, linkUrl: event.target.value })} placeholder="https://…" />
          </Field>
          <Field label="Note for the teacher" hint="Say what was done or ask a question">
            <Textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Completed exercises 1–10 in the exercise book." />
          </Field>
          <p className="text-xs text-slate-500">
            This hand-in will be recorded as submitted by you ({family.learner?.relationship || 'guardian'}) on behalf of {family.learner?.fullName}. Teachers can see
            who submitted it.
          </p>
        </form>
      </Modal>

      <Note tone="info" title="Late work">
        <p>Work handed in after the due date is marked late automatically. The school decides how that affects marking.</p>
      </Note>

    </div>
  );
}
