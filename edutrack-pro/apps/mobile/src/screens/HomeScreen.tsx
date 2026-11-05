import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ParentDashboard, TeacherDashboard } from '@edutrack/shared-types';
import { Banner, Button, Card, Row, Screen } from '../components/ui';
import { useApi } from '../components/useApi';
import { useSession } from '../lib/session';
import { dayName, formatDateTime } from '../lib/format';
import { colors, spacing } from '../lib/theme';

/** Role-aware home. Admin sees a pointer to the desktop workspace; the phone is for teaching and family. */
export function HomeScreen({ go }: { go: (route: string) => void }) {
  const { user, signOut } = useSession();
  const isTeacher = user?.role === 'TEACHER';
  const isParent = user?.role === 'PARENT';

  const teacher = useApi<TeacherDashboard>(isTeacher ? '/dashboard/teacher' : null);
  const parent = useApi<ParentDashboard>(isParent ? '/dashboard/parent' : null);

  return (
    <Screen title={`Hello, ${user?.fullName?.split(' ')[0] ?? 'there'}`} subtitle={user?.schoolName ?? undefined} onRefresh={() => (isTeacher ? teacher.reload() : parent.reload())}>
      {user?.mustChangePassword ? (
        <Banner tone="warning">You are still using the temporary password issued by the office. Change it on the web portal as soon as you can.</Banner>
      ) : null}

      {isTeacher ? (
        <>
          <Card title={`Today · ${teacher.data?.today ? dayName(teacher.data.today.dayOfWeek) : '—'}`}>
            {(teacher.data?.today?.lessons ?? []).length === 0 ? (
              <Text style={styles.muted}>No lessons scheduled today.</Text>
            ) : (
              teacher.data?.today?.lessons.map((lesson, index) => (
                <Row key={`${lesson.startTime}-${index}`} label={`${lesson.startTime}–${lesson.endTime}`} value={`${lesson.learningAreaName} · ${lesson.className}${lesson.roomName ? ` · ${lesson.roomName}` : ''}`} />
              ))
            )}
          </Card>

          <Card title="This week">
            <Row label="Periods scheduled" value={teacher.data?.weeklyLoad?.totalPeriods ?? '—'} />
            <Row label="Workload limit" value={teacher.data?.weeklyLoad?.maxPeriodsPerWeek ?? '—'} />
            <Row label="Assessments in progress" value={teacher.data?.assessments?.inProgress ?? 0} />
            <Row label="Drafts with missing results" value={teacher.data?.assessments?.draftsWithMissingResults ?? 0} tone={colors.warning} />
          </Card>

          <Button label="My timetable" onPress={() => go('timetable')} />
          <Button label="Assessments" variant="secondary" onPress={() => go('assessments')} />
        </>
      ) : null}

      {isParent ? (
        <>
          {(parent.data?.learners ?? []).length === 0 ? (
            <Banner tone="info">No learner is linked to your account yet. The school office links and verifies each child before records appear here.</Banner>
          ) : (
            <Card title="My children">
              {(parent.data?.learners ?? []).map((learner) => (
                <Row key={learner.id} label={learner.fullName} value={learner.className} />
              ))}
            </Card>
          )}

          <Card title="Latest published results">
            {(parent.data?.latestResults ?? []).length === 0 ? (
              <Text style={styles.muted}>Results appear here once a teacher publishes them.</Text>
            ) : (
              parent.data?.latestResults.slice(0, 5).map((result) => (
                <Row key={result.id} label={result.assessmentTitle} value={`${result.scoreLabel}${result.achievementLabel ? ` · ${result.achievementLabel}` : ''}`} />
              ))
            )}
          </Card>

          <Card title="Assignments due">
            {(parent.data?.upcomingAssignments ?? []).length === 0 ? (
              <Text style={styles.muted}>Nothing outstanding.</Text>
            ) : (
              parent.data?.upcomingAssignments.slice(0, 5).map((assignment) => (
                <Row key={assignment.id} label={assignment.title} value={assignment.dueDate ?? 'no due date'} />
              ))
            )}
          </Card>

          <Button label="Results & progress" onPress={() => go('results')} />
          <Button label="Class timetable" variant="secondary" onPress={() => go('timetable')} />
        </>
      ) : null}

      {user?.role === 'ADMIN' ? (
        <Banner tone="info">
          School administration — teachers, classes, timetabling and exports — is done in the web workspace, which is designed for a desk and a larger screen. On the phone
          you can still review notifications and your school profile.
        </Banner>
      ) : null}

      <View style={styles.footer}>
        <Text style={styles.muted}>Signed in {user ? `as ${user.email}` : ''}</Text>
        <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  footer: { marginTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
});
