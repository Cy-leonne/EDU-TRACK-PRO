import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, spacing } from '../lib/theme';

/** Small, dependency-free UI kit so the mobile app stays light and readable. */

export function Screen({ title, subtitle, children, refreshing, onRefresh }: { title: string; subtitle?: string; children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {refreshing ? <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} /> : null}
      {onRefresh ? (
        <Pressable onPress={onRefresh} style={styles.refresh} accessibilityRole="button">
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      ) : null}
      {children}
    </ScrollView>
  );
}

export function Card({ title, children, tone }: { title?: string; children: React.ReactNode; tone?: string }) {
  return (
    <View style={[styles.card, tone ? { borderLeftColor: tone, borderLeftWidth: 4 } : null]}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

export function Button({ label, onPress, variant = 'primary', loading, disabled }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost'; loading?: boolean; disabled?: boolean }) {
  const style = variant === 'primary' ? styles.buttonPrimary : variant === 'secondary' ? styles.buttonSecondary : styles.buttonGhost;
  const text = variant === 'primary' ? styles.buttonPrimaryText : styles.buttonSecondaryText;
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={[style, (disabled || loading) && styles.buttonDisabled]} accessibilityRole="button">
      {loading ? <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.brand} /> : <Text style={text}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.muted} autoCapitalize="none" {...props} />
    </View>
  );
}

export function Banner({ tone, children }: { tone: 'info' | 'warning' | 'success' | 'danger'; children: React.ReactNode }) {
  const background = { info: '#EFF6FF', warning: '#FFFBEB', success: '#ECFDF5', danger: '#FEF2F2' }[tone];
  const border = { info: colors.info, warning: colors.warning, success: colors.success, danger: colors.danger }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: background, borderColor: border }]}>
      <Text style={{ color: colors.text, fontSize: 13, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  header: { marginBottom: spacing.md },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  refresh: { alignSelf: 'flex-start', marginBottom: spacing.md },
  refreshText: { color: colors.brand, fontWeight: '600', fontSize: 13 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  rowLabel: { fontSize: 13, color: colors.muted, flexShrink: 1 },
  rowValue: { fontSize: 13, color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: spacing.sm },
  buttonPrimary: { backgroundColor: colors.brand, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: spacing.sm },
  buttonPrimaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  buttonSecondary: { backgroundColor: colors.brandSoft, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  buttonSecondaryText: { color: colors.brand, fontWeight: '700', fontSize: 15 },
  buttonGhost: { paddingVertical: 10, alignItems: 'center', marginTop: spacing.xs },
  buttonDisabled: { opacity: 0.6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 15, color: colors.text, backgroundColor: '#FFFFFF' },
  banner: { borderWidth: 1, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md },
  empty: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  emptyHint: { fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'center' },
});
