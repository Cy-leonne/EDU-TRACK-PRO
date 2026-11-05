'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useApiQuery } from './hooks';

const STORAGE_KEY = 'edutrack.family.learnerId';

export interface FamilyLearner {
  id: string;
  fullName: string;
  admissionNumber: string;
  gradeName: string;
  className: string;
  classId: string | null;
  gradeLevel: number | null;
  relationship: string;
  isVerified: boolean;
}

export interface ParentDashboard {
  learners: FamilyLearner[];
  selectedLearnerId: string | null;
  latestResults: Array<{
    id: string;
    assessmentTitle: string;
    learningAreaName: string;
    categoryName: string;
    scoreLabel: string;
    achievementLabel: string | null;
    publishedAt: string | null;
  }>;
  recentFeedback: Array<{ id: string; body?: string; narrative?: string; learningAreaName?: string; createdAt?: string; assessmentTitle?: string }>;
  upcomingAssignments: Array<{
    id: string;
    title: string;
    instructions?: string | null;
    classId: string;
    className?: string;
    learningAreaName?: string;
    dueDate?: string | null;
    maxScore?: number | null;
    publishedAt?: string | null;
  }>;
  recentResources: Array<{
    id: string;
    title: string;
    className?: string;
    learningAreaName?: string;
    type?: string;
    fileName?: string | null;
    publishedAt?: string | null;
    createdAt?: string;
    visibleToParents?: boolean;
  }>;
  progress: Array<{ learningAreaName: string; color?: string; points: unknown[] }>;
  unreadNotifications: number;
  academicContext?: { academicYearName?: string | null; termName?: string | null };
}

interface FamilyContextValue {
  dashboard: ParentDashboard | null;
  loading: boolean;
  error: string | null;
  learnerId: string | null;
  learner: FamilyLearner | null;
  learners: FamilyLearner[];
  verifiedLearners: FamilyLearner[];
  setLearnerId: (id: string) => void;
  reload: (silent?: boolean) => Promise<void>;
}

const FamilyContext = createContext<FamilyContextValue | null>(null);

/**
 * Shared state for the family portal. The unfiltered dashboard is loaded first
 * and is the authority for which child IDs are currently verified. A selected
 * child is only requested from the API after it appears in that verified list.
 * This prevents an old browser-stored ID (for a revoked or transferred link)
 * from turning the entire family portal into a misleading "No learner found"
 * error, without ever weakening the API's relationship checks.
 */
export function FamilyProvider({ children }: { children: React.ReactNode }) {
  const [learnerId, setLearnerIdState] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [refreshingAfterRevocation, setRefreshingAfterRevocation] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setLearnerIdState(stored);
    } catch {
      /* storage may be unavailable — fall back to the API default */
    }
    setHydrated(true);
  }, []);

  // Always fetch the verified-link list first; never trust a persisted ID alone.
  const base = useApiQuery<ParentDashboard>(hydrated ? '/dashboard/parent' : null);
  const learners = useMemo(() => base.data?.learners ?? [], [base.data]);
  const verifiedLearners = useMemo(() => learners.filter((learner) => learner.isVerified), [learners]);
  const requestedLearner = useMemo(
    () => verifiedLearners.find((learner) => learner.id === learnerId) ?? null,
    [learnerId, verifiedLearners],
  );

  // The base response includes records for its default learner. Fetch a second
  // dashboard only when the selected learner is independently verified and is
  // not that default; avoid briefly showing the previous child's records.
  const selectedNeedsFetch = Boolean(
    requestedLearner && requestedLearner.id !== base.data?.selectedLearnerId,
  );
  const selected = useApiQuery<ParentDashboard>('/dashboard/parent', {
    query: selectedNeedsFetch && requestedLearner ? { learnerId: requestedLearner.id } : undefined,
    enabled: selectedNeedsFetch,
  });

  const saveSelection = useCallback((id: string | null) => {
    setLearnerIdState(id);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage may be unavailable */
    }
  }, []);

  // Replace a stale/unverified local selection with the server's safe default.
  useEffect(() => {
    if (!base.data) return;
    if (refreshingAfterRevocation) {
      if (base.loading) return;
      saveSelection(base.data.selectedLearnerId);
      setRefreshingAfterRevocation(false);
      return;
    }
    if (learnerId && !verifiedLearners.some((learner) => learner.id === learnerId)) {
      saveSelection(base.data.selectedLearnerId);
      return;
    }
    if (!learnerId && base.data.selectedLearnerId) saveSelection(base.data.selectedLearnerId);
  }, [base.data, base.loading, learnerId, refreshingAfterRevocation, saveSelection, verifiedLearners]);

  // A link can be revoked after the list loads but before a selected-child read.
  // Fall back to a fresh, unfiltered list; the API continues to return 404 for
  // guessed or revoked IDs, so this recovery never exposes another family.
  useEffect(() => {
    if (!selectedNeedsFetch || ![403, 404].includes(selected.errorStatus ?? 0)) return;
    saveSelection(null);
    setRefreshingAfterRevocation(true);
    void base.reload();
  }, [base.reload, saveSelection, selected.errorStatus, selectedNeedsFetch]);

  const setLearnerId = useCallback((id: string) => saveSelection(id), [saveSelection]);
  const reload = useCallback(async (silent = false) => {
    await base.reload(silent);
    if (selectedNeedsFetch) await selected.reload(silent);
  }, [base.reload, selected.reload, selectedNeedsFetch]);

  const selectedId = requestedLearner?.id ?? base.data?.selectedLearnerId ?? null;
  const selectedData = selectedNeedsFetch ? selected.data : base.data;
  const data = selectedData ?? null;
  const error = base.error ?? (selectedNeedsFetch ? selected.error : null);
  const loading = base.loading || (selectedNeedsFetch && selected.loading);

  const value = useMemo<FamilyContextValue>(
    () => ({
      dashboard: data,
      loading,
      error,
      learnerId: selectedId,
      learner: learners.find((item) => item.id === selectedId) ?? null,
      learners,
      verifiedLearners,
      setLearnerId,
      reload,
    }),
    [data, error, loading, learners, reload, selectedId, setLearnerId, verifiedLearners],
  );

  return <FamilyContext.Provider value={value}>{children}</FamilyContext.Provider>;
}

export function useFamily() {
  const context = useContext(FamilyContext);
  if (!context) throw new Error('useFamily must be used inside the family portal layout.');
  return context;
}
