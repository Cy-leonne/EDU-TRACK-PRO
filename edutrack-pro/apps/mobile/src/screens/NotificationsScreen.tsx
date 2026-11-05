import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Banner, Button, Card, Empty, Screen } from '../components/ui';
import { useApi } from '../components/useApi';
import { api } from '../api/client';
import type { NotificationDto } from '@edutrack/shared-types';
import { formatRelative } from '../lib/format';
import { notificationLabel } from '../lib/notifications';
import { colors, spacing } from '../lib/theme';

/** In-app inbox. Tapping an item marks it read; nothing is deleted. */
export function NotificationsScreen() {
  const inbox = useApi<NotificationDto[]>('/notifications', { pageSize: 50 });
  const unread = (inbox.data ?? []).filter((item) => !item.readAt);

  const markAll = async () => {
    await api.post('/notifications/read-all');
    await inbox.reload();
  };

  const markOne = async (id: string) => {
    await api.patch(`/notifications/${id}/read`);
    await inbox.reload();
  };

  return (
    <Screen title="Notifications" subtitle={unread.length ? `${unread.length} unread` : 'All read'} onRefresh={() => void inbox.reload()} refreshing={inbox.loading}>
      {inbox.error ? <Banner tone="danger">{inbox.error}</Banner> : null}
      {unread.length > 0 ? <Button label="Mark all as read" variant="secondary" onPress={() => void markAll()} /> : null}

      <Card>
        {(inbox.data ?? []).length === 0 ? (
          <Empty title="No notifications yet" hint="You will be alerted when a result is published, work is set, or a hand-in is reviewed." />
        ) : (
          (inbox.data ?? []).map((item) => (
            <Pressable key={item.id} onPress={() => !item.readAt && void markOne(item.id)} style={[styles.item, !item.readAt && styles.unread]}>
              <Text style={styles.title}>{item.title}</Text>
              {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
              <Text style={styles.meta}>
                {notificationLabel(item.type)} · {formatRelative(item.createdAt)} · {item.readAt ? 'read' : 'unread'}
              </Text>
            </Pressable>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  unread: { backgroundColor: '#F5F9FF' },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  body: { fontSize: 12, color: colors.text, marginTop: 3, lineHeight: 18 },
  meta: { fontSize: 11, color: colors.muted, marginTop: 3 },
});
