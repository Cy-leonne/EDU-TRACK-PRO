'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, loadSession, login as apiLogin, logout as apiLogout, saveSession, setSessionExpiredHandler, type StoredSession } from './api';
import { BRAND_DEFAULTS, hexToRgbTriplet, mixHex } from './theme';
import type { Role, SchoolProfile, SessionUser } from './types';

interface SessionContextValue {
  user: SessionUser | null;
  ready: boolean;
  /** True when a stored session was discarded because the server refused it. */
  sessionExpired: boolean;
  school: SchoolProfile | null;
  signIn: (email: string, password: string) => Promise<SessionUser>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshSchool: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasRole: (...roles: Role[]) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Applies a school's brand colour to the runtime CSS variables. */
function applyBrand(profile: SchoolProfile | null) {
  if (typeof document === 'undefined') return;
  const primary = profile?.primaryColor || BRAND_DEFAULTS.primary;
  const accent = profile?.accentColor || BRAND_DEFAULTS.accent;
  const root = document.documentElement.style;
  root.setProperty('--brand', hexToRgbTriplet(primary));
  root.setProperty('--brand-soft', hexToRgbTriplet(mixHex(primary, '#FFFFFF', 0.86)));
  root.setProperty('--brand-fg', hexToRgbTriplet(BRAND_DEFAULTS.fg));
  root.setProperty('--accent', hexToRgbTriplet(accent));
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<StoredSession | null>(null);
  const [school, setSchool] = useState<SchoolProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  const bootstrap = useCallback(async () => {
    const stored = loadSession();
    if (stored) setSession(stored);
    try {
      // Credentials are HttpOnly cookies; the in-memory user context is
      // reconstructed from the authenticated API after every full page load.
      const me = await api.get<SessionUser>('/auth/me');
      const next: StoredSession = {
        expiresAt: stored?.expiresAt ?? Date.now() + 15 * 60 * 1000,
        user: { ...(stored?.user ?? me), ...me },
      };
      setSession(next);
      if (me.role === 'PARENT') {
        // Learners' families see the school's portal name and colours too.
        try {
          const profile = await api.get<SchoolProfile>('/school/profile');
          setSchool(profile);
          applyBrand(profile);
        } catch {
          applyBrand(null);
        }
      }
    } catch {
      // No cookie is a normal first visit; a refused cookie is not retained.
      saveSession(null);
      setSession(null);
      if (stored) setSessionExpired(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      saveSession(null);
      setSession(null);
      router.replace('/login?reason=expired');
    });
    return () => setSessionExpiredHandler(null);
  }, [router]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    setSessionExpired(false);
    setSession(result);
    // Re-read /auth/me so the shell has the full permission list immediately.
    const me = await api.get<SessionUser>('/auth/me');
    setSession((prev) => (prev ? { ...prev, user: { ...prev.user, ...me } } : prev));
    applyBrand(null);
    return me;
  }, []);

  const signOut = useCallback(async () => {
    await apiLogout();
    setSessionExpired(false);
    setSession(null);
    setSchool(null);
    router.replace('/login');
  }, [router]);

  const refreshMe = useCallback(async () => {
    const me = await api.get<SessionUser>('/auth/me');
    setSession((prev) => (prev ? { ...prev, user: { ...prev.user, ...me } } : prev));
  }, []);

  const refreshSchool = useCallback(async () => {
    try {
      const profile = await api.get<SchoolProfile>('/school/profile');
      setSchool(profile);
      applyBrand(profile);
    } catch {
      /* not fatal: falls back to default branding */
    }
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      user: session?.user ?? null,
      ready,
      sessionExpired,
      school,
      signIn,
      signOut,
      refreshMe,
      refreshSchool,
      hasPermission: (permission: string) => Boolean(session?.user.permissions?.includes(permission)),
      hasRole: (...roles: Role[]) => Boolean(session?.user && roles.includes(session.user.role)),
    }),
    [session, ready, sessionExpired, school, signIn, signOut, refreshMe, refreshSchool],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}
