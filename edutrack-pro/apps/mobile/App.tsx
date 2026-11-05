import React, { useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SessionProvider, useSession } from './src/lib/session';
import { SignInScreen } from './src/screens/SignInScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { TimetableScreen } from './src/screens/TimetableScreen';
import { ResultsScreen } from './src/screens/ResultsScreen';
import { HandInScreen } from './src/screens/HandInScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { AssessmentsScreen } from './src/screens/AssessmentsScreen';
import { colors, spacing } from './src/lib/theme';

/**
 * EduTrack Pro — mobile shell.
 *
 * Navigation is a deliberately small state machine rather than a router library:
 * the app has a handful of screens per role, and this keeps the dependency
 * surface (and the app size on a low-end Android phone) small. Screens are chosen
 * by role so a teacher never sees a guardian's screen and vice versa.
 */

type Route = 'home' | 'timetable' | 'results' | 'handin' | 'notifications' | 'assessments';

function Shell() {
  const { user, restoring } = useSession();
  const [route, setRoute] = useState<Route>('home');

  if (restoring) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.loadingText}>Restoring your session…</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <SignInScreen />
      </SafeAreaView>
    );
  }

  const isParent = user.role === 'PARENT';

  const tabs: { id: Route; label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'timetable', label: 'Timetable' },
    ...(isParent
      ? ([
          { id: 'results', label: 'Results' },
          { id: 'handin', label: 'Hand in' },
        ] as { id: Route; label: string }[])
      : ([{ id: 'assessments', label: 'Assessments' }] as { id: Route; label: string }[])),
    { id: 'notifications', label: 'Alerts' },
  ];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.body}>
        {route === 'home' ? <HomeScreen go={(next) => setRoute(next as Route)} /> : null}
        {route === 'timetable' ? <TimetableScreen /> : null}
        {route === 'results' ? <ResultsScreen /> : null}
        {route === 'handin' ? <HandInScreen /> : null}
        {route === 'assessments' ? <AssessmentsScreen /> : null}
        {route === 'notifications' ? <NotificationsScreen /> : null}
      </View>
      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <Pressable key={tab.id} onPress={() => setRoute(tab.id)} style={styles.tab} accessibilityRole="button">
            <Text style={[styles.tabLabel, route === tab.id && styles.tabActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  loadingText: { marginTop: spacing.md, color: colors.muted, fontSize: 13 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: '#FFFFFF', paddingVertical: spacing.sm },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs },
  tabLabel: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  tabActive: { color: colors.brand },
});
