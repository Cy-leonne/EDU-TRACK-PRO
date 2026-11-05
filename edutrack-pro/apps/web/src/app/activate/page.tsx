'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { BadgeCheck, Building2, Eye, EyeOff, MailCheck, ShieldAlert } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { Button, Field, Input, Note, Skeleton } from '@/components/ui';
import { ApiError, acceptInvitation, previewInvitation, type InvitationPreview } from '@/lib/api';

/**
 * Invitation activation.
 *
 * Teachers (and additional administrators, and guardians invited by the office)
 * do not self-register: an administrator issues a time-limited invitation. This
 * screen previews *who* invited them and for which school, then lets them set
 * their own password. The token is single-use; a second attempt is refused by
 * the server.
 */
function ActivationForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fullName: '', phone: '', password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (value: string) => {
    if (value.trim().length < 20) {
      setPreview(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setPreview(await previewInvitation(value.trim()));
    } catch (caught) {
      setPreview({ valid: false, message: caught instanceof ApiError ? caught.message : 'We could not check that link.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(token);
  }, [token, load]);

  useEffect(() => {
    if (preview?.valid && preview.fullName) setForm((prev) => (prev.fullName ? prev : { ...prev, fullName: preview.fullName as string }));
  }, [preview]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await acceptInvitation({
        token: token.trim(),
        fullName: form.fullName.trim() || undefined,
        phone: form.phone.trim() || undefined,
        password: form.password,
        confirmPassword: form.confirmPassword,
      });
      router.replace(`/login?activated=1&email=${encodeURIComponent(result.email)}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not activate your account. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const passwordProblem =
    form.password && form.password.length < 10
      ? 'Use at least 10 characters.'
      : form.password && !/[A-Z]/.test(form.password)
        ? 'Include an uppercase letter.'
        : form.password && !/\d/.test(form.password)
          ? 'Include a number.'
          : null;

  return (
    <AuthShell
      eyebrow="Invitation"
      title="Activate your account"
      description="Your school invited you. Confirm who you are and choose your own password — the invitation link works once."
    >
      {token.trim().length < 20 ? (
        <div className="space-y-4">
          <Note tone="info" title="Open the link from your invitation">
            The activation link contains a one-time token. Paste it below if your email program split the link.
          </Note>
          <Field label="Invitation link or token" required>
            <Input value={token} onChange={(event) => setToken(event.target.value)} placeholder="https://…/activate?token=… or just the token" />
          </Field>
          <p className="text-xs text-ink-muted">
            Registering as a guardian instead?{' '}
            <Link href="/register/parent" className="font-semibold text-royal hover:underline">
              Use the guardian registration page
            </Link>
            .
          </p>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !preview?.valid ? (
        <div className="space-y-4">
          <Note tone="danger" title="This invitation cannot be used">
            {preview?.message ?? 'That invitation link is no longer valid.'}
          </Note>
          <div className="flex flex-wrap gap-2">
            <Link href="/login" className="text-xs font-semibold text-royal hover:underline">
              Go to sign in
            </Link>
            <Link href="/register/parent" className="text-xs font-semibold text-royal hover:underline">
              Register as a guardian
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="surface-tint rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-2">
              <BadgeCheck className="h-4 w-4 text-teal-700" aria-hidden />
              <p className="text-sm font-semibold text-ink-strong">{preview.roleLabel ?? preview.role}</p>
              <span className="rounded-pill bg-white/70 px-2 py-0.5 text-2xs font-semibold uppercase tracking-[0.1em] text-navy-700">
                {preview.schoolName}
              </span>
            </div>
            <dl className="mt-3 space-y-1.5 text-xs text-ink-muted">
              <div className="flex items-center gap-2">
                <MailCheck className="h-3.5 w-3.5" aria-hidden />
                <dt className="sr-only">Invited address</dt>
                <dd className="font-medium text-ink-strong">{preview.email}</dd>
              </div>
              {preview.learnerName ? (
                <div className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5" aria-hidden />
                  <dt className="sr-only">Learner</dt>
                  <dd>
                    Linked to <span className="font-medium text-ink-strong">{preview.learnerName}</span>
                    {preview.relationship ? ` (${preview.relationship})` : ''} — the school still has to verify this link.
                  </dd>
                </div>
              ) : null}
              {preview.expiresAt ? (
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                  <dt className="sr-only">Expires</dt>
                  <dd>Link expires {new Date(preview.expiresAt).toLocaleString()}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          {error ? (
            <Note tone="danger" title="Activation failed">
              {error}
            </Note>
          ) : null}

          <form className="space-y-4" onSubmit={submit} noValidate>
            <Field label="Your full name" required>
              <Input value={form.fullName} onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))} autoComplete="name" required />
            </Field>
            <Field label="Mobile number" hint="Optional — used by the school office to reach you.">
              <Input value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} inputMode="tel" autoComplete="tel" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Choose a password" required error={passwordProblem} hint={passwordProblem ? undefined : 'At least 10 characters with upper and lower case and a number.'}>
                <span className="relative block">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                    autoComplete="new-password"
                    className="pr-11"
                    required
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
                label="Confirm password"
                required
                error={form.confirmPassword && form.confirmPassword !== form.password ? 'The two passwords do not match.' : null}
              >
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={form.confirmPassword}
                  onChange={(event) => setForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                  autoComplete="new-password"
                  required
                />
              </Field>
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={pending}
              disabled={!form.fullName.trim() || form.password.length < 10 || form.password !== form.confirmPassword}
            >
              Activate my account
            </Button>
          </form>
        </div>
      )}
    </AuthShell>
  );
}

export default function ActivatePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-ink-muted">Loading…</div>}>
      <ActivationForm />
    </Suspense>
  );
}
