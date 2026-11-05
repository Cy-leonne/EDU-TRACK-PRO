import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Banner, Card, Empty, Row, Screen } from '../components/ui';
import { useApi } from '../components/useApi';
import { useSession } from '../lib/session';
import { formatDate } from '../lib/format';
import { colors, spacing } from '../lib/theme';

interface Result {
  id: string;
  assessmentTitle: string;
  learningAreaName: string;
  categoryName: string;
  assessmentDate: string;
  numericScore?: number | null;
  totalMarks?: number | null;
  percent?: number | null;
  achievementLevel?: { label: string } | null;
  comment?: string | null;
  wasCorrected?: boolean;
  isAbsent?: boolean;
  isExcused?: boolean;
}

/** Published results for a guardian's child. Drafts are never sent to a guardian. */
export function ResultsScreen() {
  const { user } = useSession();
  const dashboard = useApi<{ selectedLearnerId?: string | null; learners: Array<{ id: string; fullName: string; className: string }> }>('/dashboard/parent');
  const learnerId = dashboard.data?.selectedLearnerId ?? null;

  const results = useApi<{ results: Result[] }>(learnerId ? `/results/learner/${learnerId}` : null);
  const progress = useApi<Array<{ learningAreaName: string; averagePercent: number; latestAchievement?: string | null; trend: string }>>(
    learnerId ? `/results/learner/${learnerId}/progress` : null,
  );

  const learner = dashboard.data?.learners.find((item) => item.id === learnerId);

  if (user?.role !== 'PARENT') {
    return (
      <Screen title="Results">
        <Banner tone="info">Mark entry and publication happen on the web workspace, where a teacher works with a full results grid and a keyboard.</Banner>
      </Screen>
    );
  }

  return (
    <Screen title="Results" subtitle={learner ? `${learner.fullName} · ${learner.className}` : undefined} onRefresh={() => void results.reload()} refreshing={results.loading}>
      {results.error ? <Banner tone="danger">{results.error}</Banner> : null}

      {(progress.data ?? []).length > 0 ? (
        <Card title="Progress by learning area">
          {progress.data?.map((area) => (
            <Row
              key={area.learningAreaName}
              label={area.learningAreaName}
              value={`${area.averagePercent}%${area.latestAchievement ? ` · ${area.latestAchievement}` : ''}${area.trend === 'UP' ? ' ↑' : area.trend === 'DOWN' ? ' ↓' : ''}`}
            />
          ))}
        </Card>
      ) : null}

      <Card title="Published results">
        {(results.data?.results ?? []).length === 0 ? (
          <Empty title="No published results yet" hint="A teacher publishes a result once marking and moderation are complete." />
        ) : (
          results.data?.results.map((result) => (
            <View key={result.id} style={styles.result}>
              <Text style={styles.resultTitle}>{result.assessmentTitle}</Text>
              <Text style={styles.resultMeta}>
                {result.learningAreaName} · {result.categoryName} · {formatDate(result.assessmentDate)}
              </Text>
              <Text style={styles.resultScore}>
                {result.isAbsent ? 'Absent' : result.isExcused ? 'Excused' : `${result.numericScore ?? '—'}${result.totalMarks ? ` / ${result.totalMarks}` : ''}${result.percent != null ? ` (${result.percent}%)` : ''}`}
                {result.achievementLevel?.label ? ` · ${result.achievementLevel.label}` : ''}
              </Text>
              {result.wasCorrected ? <Text style={styles.corrected}>Corrected after publishing — the teacher recorded a reason.</Text> : null}
              {result.comment ? <Text style={styles.comment}>{result.comment}</Text> : null}
            </View>
          ))
        )}
      </Card>

      <Text style={styles.note}>
        Achievement bands shown here are the school&apos;s own definitions, not official national grades. Talk to the class teacher if a mark looks wrong.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  result: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  resultTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  resultMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  resultScore: { fontSize: 14, color: colors.text, marginTop: 4, fontWeight: '600' },
  corrected: { fontSize: 12, color: colors.warning, marginTop: 2 },
  comment: { fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 17 },
  note: { fontSize: 12, color: colors.muted, lineHeight: 18, marginTop: spacing.sm },
});
