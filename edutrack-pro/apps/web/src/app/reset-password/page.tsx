'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, KeyRound, MailQuestion } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { Button, Field, Input, Note } from '@/components/ui';
import { ApiError, requestPasswordReset, resetPassword } from '@/lib/api';

/**
 * Password recovery.
 *
 * `?token=…` (from the reset link the school issued) sets a new password; the
 * server enforces single use and a short lifetime, and revokes every existing
 * session on success. Without a token the page only *requests* a link and shows
 * the same neutral wording for known and unknown addresses, so accounts cannot
 * be enumerated.
 */
function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [email, setEmail] = useState(params.get('email') ?? '');

  const passwordProblem = useMemo(() => {
    if (!password) return null;
    if (password.length < 10) return 'Use at least 10 characters.';
    if (!/[a-z]/.test(password)) return 'Include a lowercase letter.';
    if (!/[A-Z]/.test(password)) return 'Include an uppercase letter.';
    if (!/\d/.test(password)) return 'Include a number.';
    return null;
  }, [password]);

  const submitNewPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (passwordProblem || password !== confirmPassword) return;
    setError(null);
    setPending(true);
    try {
      await resetPassword(token, password);
      router.replace('/login?reset=1');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That reset link could not be used. Ask the school office for a new one.');
    } finally {
      setPending(false);
    }
  };

  const submitRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      await requestPasswordReset(email.trim());
    } catch {
      // Same wording either way: never reveal whether an address is registered.
    } finally {
      setPending(false);
      setRequested(true);
    }
  };

  if (!token) {
    return (
      <AuthShell
        eyebrow="Password recovery"
        title="Request a reset link"
        description="Enter the email address the school holds for you. If it belongs to an account, a single-use reset link is sent to it."
      >
        {requested ? (
          <Note tone="info" title="Check your inbox">
            If that address belongs to a school account, a reset link has been sent to it. The link expires quickly and can be
            used once. Ask the school office if it does not arrive.
          </Note>
        ) : (
          <form className="space-y-4" onSubmit={submitRequest} noValidate>
            <Field label="Account email" required>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                autoFocus
              />
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!email}>
              <MailQuestion className="h-4 w-4" aria-hidden />
              Send reset link
            </Button>
          </form>
        )}
        <p className="mt-4 text-xs text-ink-muted">
          <Link href="/login" className="font-semibold text-royal hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Password recovery"
      title="Choose a new password"
      description="This link can be used once. When you finish, every other session on the account is signed out."
      footer={
        <span className="inline-flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5 text-teal-600" aria-hidden />
          Reset links are single-use and expire quickly.
        </span>
      }
    >
      {error ? (
        <div className="mb-4">
          <Note tone="danger" title="Reset not completed">
            {error}
          </Note>
        </div>
      ) : null}

      <form className="space-y-4" onSubmit={submitNewPassword} noValidate>
        <Field label="New password" required error={passwordProblem} hint={passwordProblem ? undefined : 'At least 10 characters with upper and lower case and a number.'}>
          <span className="relative block">
            <Input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              className="pr-11"
              required
              autoFocus
            />
            <button
              type="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((shown) => !shown)}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-subtle hover:text-royal focus:outline-none focus-visible:ring-2 focus-visible:ring-bright/40"
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          </span>
        </Field>

        <Field
          label="Confirm new password"
          required
          error={confirmPassword && confirmPassword !== password ? 'The two passwords do not match.' : null}
        >
          <Input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={pending}
          disabled={Boolean(passwordProblem) || password.length < 10 || password !== confirmPassword}
        >
          Set my new password
        </Button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-ink-muted">Loading…</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
