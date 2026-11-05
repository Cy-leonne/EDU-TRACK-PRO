'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { Spinner } from '@/components/ui';
import { homeFor } from '@/lib/nav';

/** Entry point: send each role to the screen it lives in. */
export default function IndexPage() {
  const { user, ready } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(user ? homeFor(user.role) : '/login');
  }, [ready, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label="Opening EduTrack Pro…" />
    </div>
  );
}
