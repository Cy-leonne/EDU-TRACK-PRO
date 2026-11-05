'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { AppShell } from '@/components/app-shell';
import { Spinner } from '@/components/ui';

/**
 * Guard for every signed-in screen. Each page also checks permissions before it
 * renders role-specific controls; the API is the final authority either way.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, sessionExpired } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!ready || user) return;
    // Say *why* the session ended when a stored session was refused by the API.
    router.replace(sessionExpired ? '/login?reason=expired' : '/login');
  }, [ready, user, sessionExpired, router]);

  if (!ready || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Checking your session…" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
