'use client';

import { useState } from 'react';
import { BellRing, Check, CheckCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/hooks';
import { useFamily } from '@/lib/family';
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
  Note,
  PageHeader,
  Skeleton,
  Tabs,
  useToast,
} from '@/components/ui';
import { formatDateTime, formatRelative, titleCase } from '@/lib/utils';
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS } from '@/lib/notifications';
import type { NotificationItem, NotificationPreference } from '@/lib/types';

/**
 * The mute switches are built from the same list the server validates against, so
 * a type can never be displayed but rejected (or expected but never emitted).
 */
const TYPES = NOTIFICATION_TYPES.map((id) => ({
  id,
  label: NOTIFICATION_TYPE_LABELS[id],
}));

export default function FamilyNotificationsPage() {
  const toast = useToast();
  const family = useFamily();
  const [tab, setTab] = useState('inbox');
  const [pending, setPending] = useState(false);

  const inbox = useApiQuery<NotificationItem[] | { items: NotificationItem[] }>('/notifications', { query: { pageSize: 50 } });
  const preferences = useApiQuery<NotificationPreference>('/notifications/preferences');

  const items = Array.isArray(inbox.data) ? inbox.data : inbox.data?.items ?? [];
  const unread = items.filter((item) => !item.readAt);

  const markRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      await inbox.reload();
      await family.reload(true);
    } catch (caught) {
      toast.error('Could not update that notification', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const markAll = async () => {
    setPending(true);
    try {
      await api.post('/notifications/read-all');
      toast.success('All notifications marked as read');
      await inbox.reload();
      await family.reload(true);
    } catch (caught) {
      toast.error('Could not update notifications', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const savePreferences = async (patch: Partial<NotificationPreference>) => {
    setPending(true);
    try {
      await api.patch('/notifications/preferences', patch);
      toast.success('Preferences saved');
      await preferences.reload();
    } catch (caught) {
      toast.error('Could not save preferences', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const prefs = preferences.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Notifications"
        description="In-app alerts about your child's results, timetable and hand-ins."
        actions={
          unread.length ? (
            <Button size="sm" variant="outline" onClick={markAll} loading={pending}>
              <CheckCheck className="h-4 w-4" aria-hidden /> Mark all read
            </Button>
          ) : undefined
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'inbox', label: 'Inbox', badge: unread.length || undefined },
          { id: 'preferences', label: 'Preferences' },
        ]}
      />

      {tab === 'inbox' ? (
        <Card>
          <CardHeader title={`${items.length} notification(s)`} description="Newest first. Nothing is deleted — unread items stay until you read them." />
          <CardBody>
            {inbox.loading ? (
              <Skeleton className="h-40" />
            ) : inbox.error ? (
              <ErrorState message={inbox.error} onRetry={() => inbox.reload()} />
            ) : items.length === 0 ? (
              <EmptyState title="No notifications yet" description="You will be alerted here when a result is published or an assignment is set." icon={<BellRing className="h-6 w-6" aria-hidden />} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((item) => (
                  <li key={item.id} className={`flex flex-wrap items-start justify-between gap-3 py-3 ${item.readAt ? '' : 'bg-brand-soft/40'}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{item.title}</span>
                        <Badge tone={item.readAt ? 'neutral' : 'info'}>{titleCase(item.type)}</Badge>
                        {item.channels?.length ? <span className="text-[11px] text-slate-400">via {item.channels.map((channel) => channel.toLowerCase()).join(', ')}</span> : null}
                      </div>
                      {item.body ? <p className="mt-1 text-xs text-slate-600">{item.body}</p> : null}
                      <p className="mt-1 text-[11px] text-slate-400">
                        {formatDateTime(item.createdAt)} · {formatRelative(item.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.link ? (
                        <a href={item.link.startsWith('/') ? item.link.replace('/parent/', '/family/') : item.link} className="text-xs font-semibold text-royal hover:underline">
                          Open
                        </a>
                      ) : null}
                      {!item.readAt ? (
                        <Button variant="ghost" size="sm" onClick={() => markRead(item.id)}>
                          <Check className="h-3.5 w-3.5" aria-hidden /> Mark read
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'preferences' ? (
        <Card>
          <CardHeader title="How you are contacted" description="In-app notifications always work. Email is optional and needs the school's mail service to be configured." />
          <CardBody className="space-y-4">
            {preferences.loading || !prefs ? (
              <Skeleton className="h-32" />
            ) : (
              <>
                <div className="space-y-2">
                  <Checkbox
                    label="Show notifications in the app"
                    checked={prefs.inAppEnabled}
                    onChange={(event) => savePreferences({ inAppEnabled: event.target.checked })}
                  />
                  <Checkbox
                    label="Also send me an email about important events"
                    checked={prefs.emailEnabled}
                    onChange={(event) => savePreferences({ emailEnabled: event.target.checked })}
                  />
                </div>

                {prefs.emailEnabled ? (
                  <Field label="Email address" hint="Recorded on your guardian profile — ask the office to change it">
                    <Input value={prefs.emailAddress ?? ''} disabled />
                  </Field>
                ) : null}

                {prefs.emailEnabled && !prefs.emailDeliveryConfigured ? (
                  <Note tone="warning" title="Email delivery is not configured on this deployment">
                    <p>
                      This server has no email provider configured (currently “{prefs.emailProvider ?? 'console'}”), so messages are written to the deployment log
                      instead of being sent. Ask the administrator to configure SMTP — the switch above keeps your preference on file either way.
                    </p>
                  </Note>
                ) : null}

                <div>
                  <p className="text-sm font-medium text-slate-800">Mute specific events</p>
                  <p className="mb-2 text-xs text-slate-500">Muted events stay in the inbox but stop the email copy.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {TYPES.map((type) => (
                      <Checkbox
                        key={type.id}
                        label={type.label}
                        checked={!prefs.mutedTypes?.includes(type.id)}
                        onChange={(event) => {
                          const muted = new Set(prefs.mutedTypes ?? []);
                          if (event.target.checked) muted.delete(type.id);
                          else muted.add(type.id);
                          savePreferences({ mutedTypes: Array.from(muted) });
                        }}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
