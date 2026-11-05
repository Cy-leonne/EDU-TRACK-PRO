import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Banner, Empty, Row, Screen } from '../components/ui';
import { useApi } from '../components/useApi';
import type { LearnerTimetableLesson, LearnerTimetablePayload, ParentDashboard, TeacherTimetablePayload } from '@edutrack/shared-types';
import { useSession } from '../lib/session';
import { dayName } from '../lib/format';
import { colors, spacing } from '../lib/theme';


/**
 * Timetable for the signed-in teacher, or for a guardian's linked learner.
 *
 * Guardians only ever receive a *published* version (the API refuses to serve a
 * draft), and neither role can edit it from here.
 */
export function TimetableScreen() {
  const { user } = useSession();
  const isParent = user?.role === 'PARENT';

  const parentDashboard = useApi<ParentDashboard>(isParent ? '/dashboard/parent' : null);
  const learnerId = parentDashboard.data?.selectedLearnerId ?? null;

  const timetable = useApi<LearnerTimetablePayload | TeacherTimetablePayload>(
    isParent ? (learnerId ? `/timetables/learner/${learnerId}` : null) : '/timetables/me',
  );
  const classLabel = isParent ? (timetable.data as LearnerTimetablePayload | null)?.className ?? null : null;

  const lessons = timetable.data?.lessons ?? [];
  const days = Array.from(new Set(lessons.map((lesson) => lesson.dayOfWeek))).sort((a, b) => a - b);

  return (
    <Screen
      title={isParent ? 'Class timetable' : 'My timetable'}
      subtitle={classLabel ? `${classLabel} · version ${timetable.data?.versionNumber ?? 1}` : undefined}
      onRefresh={() => void timetable.reload()}
      refreshing={timetable.loading}
    >
      {timetable.error ? <Banner tone="danger">{timetable.error}</Banner> : null}

      {!timetable.loading && !timetable.data?.published ? (
        <Empty title="No published timetable yet" hint="The school office publishes the timetable for each term. Once it is published it appears here automatically." />
      ) : null}

      {days.map((day) => (
        <View key={day} style={styles.day}>
          <Text style={styles.dayTitle}>{dayName(day)}</Text>
          {lessons
            .filter((lesson) => lesson.dayOfWeek === day)
            .map((lesson, index) => (
              <Row
                key={`${day}-${index}`}
                label={`${lesson.startTime}–${lesson.endTime}`}
                value={`${lesson.learningAreaName}${lesson.className && !isParent ? ` · ${lesson.className}` : ''}${
                  isParent && (lesson as LearnerTimetableLesson).teacherName ? ` · ${(lesson as LearnerTimetableLesson).teacherName}` : ''
                }`}
              />
            ))}
        </View>
      ))}

      {lessons.length > 0 ? (
        <Text style={styles.note}>
          {lessons.length} lesson(s) across {days.length} day(s). Timetable changes are made by the school office and published as a new version — this screen always
          shows the version currently in force.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  day: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  dayTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  note: { fontSize: 12, color: colors.muted, lineHeight: 18, marginTop: spacing.sm },
});
