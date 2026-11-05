'use client';

import { useEffect, useState } from 'react';
import { KeyRound, LogOut, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  KeyValue,
  Note,
  PageHeader,
  Skeleton,
  Table,
  Tabs,
  Td,
  Th,
  useToast,
} from '@/components/ui';
import { formatDateTime, initials, titleCase } from '@/lib/utils';
import { NOTIFICATION_TYPE_LABELS } from '@/lib/notifications';
import type { NotificationPreference } from '@/lib/types';

interface MeResponse {
  id: string;
  email: string;
  fullName: string;
  role: string;
  schoolId: string;
  schoolName?: string;
  permissions: string[];
  lastLoginAt?: string | null;
  mustChangePassword?: boolean;
  teacherProfile?: { staffNumber?: string | null; phone?: string | null; employmentType?: string | null } | null;
  parentProfile?: { phone?: string | null; relationship?: string | null; occupation?: string | null } | null;
}

export default function AccountPage() {
  const toast = useToast();
  const { user, school, signOut, hasPermission } = useSession();
  const me = useApiQuery<MeResponse>('/auth/me');
  const preferences = useApiQuery<NotificationPreference>('/notifications/preferences');
  const [tab, setTab] = useState('profile');
  const [pending, setPending] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);

  const data = me.data;

  useEffect(() => {
    if (data?.mustChangePassword) setTab('security');
  }, [data?.mustChangePassword]);

  /** Revokes every refresh token on the account (server-side), then signs out here. */
  const signOutEverywhere = async () => {
    if (!confirmSignOutAll) {
      setConfirmSignOutAll(true);
      return;
    }
    setSigningOutAll(true);
    try {
      await api.post('/auth/logout-all', {});
      toast.success('Signed out everywhere', 'Every other device must sign in again.');
      await signOut();
    } catch (caught) {
      setPasswordError(caught instanceof ApiError ? caught.message : 'We could not sign out every device just now.');
      setConfirmSignOutAll(false);
    } finally {
      setSigningOutAll(false);
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    if (passwordForm.newPassword !== passwordForm.confirm) {
      setPasswordError('The two new passwords do not match.');
      return;
    }
    if (passwordForm.newPassword.length < 10) {
      setPasswordError('Use at least 10 characters — a short phrase is easiest to remember.');
      return;
    }
    setPending(true);
    try {
      await api.post('/auth/password/change', { currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword });
      toast.success('Password changed', 'Use the new password the next time you sign in.');
      setPasswordForm({ currentPassword: '', newPassword: '', confirm: '' });
      await me.reload();
    } catch (caught) {
      setPasswordError(caught instanceof ApiError ? caught.message : 'The password could not be changed.');
    } finally {
      setPending(false);
    }
  };

  const savePreferences = async (patch: Partial<NotificationPreference>) => {
    try {
      await api.patch('/notifications/preferences', patch);
      toast.success('Preferences saved');
      await preferences.reload();
    } catch (caught) {
      toast.error('Could not save preferences', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const prefs = preferences.data;
  const role = data?.role ?? user?.role;

  return (
    <div className="space-y-4">
      <PageHeader
        title="My account"
        description="Your sign-in details, contact information and how the school contacts you."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardBody className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-lg font-semibold text-brand-fg">
              {initials(data?.fullName ?? user?.fullName)}
            </span>
            <div className="min-w-0">
              {me.loading ? (
                <Skeleton className="h-8 w-40" />
              ) : (
                <>
                  <p className="truncate text-base font-semibold text-slate-800">{data?.fullName}</p>
                  <p className="truncate text-xs text-slate-500">{data?.email}</p>
                  <Badge tone="info" className="mt-1">
                    {role === 'ADMIN' ? 'Administrator' : role === 'TEACHER' ? 'Teacher' : 'Parent / Guardian'}
                  </Badge>
                </>
              )}
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="School" description="The school account this sign-in belongs to." />
          <CardBody>
            <KeyValue
              columns={2}
              items={[
                { label: 'School', value: data?.schoolName ?? school?.name ?? '—' },
                { label: 'Last sign-in', value: data?.lastLoginAt ? formatDateTime(data.lastLoginAt) : '—' },
                { label: 'Role', value: titleCase(role) },
                { label: 'Permissions', value: `${data?.permissions?.length ?? user?.permissions?.length ?? 0} granted` },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      {data?.mustChangePassword ? (
        <Note tone="warning" title="You are using a temporary password">
          <p>Change it below before continuing with day-to-day work.</p>
        </Note>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'profile', label: 'Profile' },
          { id: 'security', label: 'Password & security' },
          { id: 'contact', label: 'Notifications' },
        ]}
      />

      {tab === 'profile' ? (
        <Card>
          <CardHeader title="Your details" description="Held by the school office — ask an administrator to correct anything here." />
          <CardBody className="space-y-4">
            {me.loading ? (
              <Skeleton className="h-32" />
            ) : me.error ? (
              <ErrorState message={me.error} onRetry={() => me.reload()} />
            ) : (
              <>
                <KeyValue
                  columns={3}
                  items={[
                    { label: 'Full name', value: data?.fullName ?? '—' },
                    { label: 'Email (sign-in)', value: data?.email ?? '—' },
                    ...(role === 'TEACHER'
                      ? [
                          { label: 'Staff number', value: data?.teacherProfile?.staffNumber ?? '—' },
                          { label: 'Phone', value: data?.teacherProfile?.phone ?? '—' },
                          { label: 'Employment', value: titleCase(data?.teacherProfile?.employmentType) },
                        ]
                      : []),
                    ...(role === 'PARENT'
                      ? [
                          { label: 'Relationship to learner(s)', value: data?.parentProfile?.relationship ?? '—' },
                          { label: 'Phone', value: data?.parentProfile?.phone ?? '—' },
                          { label: 'Occupation', value: data?.parentProfile?.occupation ?? '—' },
                        ]
                      : []),
                  ]}
                />
                <Note tone="info" title="Why some fields are read-only">
                  <p>
                    Names, phone numbers and guardian relationships are part of the learner record, so they are changed by the school office rather than by
                    self-service. This keeps one authoritative copy of each record.
                  </p>
                </Note>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={signOut}>
                    <LogOut className="h-4 w-4" aria-hidden /> Sign out
                  </Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'security' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Change your password" description="Minimum ten characters. A short phrase works well." />
            <CardBody>
              <form className="space-y-3" onSubmit={changePassword}>
                {passwordError ? <ErrorState message={passwordError} /> : null}
                <Field label="Current password" required>
                  <Input
                    type="password"
                    required
                    autoComplete="current-password"
                    value={passwordForm.currentPassword}
                    onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })}
                  />
                </Field>
                <Field label="New password" required hint="Ten characters or more">
                  <Input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={passwordForm.newPassword}
                    onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })}
                  />
                </Field>
                <Field label="Repeat the new password" required>
                  <Input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={passwordForm.confirm}
                    onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })}
                  />
                </Field>
                <Button type="submit" loading={pending}>
                  <KeyRound className="h-4 w-4" aria-hidden /> Change password
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader
              title="Signed-in devices"
              description="Signing out everywhere revokes every refresh token on this account immediately — useful if you used a shared computer."
            />
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-xs leading-relaxed text-ink-muted">
                This device stays signed in until you sign out. Every other device has to sign in again with your email and
                password. {data?.lastLoginAt ? `Last sign-in recorded ${formatDateTime(data.lastLoginAt)}.` : ''}
              </p>
              <div className="flex flex-col items-end gap-2">
                <Button variant={confirmSignOutAll ? 'danger' : 'outline'} onClick={signOutEverywhere} loading={signingOutAll}>
                  <LogOut className="h-4 w-4" aria-hidden />
                  {confirmSignOutAll ? 'Yes — sign out everywhere' : 'Sign out of all devices'}
                </Button>
                {confirmSignOutAll ? (
                  <button type="button" className="text-xs font-semibold text-ink-muted hover:text-royal" onClick={() => setConfirmSignOutAll(false)}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="How this account is protected" />
            <CardBody>
              <Table>
                <thead>
                  <tr>
                    <Th>Control</Th>
                    <Th>Detail</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <Td className="text-sm text-slate-700">Password storage</Td>
                    <Td className="text-xs text-slate-600">Passwords are hashed with argon2id — nobody, including administrators, can read them.</Td>
                  </tr>
                  <tr>
                    <Td className="text-sm text-slate-700">Short-lived sessions</Td>
                    <Td className="text-xs text-slate-600">Access tokens expire quickly and are refreshed automatically in the background.</Td>
                  </tr>
                  <tr>
                    <Td className="text-sm text-slate-700">Rate limiting</Td>
                    <Td className="text-xs text-slate-600">Repeated failed sign-ins from one address are throttled.</Td>
                  </tr>
                  <tr>
                    <Td className="text-sm text-slate-700">Audit trail</Td>
                    <Td className="text-xs text-slate-600">Sign-ins and record changes are logged with the actor and time.</Td>
                  </tr>
                </tbody>
              </Table>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                <span>
                  Signed in as {data?.email ?? user?.email}. {hasPermission('audit:read') ? 'You can review the audit log from the sidebar.' : 'Contact an administrator if you notice unexpected activity.'}
                </span>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === 'contact' ? (
        <Card>
          <CardHeader title="How the school contacts you" description="In-app messages always work. Email requires the school's mail service to be configured." />
          <CardBody className="space-y-4">
            {preferences.loading || !prefs ? (
              <Skeleton className="h-24" />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <Mail className="h-4 w-4" aria-hidden /> Email notifications
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {prefs.emailEnabled ? 'Enabled' : 'Disabled'}
                      {prefs.emailAddress ? ` · ${prefs.emailAddress}` : ''}
                    </p>
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline"
                      onClick={() => savePreferences({ emailEnabled: !prefs.emailEnabled })}
                    >
                      {prefs.emailEnabled ? 'Turn off' : 'Turn on'}
                    </Button>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <UserRound className="h-4 w-4" aria-hidden /> In-app notifications
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{prefs.inAppEnabled ? 'Enabled' : 'Disabled'}</p>
                    <Button className="mt-2" size="sm" variant="outline" onClick={() => savePreferences({ inAppEnabled: !prefs.inAppEnabled })}>
                      {prefs.inAppEnabled ? 'Turn off' : 'Turn on'}
                    </Button>
                  </div>
                </div>
                {prefs.emailEnabled && !prefs.emailDeliveryConfigured ? (
                  <Note tone="warning" title="The server cannot send email yet">
                    <p>
                      No email provider is configured on this deployment (current provider: “{prefs.emailProvider ?? 'console'}”). Your preference is saved, and
                      messages will be queued in the notification list until an administrator configures SMTP.
                    </p>
                  </Note>
                ) : null}
                <p className="text-xs text-slate-500">
                  {prefs.mutedTypes?.length
                    ? `Muted: ${prefs.mutedTypes.map((type) => NOTIFICATION_TYPE_LABELS[type] ?? type).join(', ')}.`
                    : 'No event types are muted.'}{' '}
                  Manage the full list from the notifications screen.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={signOut}>
                    <LogOut className="h-4 w-4" aria-hidden /> Sign out
                  </Button>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
