import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Permission } from '@edutrack/shared-config';
import type { LoginResponse } from '@edutrack/shared-types';
import { ApiError, api, clearSession, loadSession, saveSession, setUnauthorizedHandler, type SessionUser } from '../api/client';

/**
 * Session state for the mobile app.
 *
 * The signed-in user is restored from the keychain on launch, so a teacher who
 * closes the app between lessons is not asked to sign in again — but every
 * screen still re-reads its data from the API rather than trusting cached
 * school records on the device (learner data should not linger in app storage).
 */

interface SessionContextValue {
  user: SessionUser | null;
  restoring: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<SessionUser>;
  signOut: () => Promise<void>;
  hasPermission: (permission: Permission) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await loadSession();
      if (active) {
        setUser(session?.user ?? null);
        setRestoring(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setSigningIn(true);
    setError(null);
    try {
      const data = await api.post<LoginResponse>('/auth/login', {
        email: email.trim().toLowerCase(),
        password,
        clientType: 'MOBILE',
      });
      await saveSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + (data.expiresIn ?? 900) * 1000,
        user: data.user,
      });
      setUser(data.user);
      return data.user;
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Could not sign in. Check your connection and try again.';
      setError(message);
      throw caught;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      const session = await loadSession();
      if (session) await api.post('/auth/logout', { refreshToken: session.refreshToken });
    } catch {
      /* the token may already be revoked — clearing locally is what matters */
    }
    await clearSession();
    setUser(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      restoring,
      signingIn,
      error,
      signIn,
      signOut,
      hasPermission: (permission: Permission) => Boolean(user?.permissions?.includes(permission)),
    }),
    [error, restoring, signIn, signOut, signingIn, user],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}
