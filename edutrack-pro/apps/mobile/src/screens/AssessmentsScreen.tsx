import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AssessmentDto } from '@edutrack/shared-types';
import { Banner, Card, Empty, Row, Screen } from '../components/ui';
import { useApi } from '../components/useApi';
import { formatDate } from '../lib/format';
import { colors, spacing } from '../lib/theme';

/** A teacher's assessment list with completion, so gaps are visible from the staffroom. */
export function AssessmentsScreen() {
  const assessments = useApi<AssessmentDto[]>('/assessments', { pageSize: 100 });
  const dashboard = useApi<{ counts?: { drafts: number; published: number; awaitingReview: number }; missingResults?: AssessmentDto[] }>('/assessments/dashboard');

  return (
    <Screen title="Assessments" onRefresh={() => void assessments.reload()} refreshing={assessments.loading}>
      <Card title="Summary">
        <Row label="Drafts" value={dashboard.data?.counts?.drafts ?? 0} />
        <Row label="Awaiting review" value={dashboard.data?.counts?.awaitingReview ?? 0} tone={colors.warning} />
        <Row label="Published" value={dashboard.data?.counts?.published ?? 0} tone={colors.success} />
        <Row label="Missing result entries" value={dashboard.data?.missingResults?.length ?? 0} tone={(dashboard.data?.missingResults?.length ?? 0) > 0 ? colors.warning : colors.muted} />
      </Card>

      <Banner tone="info">Entering and publishing marks is done on the web workspace: a results grid needs a wider screen and a keyboard. Here you can see what is outstanding.</Banner>

      <Card title="My assessments">
        {(assessments.data ?? []).length === 0 ? (
          <Empty title="No assessments yet" hint="Create one on the web workspace once the class and learning area are set up." />
        ) : (
          (assessments.data ?? []).map((assessment) => (
            <View key={assessment.id} style={styles.item}>
              <Text style={styles.title}>{assessment.title}</Text>
              <Text style={styles.meta}>
                {assessment.className} · {assessment.learningAreaName} · {assessment.categoryName} · {formatDate(assessment.assessmentDate)}
              </Text>
              <Text style={styles.status}>
                {assessment.status.replace(/_/g, ' ').toLowerCase()}
                {assessment.resultSummary ? ` · ${assessment.resultSummary.entered}/${assessment.resultSummary.totalLearners} entered` : ''}
                {assessment.resultSummary?.missing ? ` · ${assessment.resultSummary.missing} missing` : ''}
              </Text>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  status: { fontSize: 12, color: colors.info, marginTop: 3, fontWeight: '600' },
});
