'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Info, ShieldCheck, UserCheck } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { Button, Checkbox, Field, Input, Note, Select } from '@/components/ui';
import { ApiError, fetchOnboardingPolicy, previewInvitation, registerParent, type InvitationPreview, type OnboardingPolicy } from '@/lib/api';

const RELATIONSHIPS = ['Mother', 'Father', 'Guardian', 'Grandparent', 'Sibling', 'Sponsor', 'Other'];

/**
 * Guardian registration.
 *
 * Two entry points, both supported by the server:
 *  • an invitation from the school (the learner is prepared in advance), or
 *  • the school's own code, after which the guardian requests a learner link
 *    with the assessment number *and* surname.
 *
 * Either way the link starts unverified: an admission/assessment number alone
 * never exposes a learner's records, and an administrator confirms the link.
 */
function ParentRegistrationForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [policy, setPolicy] = useState<OnboardingPolicy | null>(null);
  const [invite, setInvite] = useState<InvitationPreview | null>(null);
  const [token] = useState(params.get('token') ?? '');
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    relationship: 'Mother',
    schoolCode: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    fetchOnboardingPolicy()
      .then(setPolicy)
      .catch(() => undefined);
    if (token) {
      previewInvitation(token)
        .then((data) => {
          setInvite(data);
          if (data.valid) {
            setForm((prev) => ({
              ...prev,
              fullName: data.fullName ?? prev.fullName,
              email: data.email ?? prev.email,
              relationship: data.relationship ?? prev.relationship,
            }));
          }
        })
        .catch(() => undefined);
    }
  }, [token]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const passwordProblem =
    form.password && form.password.length < 10
      ? 'Use at least 10 characters.'
      : form.password && !/[A-Z]/.test(form.password)
        ? 'Include an uppercase letter.'
        : form.password && !/\d/.test(form.password)
          ? 'Include a number.'
          : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await registerParent({
        ...(token ? { invitationToken: token } : {}),
        ...(!token ? { schoolCode: form.schoolCode.trim() } : {}),
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        relationship: form.relationship,
        password: form.password,
        confirmPassword: form.confirmPassword,
        acceptTerms: true,
      });
      setDone(result.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not create your account just now. Please try again.');
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <AuthShell eyebrow="Almost there" title="Your account is ready" description={done}>
        <div className="space-y-4">
          <Note tone="info" title="What happens next">
            <ol className="ml-4 list-decimal space-y-1.5">
              <li>A school administrator reviews your registration and confirms which learner(s) are yours.</li>
              <li>Until that confirmation, no learner records, results or timetables are visible to your account.</li>
              <li>You will be notified inside the portal when the link is active.</li>
            </ol>
          </Note>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/login"
              className="inline-flex h-10 items-center rounded-md bg-royal px-4 text-sm font-semibold text-white transition-colors hover:bg-royal-strong"
            >
              Sign in
            </Link>
            <Link href="/" className="inline-flex h-10 items-center rounded-md border border-line-strong px-4 text-sm font-semibold text-ink-strong">
              Back to home
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  const invitationMode = Boolean(token);
  const invitationInvalid = invitationMode && invite && !invite.valid;
  const closed = !invitationMode && policy ? !policy.parentSelfRegistration : false;

  return (
    <AuthShell
      eyebrow="Guardian access"
      title={invitationMode ? 'Accept your invitation' : 'Create a guardian account'}
      description={
        invitationMode
          ? 'The school prepared this invitation for you. Choose your own password to finish setting up your account.'
          : 'Register with the school code from the school office. You will then request a link to your child, which the school verifies.'
      }
      footer={
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-teal-600" aria-hidden />
          Learner records stay hidden until a school administrator verifies the link.
        </span>
      }
    >
      {invitationInvalid ? (
        <div className="mb-4">
          <Note tone="danger" title="This invitation cannot be used">
            {invite?.message}
          </Note>
        </div>
      ) : null}

      {closed ? (
        <div className="mb-4">
          <Note tone="warning" title="Guardian self-registration is closed on this installation">
            Ask the school office to send you an invitation link, which opens this same page with the learner already noted.
          </Note>
        </div>
      ) : null}

      {invitationMode && invite?.valid ? (
        <div className="mb-4">
          <Note tone="success" title={`Invitation from ${invite.schoolName}`}>
            {invite.learnerName ? (
              <>
                You were invited as <span className="font-semibold">{invite.fullName}</span> to link{' '}
                <span className="font-semibold">{invite.learnerName}</span>. The school still confirms the link before records
                appear.
              </>
            ) : (
              <>You were invited as {invite.fullName}. Add your child after signing in using their assessment number.</>
            )}
          </Note>
        </div>
      ) : null}

      {error ? (
        <div className="mb-4">
          <Note tone="danger" title="Registration not completed">
            {error}
          </Note>
        </div>
      ) : null}

      <form className="space-y-5" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your full name" required>
            <Input value={form.fullName} onChange={(event) => set('fullName', event.target.value)} autoComplete="name" required />
          </Field>
          <Field label="Email address" required hint="You will sign in with this address.">
            <Input
              type="email"
              value={form.email}
              onChange={(event) => set('email', event.target.value)}
              autoComplete="email"
              readOnly={invitationMode && Boolean(invite?.valid)}
              required
            />
          </Field>
          <Field label="Mobile number" required hint="Used to verify you with the school.">
            <Input value={form.phone} onChange={(event) => set('phone', event.target.value)} inputMode="tel" autoComplete="tel" required />
          </Field>
          <Field label="Relationship to the learner" required>
            <Select value={form.relationship} onChange={(event) => set('relationship', event.target.value)}>
              {RELATIONSHIPS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {!invitationMode ? (
          <Field
            label="School code"
            required
            hint="Printed on the letter from the school office — not your child's assessment number."
          >
            <Input value={form.schoolCode} onChange={(event) => set('schoolCode', event.target.value.toUpperCase())} placeholder="e.g. NHJS-001" required />
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Choose a password" required error={passwordProblem} hint={passwordProblem ? undefined : 'At least 10 characters with upper and lower case and a number.'}>
            <span className="relative block">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(event) => set('password', event.target.value)}
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
              onChange={(event) => set('confirmPassword', event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
        </div>

        <Checkbox
          checked={form.acceptTerms}
          onChange={(event) => set('acceptTerms', event.target.checked)}
          label={
            <span className="text-xs leading-relaxed text-ink-muted">
              I confirm the information above is mine, and I accept the terms of use and the privacy notice. I understand that a
              school administrator verifies my link to a learner before their records are shown to me.
            </span>
          }
        />

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button
            type="submit"
            size="lg"
            loading={pending}
            disabled={closed || invitationInvalid || !form.acceptTerms || form.password.length < 10 || form.password !== form.confirmPassword}
          >
            <UserCheck className="h-4 w-4" aria-hidden />
            Create my account
          </Button>
          <Link href="/login" className="text-xs font-semibold text-ink-muted hover:text-royal">
            I already have an account
          </Link>
        </div>
      </form>

      <p className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-2xs leading-relaxed text-ink-subtle">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        An assessment or admission number is never used on its own to prove who you are — it only starts a request that the
        school confirms.
      </p>
    </AuthShell>
  );
}

export default function ParentRegistrationPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-ink-muted">Loading…</div>}>
      <ParentRegistrationForm />
    </Suspense>
  );
}
