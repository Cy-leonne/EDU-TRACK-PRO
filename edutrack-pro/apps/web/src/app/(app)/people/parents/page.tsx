'use client';

import { useMemo, useState } from 'react';
import { BadgeCheck, Link2, Pencil, Plus, ShieldQuestion, UserRound } from 'lucide-react';
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
  Select,
  Skeleton,
  Table,
  Tabs,
  Td,
  Th,
  useToast,
} from '@/components/ui';
import { formatDate, formatRelative } from '@/lib/utils';
import type { GuardianLink, LearnerSummary, ParentSummary } from '@/lib/types';

const RELATIONSHIPS = ['Mother', 'Father', 'Guardian', 'Grandparent', 'Aunt', 'Uncle', 'Sibling', 'Sponsor', 'Other'];

export default function ParentsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('links');

  /* ------------------------------------------------------------- parents */
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const parents = useApiQuery<ParentSummary[]>('/parents', { query: { search: debounced || undefined, pageSize: 100 } });
  const links = useApiQuery<GuardianLink[]>('/parent-links', { query: { pageSize: 200 } });
  const learners = useApiQuery<LearnerSummary[]>('/learners', { query: { pageSize: 200, status: 'ACTIVE' } });

  const [creatingParent, setCreatingParent] = useState(false);
  const [editingParent, setEditingParent] = useState<ParentSummary | null>(null);
  const [linkModal, setLinkModal] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [parentForm, setParentForm] = useState({ fullName: '', email: '', phone: '', altPhone: '', relationship: 'Parent', occupation: '', addressLine: '', temporaryPassword: '' });
  const [linkForm, setLinkForm] = useState({ parentProfileId: '', learnerId: '', relationship: 'Parent', isPrimaryContact: false, isVerified: false, verificationMethod: 'ADMIN_RECORD', canViewResults: true, canViewResources: true, notes: '' });

  const parentList = useMemo(() => parents.data ?? [], [parents.data]);
  const linkList = useMemo(() => links.data ?? [], [links.data]);
  const unverified = linkList.filter((link) => !link.isVerified);

  const saveParent = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    const payload: Record<string, unknown> = {
      ...parentForm,
      altPhone: parentForm.altPhone || null,
      occupation: parentForm.occupation || null,
      addressLine: parentForm.addressLine || null,
    };
    if (!parentForm.temporaryPassword) delete payload.temporaryPassword;
    try {
      if (editingParent) {
        delete payload.temporaryPassword;
        await api.patch(`/parents/${editingParent.id}`, payload);
        toast.success('Guardian updated');
      } else {
        const created = await api.post<{ temporaryPassword?: string }>('/parents', payload);
        toast.success('Guardian created', created?.temporaryPassword ? `Temporary password: ${created.temporaryPassword}` : undefined);
      }
      setCreatingParent(false);
      setEditingParent(null);
      await parents.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Saving failed.');
    } finally {
      setPending(false);
    }
  };

  const createLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    try {
      await api.post('/parent-links', {
        ...linkForm,
        verificationMethod: linkForm.isVerified ? linkForm.verificationMethod : null,
        notes: linkForm.notes || null,
      });
      toast.success('Link created', linkForm.isVerified ? 'The link is verified.' : 'The link awaits verification.');
      setLinkModal(false);
      setLinkForm({ parentProfileId: '', learnerId: '', relationship: 'Parent', isPrimaryContact: false, isVerified: false, verificationMethod: 'ADMIN_RECORD', canViewResults: true, canViewResources: true, notes: '' });
      await links.reload();
      await parents.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Could not create the link.');
    } finally {
      setPending(false);
    }
  };

  /**
   * Verification is what grants a guardian access, and it is recorded with the
   * method the school used. It cannot be undone silently: access is withdrawn by
   * revoking the link (a separate, audited action).
   */
  const verify = async (link: GuardianLink, method: 'ADMIN_RECORD' | 'DOCUMENT' | 'ASSESSMENT_NUMBER_AND_ID' = 'ADMIN_RECORD') => {
    try {
      await api.post(`/parent-links/${link.id}/verify`, { method });
      toast.success('Link verified', `${link.parent?.name} can now see ${link.learner?.name}'s released records.`);
      await links.reload();
      await parents.reload();
    } catch (caught) {
      toast.error('Could not verify the link', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const toggleAccess = async (link: GuardianLink, field: 'canViewResults' | 'canViewResources') => {
    try {
      await api.patch(`/parent-links/${link.id}`, { [field]: !link[field] });
      toast.success('Access updated', `${field === 'canViewResults' ? 'Results' : 'Resources'} ${link[field] ? 'hidden from' : 'shown to'} ${link.parent?.name}.`);
      await links.reload();
    } catch (caught) {
      toast.error('Could not update access', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const revoke = async (link: GuardianLink) => {
    if (!window.confirm(`Revoke the link between ${link.parent?.name} and ${link.learner?.name}? They will immediately lose access to that learner's records.`)) return;
    try {
      await api.del(`/parent-links/${link.id}`);
      toast.success('Link revoked');
      await links.reload();
      await parents.reload();
    } catch (caught) {
      toast.error('Could not revoke', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Parents & guardians"
        description="Guardian accounts see only the learners the school has linked and verified."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setLinkModal(true)}>
              <Link2 className="h-4 w-4" aria-hidden /> Link a learner
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setParentForm({ fullName: '', email: '', phone: '', altPhone: '', relationship: 'Parent', occupation: '', addressLine: '', temporaryPassword: '' });
                setCreatingParent(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden /> Add guardian
            </Button>
          </>
        }
      />

      {unverified.length ? (
        <Note tone="warning" title={`${unverified.length} link(s) awaiting verification`}>
          <p>
            An unverified link does not expose results. Verify it after checking the guardian against the admission register — this is what stops one
            parent from seeing another family&apos;s learner.
          </p>
        </Note>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'links', label: 'Guardian links', badge: linkList.length || undefined },
          { id: 'parents', label: 'Guardian accounts', badge: parentList.length || undefined },
        ]}
      />

      {tab === 'links' ? (
        <Card>
          <CardHeader title="Guardian ↔ learner links" description="Each link can be limited to results, to resources, or both." />
          <CardBody>
            {links.loading ? (
              <Skeleton className="h-40" />
            ) : links.error ? (
              <ErrorState message={links.error} onRetry={() => links.reload()} />
            ) : linkList.length === 0 ? (
              <EmptyState title="No guardian links yet" description="Link a guardian to a learner to give them access to that learner's published records." icon={<Link2 className="h-6 w-6" aria-hidden />} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Guardian</Th>
                    <Th>Learner</Th>
                    <Th>Relationship</Th>
                    <Th>Access</Th>
                    <Th>Status</Th>
                    <Th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {linkList.map((link) => (
                    <tr key={link.id} className="hover:bg-slate-50">
                      <Td>
                        <span className="block font-medium text-slate-800">{link.parent?.name}</span>
                        <span className="block text-xs text-slate-500">{link.parent?.email}</span>
                      </Td>
                      <Td>
                        <span className="block text-sm text-slate-800">{link.learner?.name}</span>
                        <span className="block text-xs text-slate-500">
                          {link.learner?.className} · {link.learner?.admissionNumber}
                        </span>
                      </Td>
                      <Td>{link.relationship}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {link.canViewResults ? <Badge tone="info">results</Badge> : null}
                          {link.canViewResources ? <Badge tone="info">resources</Badge> : null}
                          {!link.canViewResults && !link.canViewResources ? <Badge tone="danger">no access</Badge> : null}
                        </div>
                      </Td>
                      <Td>
                        {link.isVerified ? (
                          <span className="flex flex-col">
                            <Badge tone="success">
                              <BadgeCheck className="h-3 w-3" aria-hidden /> verified
                            </Badge>
                            <span className="mt-0.5 text-[11px] text-slate-400">{formatDate(link.verifiedAt)}</span>
                          </span>
                        ) : (
                          <Badge tone="warning">
                            <ShieldQuestion className="h-3 w-3" aria-hidden /> pending
                          </Badge>
                        )}
                        {link.isPrimaryContact ? <span className="mt-1 block text-[11px] text-slate-500">primary contact</span> : null}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap justify-end gap-1">
                          {link.isVerified ? null : (
                            <Button variant="secondary" size="sm" onClick={() => verify(link)}>
                              <BadgeCheck className="h-4 w-4" aria-hidden /> Verify
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => toggleAccess(link, 'canViewResults')}>
                            {link.canViewResults ? 'Hide results' : 'Show results'}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => toggleAccess(link, 'canViewResources')}>
                            {link.canViewResources ? 'Hide resources' : 'Show resources'}
                          </Button>
                          <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50" onClick={() => revoke(link)}>
                            Revoke
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="Guardian accounts"
            description="One account per guardian; several children can be linked to the same account."
            actions={<Input className="w-full sm:w-64" placeholder="Search name, email or phone" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search guardians" />}
          />
          <CardBody>
            {parents.loading ? (
              <Skeleton className="h-40" />
            ) : parents.error ? (
              <ErrorState message={parents.error} onRetry={() => parents.reload()} />
            ) : parentList.length === 0 ? (
              <EmptyState title="No guardian accounts" description="Add a guardian, then link them to their children." icon={<UserRound className="h-6 w-6" aria-hidden />} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Guardian</Th>
                    <Th>Contact</Th>
                    <Th>Linked learners</Th>
                    <Th>Last sign-in</Th>
                    <Th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {parentList.map((parent) => (
                    <tr key={parent.id} className="hover:bg-slate-50">
                      <Td>
                        <span className="block font-medium text-slate-800">{parent.fullName}</span>
                        <span className="block text-xs text-slate-500">
                          {parent.relationship} {parent.occupation ? `· ${parent.occupation}` : ''}
                        </span>
                      </Td>
                      <Td>
                        <span className="block text-xs text-slate-600">{parent.email}</span>
                        <span className="block text-xs text-slate-400">{parent.phone}</span>
                      </Td>
                      <Td>
                        {parent.linkedLearners?.length ? (
                          <ul className="space-y-0.5">
                            {parent.linkedLearners.map((learner) => (
                              <li key={learner.linkId} className="flex items-center gap-1 text-xs">
                                <span className="text-slate-700">{learner.fullName}</span>
                                <span className="text-slate-400">({learner.className})</span>
                                {learner.isVerified ? (
                                  <BadgeCheck className="h-3 w-3 text-success" aria-label="verified" />
                                ) : (
                                  <ShieldQuestion className="h-3 w-3 text-amber-500" aria-label="awaiting verification" />
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-xs text-slate-400">none</span>
                        )}
                      </Td>
                      <Td>
                        <span className="text-xs text-slate-500">{parent.lastLoginAt ? formatRelative(parent.lastLoginAt) : 'never'}</span>
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-1">
                          {!parent.isActive ? <Badge tone="danger">disabled</Badge> : null}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingParent(parent);
                              setParentForm({
                                fullName: parent.fullName,
                                email: parent.email,
                                phone: parent.phone ?? '',
                                altPhone: '',
                                relationship: parent.relationship ?? 'Parent',
                                occupation: parent.occupation ?? '',
                                addressLine: '',
                                temporaryPassword: '',
                              });
                            }}
                            aria-label={`Edit ${parent.fullName}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------------------ parent modal */}
      <Modal
        open={creatingParent || Boolean(editingParent)}
        onClose={() => {
          setCreatingParent(false);
          setEditingParent(null);
        }}
        title={editingParent ? `Edit ${editingParent.fullName}` : 'Add a parent or guardian'}
        description="Guardian accounts sign in with email. A learner's assessment number alone never grants access."
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreatingParent(false);
                setEditingParent(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="parent-form" loading={pending}>
              {editingParent ? 'Save changes' : 'Create account'}
            </Button>
          </>
        }
      >
        <form id="parent-form" className="space-y-3" onSubmit={saveParent}>
          {formError ? <ErrorState message={formError} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" required>
              <Input required value={parentForm.fullName} onChange={(event) => setParentForm({ ...parentForm, fullName: event.target.value })} />
            </Field>
            <Field label="Email address" required>
              <Input type="email" required value={parentForm.email} onChange={(event) => setParentForm({ ...parentForm, email: event.target.value })} />
            </Field>
            <Field label="Phone" required>
              <Input required value={parentForm.phone} onChange={(event) => setParentForm({ ...parentForm, phone: event.target.value })} placeholder="+2547..." />
            </Field>
            <Field label="Alternative phone">
              <Input value={parentForm.altPhone} onChange={(event) => setParentForm({ ...parentForm, altPhone: event.target.value })} />
            </Field>
            <Field label="Relationship">
              <Select value={parentForm.relationship} onChange={(event) => setParentForm({ ...parentForm, relationship: event.target.value })}>
                {RELATIONSHIPS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Occupation">
              <Input value={parentForm.occupation} onChange={(event) => setParentForm({ ...parentForm, occupation: event.target.value })} />
            </Field>
            {!editingParent ? (
              <Field label="Temporary password" hint="Leave blank to let the system generate one" className="sm:col-span-2">
                <Input value={parentForm.temporaryPassword} onChange={(event) => setParentForm({ ...parentForm, temporaryPassword: event.target.value })} />
              </Field>
            ) : null}
          </div>
        </form>
      </Modal>

      {/* -------------------------------------------------------- link modal */}
      <Modal
        open={linkModal}
        onClose={() => setLinkModal(false)}
        title="Link a guardian to a learner"
        description="A verified link is required before the guardian can see any of that learner's records."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLinkModal(false)}>
              Cancel
            </Button>
            <Button type="submit" form="link-form" loading={pending}>
              Create link
            </Button>
          </>
        }
      >
        <form id="link-form" className="space-y-3" onSubmit={createLink}>
          {formError ? <ErrorState message={formError} /> : null}
          <Field label="Guardian" required>
            <Select required value={linkForm.parentProfileId} onChange={(event) => setLinkForm({ ...linkForm, parentProfileId: event.target.value })}>
              <option value="">Select a guardian</option>
              {parentList.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.fullName} · {parent.email}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Learner" required>
            <Select required value={linkForm.learnerId} onChange={(event) => setLinkForm({ ...linkForm, learnerId: event.target.value })}>
              <option value="">Select a learner</option>
              {(learners.data ?? []).map((learner) => (
                <option key={learner.id} value={learner.id}>
                  {learner.fullName} · {learner.className ?? learner.gradeName} · {learner.admissionNumber}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Relationship">
              <Select value={linkForm.relationship} onChange={(event) => setLinkForm({ ...linkForm, relationship: event.target.value })}>
                {RELATIONSHIPS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Verification method" hint="Recorded for audit purposes">
              <Select value={linkForm.verificationMethod} onChange={(event) => setLinkForm({ ...linkForm, verificationMethod: event.target.value })} disabled={!linkForm.isVerified}>
                <option value="ADMIN_RECORD">Checked against admission register</option>
                <option value="DOCUMENT">Identity document seen</option>
                <option value="ASSESSMENT_NUMBER_AND_ID">Assessment number plus ID (verified in person)</option>
              </Select>
            </Field>
          </div>
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <Checkbox label="Mark this link as verified now" checked={linkForm.isVerified} onChange={(event) => setLinkForm({ ...linkForm, isVerified: event.target.checked })} />
            <Checkbox label="Primary contact for this learner" checked={linkForm.isPrimaryContact} onChange={(event) => setLinkForm({ ...linkForm, isPrimaryContact: event.target.checked })} />
            <Checkbox label="Can view results" checked={linkForm.canViewResults} onChange={(event) => setLinkForm({ ...linkForm, canViewResults: event.target.checked })} />
            <Checkbox label="Can view resources and assignments" checked={linkForm.canViewResources} onChange={(event) => setLinkForm({ ...linkForm, canViewResources: event.target.checked })} />
          </div>
        </form>
      </Modal>
    </div>
  );
}
