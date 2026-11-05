'use client';

import { useMemo, useState } from 'react';
import { Copy, MailPlus, ShieldAlert, UserPlus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery, useSubmit } from '@/lib/hooks';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  ErrorState,
  Field,
  Input,
  Modal,
  Note,
  PageHeader,
  Select,
  SkeletonTable,
  Table,
  TableEmpty,
  Td,
  Th,
  Toolbar,
  useToast,
} from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/utils';
import type { LearnerSummary } from '@/lib/types';

/**
 * Invitations.
 *
 * Teachers and additional administrators can only ever be onboarded by an
 * invitation from this screen — there is no public sign-up for staff, and the
 * API refuses to create one. Guardians register themselves with the school code
 * and are then linked to a learner by the office (see Parents & links).
 *
 * The invitation token is shown once, right after it is created, so the office
 * can hand it over by any channel; the same link is emailed when SMTP is
 * configured. Nothing here stores the token: the API keeps only its hash.
 */

interface InvitationRow {
  id: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'TEACHER' | 'PARENT';
  relationship: string | null;
  learnerName: string | null;
  expiresAt: string;
  createdAt: string;
}

const ROLE_LABEL: Record<InvitationRow['role'], string> = {
  ADMIN: 'Administrator',
  TEACHER: 'Teacher',
  PARENT: 'Guardian',
};

const RELATIONSHIPS = ['Mother', 'Father', 'Guardian', 'Other'];

interface CreatedInvitation {
  invitation: InvitationRow;
  invitationUrl: string;
  expiresAt: string;
}

export default function InvitationsPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useApiQuery<InvitationRow[]>('/auth/invitations');
  const learners = useApiQuery<LearnerSummary[]>('/learners', { query: { status: 'ACTIVE', pageSize: 200 } });

  const [inviting, setInviting] = useState(false);
  const [revoking, setRevoking] = useState<InvitationRow | null>(null);
  const [handover, setHandover] = useState<CreatedInvitation | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    role: 'TEACHER' as InvitationRow['role'],
    relationship: 'Mother',
    learnerId: '',
    expiresInDays: '7',
  });

  const rows = useMemo(() => data ?? [], [data]);

  const create = useSubmit(async () => {
    const payload = {
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      role: form.role,
      expiresInDays: Number(form.expiresInDays) || 7,
      ...(form.role === 'PARENT' ? { relationship: form.relationship, learnerId: form.learnerId || undefined } : {}),
    };
    const created = await api.post<CreatedInvitation>('/auth/invitations', payload);
    setInviting(false);
    setHandover(created);
    setForm({ fullName: '', email: '', role: 'TEACHER', relationship: 'Mother', learnerId: '', expiresInDays: '7' });
    toast.success('Invitation created', 'Hand the link over, or let the email go out if SMTP is configured.');
    await reload();
  });

  const revoke = useSubmit(async (invitation: InvitationRow) => {
    await api.post(`/auth/invitations/${invitation.id}/revoke`, { reason: 'Revoked from the invitations screen' });
    setRevoking(null);
    toast.success('Invitation revoked', `${invitation.email} can no longer use that link.`);
    await reload();
  });

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Invitation link copied');
    } catch {
      // Clipboard access can be blocked; the field stays selectable instead.
      toast.error('Copy failed', 'Select the link and copy it manually.');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invitations"
        description="Staff accounts are invitation-only. Guardians self-register with the school code and are linked to a learner by the office."
        breadcrumb={<span>People</span>}
        actions={
          <Button onClick={() => setInviting(true)}>
            <MailPlus className="h-4 w-4" aria-hidden /> Invite a person
          </Button>
        }
      />

      <Note tone="info" title="How onboarding works here">
        <ul className="list-disc space-y-1 pl-4">
          <li>Teachers and administrators receive an invitation link, set their own password and are active immediately.</li>
          <li>Guardians can register themselves; a learner is never exposed until the office verifies the link.</li>
          <li>An invitation is single-use, expires (7 days by default) and can be revoked at any time from this screen.</li>
        </ul>
      </Note>

      <Card>
        <CardHeader
          title="Pending invitations"
          description="Accepted, revoked and expired invitations drop off this list."
          actions={
            <Toolbar>
              <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
                Refresh
              </Button>
            </Toolbar>
          }
        />
        <CardBody>
          {loading && !data ? (
            <SkeletonTable rows={4} columns={5} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void reload()} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Person</Th>
                  <Th>Role</Th>
                  <Th>Learner</Th>
                  <Th>Expires</Th>
                  <Th>Invited</Th>
                  <Th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <TableEmpty
                    colSpan={6}
                    title="No pending invitations"
                    description="Invite a teacher or an administrator and the link appears here until it is used or expires."
                  />
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-line/70 last:border-0">
                      <Td>
                        <span className="block text-sm font-medium text-ink-strong">{row.fullName}</span>
                        <span className="block text-xs text-ink-muted">{row.email}</span>
                      </Td>
                      <Td>
                        <Badge tone={row.role === 'ADMIN' ? 'warning' : row.role === 'TEACHER' ? 'info' : 'neutral'}>
                          {ROLE_LABEL[row.role]}
                        </Badge>
                      </Td>
                      <Td className="text-sm text-ink">
                        {row.learnerName ?? <span className="text-ink-subtle">—</span>}
                        {row.relationship ? <span className="block text-xs text-ink-muted">{row.relationship}</span> : null}
                      </Td>
                      <Td>
                        <span className="block text-sm text-ink">{formatDateTime(row.expiresAt)}</span>
                        <span className="block text-xs text-ink-muted">{formatRelative(row.expiresAt)}</span>
                      </Td>
                      <Td className="text-sm text-ink-muted">{formatDateTime(row.createdAt)}</Td>
                      <Td className="text-right">
                        <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50" onClick={() => setRevoking(row)}>
                          Revoke
                        </Button>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------ invite modal */}
      <Modal
        open={inviting}
        onClose={() => setInviting(false)}
        title="Invite a person to this school"
        description="The API refuses to create staff accounts any other way — there is no public administrator or teacher registration."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviting(false)}>
              Cancel
            </Button>
            <Button onClick={() => void create.submit()} loading={create.pending}>
              <UserPlus className="h-4 w-4" aria-hidden /> Create invitation
            </Button>
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create.submit();
          }}
        >
          {create.error ? (
            <Note tone="danger" title="That invitation was refused">
              {create.error}
            </Note>
          ) : null}
          <Field label="Full name" required>
            <Input
              required
              value={form.fullName}
              onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))}
            />
          </Field>
          <Field label="Email" hint="This is the sign-in address" required>
            <Input
              type="email"
              required
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </Field>
          <Field label="Role" required>
            <Select
              value={form.role}
              onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as InvitationRow['role'] }))}
            >
              <option value="TEACHER">Teacher</option>
              <option value="ADMIN">Administrator</option>
              <option value="PARENT">Guardian (link to a learner)</option>
            </Select>
          </Field>
          {form.role === 'PARENT' ? (
            <>
              <Field label="Relationship to the learner">
                <Select
                  value={form.relationship}
                  onChange={(event) => setForm((prev) => ({ ...prev, relationship: event.target.value }))}
                >
                  {RELATIONSHIPS.map((relationship) => (
                    <option key={relationship} value={relationship}>
                      {relationship}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Learner" hint="Optional — the link still has to be verified before any record is visible">
                <Select value={form.learnerId} onChange={(event) => setForm((prev) => ({ ...prev, learnerId: event.target.value }))}>
                  <option value="">Not linked yet</option>
                  {(learners.data ?? []).map((learner) => (
                    <option key={learner.id} value={learner.id}>
                      {learner.fullName}
                      {learner.className ? ` · ${learner.className}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          <Field label="Expires in (days)" hint="1–30; the link stops working after that">
            <Input
              type="number"
              min={1}
              max={30}
              value={form.expiresInDays}
              onChange={(event) => setForm((prev) => ({ ...prev, expiresInDays: event.target.value }))}
            />
          </Field>
        </form>
      </Modal>

      {/* ----------------------------------------------------- handover body */}
      <Modal
        open={Boolean(handover)}
        onClose={() => setHandover(null)}
        title="Invitation ready to hand over"
        description="This link is shown once. Send it to the person; they set their own password on the activation screen."
        size="md"
        footer={
          <Button onClick={() => setHandover(null)}>Done</Button>
        }
      >
        {handover ? (
          <div className="space-y-3">
            <Note tone="success" title={`${handover.invitation.fullName} · ${ROLE_LABEL[handover.invitation.role]}`}>
              Expires {formatDateTime(handover.expiresAt)}.
            </Note>
            <div className="flex flex-wrap items-center gap-2">
              <Input readOnly value={handover.invitationUrl} aria-label="Invitation link" className="min-w-0 flex-1 font-mono text-xs" />
              <Button variant="outline" onClick={() => void copyLink(handover.invitationUrl)}>
                <Copy className="h-4 w-4" aria-hidden /> Copy
              </Button>
            </div>
            <p className="text-xs text-ink-muted">
              Only the hash of this token is stored, so it cannot be shown again — create a new invitation if the link is lost.
            </p>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(revoking)}
        title="Revoke this invitation?"
        description={
          revoking
            ? `${revoking.fullName} (${revoking.email}) will no longer be able to use that link. You can always invite them again.`
            : ''
        }
        confirmLabel="Revoke invitation"
        tone="danger"
        pending={revoke.pending}
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          if (revoking) void revoke.submit(revoking).catch(() => undefined);
        }}
      />

      {revoke.error ? (
        <Note tone="danger" title="The invitation could not be revoked">
          {revoke.error}
        </Note>
      ) : null}

      <Card>
        <CardBody className="flex flex-wrap items-start gap-3 text-sm text-ink-muted">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <p className="min-w-0">
            Assessment numbers are school records and are never used on their own to prove who a guardian is. A guardian who
            registers themselves is linked only after the office verifies the record.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
