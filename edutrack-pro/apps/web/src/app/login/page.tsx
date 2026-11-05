'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { useSession } from '@/lib/session';
import { AuthShell } from '@/components/auth-shell';
import { Button, Field, Input, Note } from '@/components/ui';
import { homeFor } from '@/lib/nav';
import { ApiError, fetchOnboardingPolicy, requestPasswordReset, type OnboardingPolicy } from '@/lib/api';

/**
 * Sign in.
 *
 * No demonstration accounts, no example passwords: an account exists because the
 * school created it (invitation or administrator action) or because the guardian
 * registered with a verified link. What the page *does* offer is whatever the
 * server says this installation permits — first-run school setup, school
 * self-registration, guardian registration or invitation activation.
 */
function LoginForm() {
  const { signIn, user, ready } = useSession();
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [policy, setPolicy] = useState<OnboardingPolicy | null>(null);

  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [resetPending, setResetPending] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace(homeFor(user.role));
  }, [ready, user, router]);

  useEffect(() => {
    let active = true;
    fetchOnboardingPolicy()
      .then((data) => {
        if (active) setPolicy(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const notice = useMemo(() => {
    if (params.get('reason') === 'expired') {
      return { tone: 'warning' as const, title: 'Session ended', body: 'You were signed out, or your session expired. Please sign in again.' };
    }
    if (params.get('activated')) {
      return { tone: 'success' as const, title: 'Account activated', body: 'Your account is ready. Sign in with the password you just chose.' };
    }
    if (params.get('registered')) {
      return {
        tone: 'info' as const,
        title: 'Registration received',
        body: 'Your guardian account is ready. The school office must confirm your link to a learner before their records appear.',
      };
    }
    if (params.get('reset')) {
      return { tone: 'success' as const, title: 'Password updated', body: 'Your password has been changed and all other sessions were signed out.' };
    }
    return null;
  }, [params]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const me = await signIn(email.trim(), password);
      router.replace(homeFor(me.role));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const submitReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setResetPending(true);
    setResetNotice(null);
    try {
      await requestPasswordReset(resetEmail.trim());
      setResetNotice('If that address belongs to a school account, a reset link has been sent to it.');
    } catch (caught) {
      // The API answers identically for known and unknown addresses; only a
      // transport problem can fail here.
      if (caught instanceof ApiError && caught.status >= 500) {
        setResetNotice('We could not reach the server just now. Please try again in a moment.');
      } else {
        setResetNotice('If that address belongs to a school account, a reset link has been sent to it.');
      }
    } finally {
      setResetPending(false);
    }
  };

  const showSchoolRegistration = Boolean(policy?.schoolSelfRegistration) || Boolean(policy?.requiresSetup);

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in"
      description="Use the email address your school holds for you. Accounts are created by the school — there are no shared or demonstration logins."
      backHref="/"
      backLabel="About EduTrack Pro"
      footer={
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-teal-600" aria-hidden />
          Protected by rate limiting, Argon2id password hashing and short-lived sessions.
        </span>
      }
    >
      {notice ? (
        <div className="mb-4">
          <Note tone={notice.tone} title={notice.title}>
            {notice.body}
          </Note>
        </div>
      ) : null}

      {policy?.requiresSetup && showSchoolRegistration ? (
        <div className="mb-4">
          <Note tone="info" title="First-run setup">
            No school has been set up on this installation yet.{' '}
            <Link href="/register" className="font-semibold text-royal hover:underline">
              Create your school and administrator account
            </Link>{' '}
            to get started.
          </Note>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4">
          <Note tone="danger" title="Could not sign you in">
            {error}
          </Note>
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={submit} noValidate>
        <Field label="Email address" required>
          <Input
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            required
            autoFocus
            aria-invalid={Boolean(error) || undefined}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@school.ac.ke"
          />
        </Field>

        <Field label="Password" required>
          <span className="relative block">
            <Input
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              required
              aria-invalid={Boolean(error) || undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-ink-subtle transition-colors hover:text-royal focus:outline-none focus-visible:ring-2 focus-visible:ring-bright/40"
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          </span>
        </Field>

        <Button type="submit" className="w-full" size="lg" loading={pending} disabled={!email || !password}>
          Sign in
        </Button>
      </form>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 font-semibold text-royal hover:underline"
          aria-expanded={showReset}
          onClick={() => setShowReset((open) => !open)}
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden />
          Forgotten your password?
        </button>
        <span className="text-ink-subtle">Teachers join by invitation.</span>
      </div>

      {showReset ? (
        <form className="surface-tint mt-3 space-y-3 rounded-lg p-3.5" onSubmit={submitReset}>
          <Field
            label="Account email"
            hint="We never confirm whether an address is registered."
            className="[&>span:last-child]:text-ink-muted"
          >
            <Input
              type="email"
              required
              value={resetEmail}
              onChange={(event) => setResetEmail(event.target.value)}
              autoComplete="email"
            />
          </Field>
          <Button type="submit" variant="outline" size="sm" loading={resetPending}>
            Send reset link
          </Button>
          {resetNotice ? (
            <p role="status" className="text-xs leading-relaxed text-ink-muted">
              {resetNotice}
            </p>
          ) : null}
        </form>
      ) : null}

      <div className="mt-6 border-t border-line pt-4">
        <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">New to EduTrack Pro?</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {showSchoolRegistration ? (
            <Link
              href="/register"
              className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3 text-xs font-semibold text-ink-strong transition-colors hover:border-royal hover:text-royal"
            >
              {policy?.requiresSetup ? 'Set up your school' : 'Register a school'}
            </Link>
          ) : null}
          <Link
            href="/activate"
            className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3 text-xs font-semibold text-ink-strong transition-colors hover:border-royal hover:text-royal"
          >
            Activate an invitation
          </Link>
          {policy?.parentSelfRegistration || policy?.invitationRegistration ? (
            <Link
              href="/register/parent"
              className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3 text-xs font-semibold text-ink-strong transition-colors hover:border-royal hover:text-royal"
            >
              Guardian account
            </Link>
          ) : null}
        </div>
        {policy && !showSchoolRegistration && !policy.parentSelfRegistration ? (
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            Public registration is closed on this installation. Ask your school administrator for an invitation.
          </p>
        ) : null}
      </div>
    </AuthShell>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary during prerender.
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-ink-muted">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
