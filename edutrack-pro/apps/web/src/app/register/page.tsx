'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Eye, EyeOff, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { Button, Checkbox, Field, Input, Note, Select } from '@/components/ui';
import { ApiError, fetchOnboardingPolicy, registerSchool, type OnboardingPolicy } from '@/lib/api';
import { homeFor } from '@/lib/nav';

const TIMEZONES = ['Africa/Nairobi', 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Kigali', 'Africa/Mogadishu', 'UTC'];

type FormState = {
  schoolName: string;
  schoolCode: string;
  county: string;
  timezone: string;
  schoolPhone: string;
  schoolEmail: string;
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  password: string;
  confirmPassword: string;
  setupToken: string;
  acceptTerms: boolean;
};

const EMPTY: FormState = {
  schoolName: '',
  schoolCode: '',
  county: '',
  timezone: 'Africa/Nairobi',
  schoolPhone: '',
  schoolEmail: '',
  adminName: '',
  adminEmail: '',
  adminPhone: '',
  password: '',
  confirmPassword: '',
  setupToken: '',
  acceptTerms: false,
};

/** Client-side mirror of the server's password policy (the server is the judge). */
function passwordProblem(value: string): string | null {
  if (!value) return 'Choose a password.';
  if (value.length < 10) return 'Use at least 10 characters.';
  if (!/[a-z]/.test(value)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(value)) return 'Include an uppercase letter.';
  if (!/\d/.test(value)) return 'Include a number.';
  return null;
}

function RegisterSchoolForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [policy, setPolicy] = useState<OnboardingPolicy | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY, setupToken: params.get('setupToken') ?? '' });
  const [showPassword, setShowPassword] = useState(false);
  const [showToken, setShowToken] = useState(Boolean(params.get('setupToken')));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchOnboardingPolicy()
      .then(setPolicy)
      .catch(() => undefined);
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const selfService = Boolean(policy?.schoolSelfRegistration);
  const tokenMode = Boolean(form.setupToken);
  const closed = policy ? !selfService && !tokenMode : false;

  const passwordHint = useMemo(() => {
    const problem = passwordProblem(form.password);
    return problem && form.password ? problem : null;
  }, [form.password]);

  const validate = () => {
    const errors: Record<string, string> = {};
    if (form.schoolName.trim().length < 3) errors.schoolName = 'Enter the school name.';
    if (form.adminName.trim().length < 3) errors.adminName = 'Enter your full name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.adminEmail.trim())) errors.adminEmail = 'Enter a valid email address.';
    const problem = passwordProblem(form.password);
    if (problem) errors.password = problem;
    else if (form.password !== form.confirmPassword) errors.confirmPassword = 'The two passwords do not match.';
    if (!form.acceptTerms) errors.acceptTerms = 'Please accept the terms and privacy notice to continue.';
    if (policy && !selfService && !form.setupToken.trim()) {
      errors.setupToken = 'This installation needs the setup token from its server administrator.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) {
      setError('Please correct the highlighted fields.');
      return;
    }
    setPending(true);
    try {
      const result = await registerSchool({
        ...(form.setupToken.trim() ? { setupToken: form.setupToken.trim() } : {}),
        school: {
          name: form.schoolName.trim(),
          code: form.schoolCode.trim() || undefined,
          county: form.county.trim() || undefined,
          phone: form.schoolPhone.trim() || undefined,
          email: form.schoolEmail.trim() || undefined,
          timezone: form.timezone,
        },
        admin: {
          fullName: form.adminName.trim(),
          email: form.adminEmail.trim(),
          phone: form.adminPhone.trim() || undefined,
          password: form.password,
          confirmPassword: form.confirmPassword,
        },
        acceptTerms: true,
      });
      // The server returned a working session for the new administrator.
      router.replace(homeFor(result.user.role));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'We could not create the school just now. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      eyebrow="School onboarding"
      title="Create your school"
      description="This creates the school, its first administrator account, the Grade 7–9 catalogue and the default assessment vocabulary in a single transaction. Nothing is saved unless all of it succeeds."
      footer={
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-teal-600" aria-hidden />
          The first administrator can then invite teachers and other administrators.
        </span>
      }
    >
      {closed ? (
        <div className="mb-4">
          <Note tone="warning" title="Public school registration is closed on this installation">
            Ask the platform administrator for the setup token, or sign in with an account you were invited with. Existing
            schools add staff from <span className="font-semibold">People → Teachers → Invite</span>.
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

      <form className="space-y-6" onSubmit={submit} noValidate>
        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-navy-700">School details</legend>
          <Field label="School name" required error={fieldErrors.schoolName}>
            <Input
              value={form.schoolName}
              onChange={(event) => set('schoolName', event.target.value)}
              placeholder="e.g. Nakuru Hills Junior School"
              autoComplete="organization"
              aria-invalid={Boolean(fieldErrors.schoolName) || undefined}
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="School code" hint="Short code used on invitation letters (letters, numbers, dashes).">
              <Input value={form.schoolCode} onChange={(event) => set('schoolCode', event.target.value)} placeholder="e.g. NHJS-001" />
            </Field>
            <Field label="County">
              <Input value={form.county} onChange={(event) => set('county', event.target.value)} placeholder="e.g. Nakuru" />
            </Field>
            <Field label="School phone">
              <Input value={form.schoolPhone} onChange={(event) => set('schoolPhone', event.target.value)} placeholder="+254 7xx xxx xxx" inputMode="tel" />
            </Field>
            <Field label="School email" hint="Shown to guardians on their portal.">
              <Input type="email" value={form.schoolEmail} onChange={(event) => set('schoolEmail', event.target.value)} placeholder="office@school.ac.ke" />
            </Field>
            <Field label="Time zone" required>
              <Select value={form.timezone} onChange={(event) => set('timezone', event.target.value)}>
                {TIMEZONES.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4 border-t border-line pt-5">
          <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-navy-700">Administrator account</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your full name" required error={fieldErrors.adminName}>
              <Input value={form.adminName} onChange={(event) => set('adminName', event.target.value)} autoComplete="name" required />
            </Field>
            <Field label="Your email address" required error={fieldErrors.adminEmail} hint="You will sign in with this address.">
              <Input
                type="email"
                value={form.adminEmail}
                onChange={(event) => set('adminEmail', event.target.value)}
                autoComplete="email"
                aria-invalid={Boolean(fieldErrors.adminEmail) || undefined}
                required
              />
            </Field>
            <Field label="Your phone">
              <Input value={form.adminPhone} onChange={(event) => set('adminPhone', event.target.value)} inputMode="tel" autoComplete="tel" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password" required error={fieldErrors.password} hint={passwordHint ?? 'At least 10 characters with upper and lower case and a number.'}>
              <span className="relative block">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(event) => set('password', event.target.value)}
                  autoComplete="new-password"
                  className="pr-11"
                  aria-invalid={Boolean(fieldErrors.password || passwordHint) || undefined}
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
            <Field label="Confirm password" required error={fieldErrors.confirmPassword}>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={form.confirmPassword}
                onChange={(event) => set('confirmPassword', event.target.value)}
                autoComplete="new-password"
                aria-invalid={Boolean(fieldErrors.confirmPassword) || undefined}
                required
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3 border-t border-line pt-5">
          <legend className="text-xs font-semibold uppercase tracking-[0.1em] text-navy-700">Authorisation</legend>
          {!showToken ? (
            <button
              type="button"
              onClick={() => setShowToken(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-royal hover:underline"
            >
              <Lock className="h-3.5 w-3.5" aria-hidden />
              I have a setup token from the server administrator
            </button>
          ) : (
            <Field
              label="Setup token"
              hint="Issued with INITIAL_ADMIN_SETUP_TOKEN. Required only where public registration is switched off."
              error={fieldErrors.setupToken}
            >
              <Input
                type="password"
                value={form.setupToken}
                onChange={(event) => set('setupToken', event.target.value)}
                autoComplete="off"
                placeholder="paste the token"
              />
            </Field>
          )}

          <Checkbox
            checked={form.acceptTerms}
            onChange={(event) => set('acceptTerms', event.target.checked)}
            label={
              <span className="text-xs leading-relaxed text-ink-muted">
                I confirm I am authorised to register this school, and I accept the terms of use and the privacy notice.
                Learner records are kept for school purposes and internal results stay separate from official national outcomes.
              </span>
            }
          />
          {fieldErrors.acceptTerms ? (
            <p role="alert" className="text-xs font-medium text-danger-strong">
              {fieldErrors.acceptTerms}
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <Button type="submit" size="lg" loading={pending} disabled={closed}>
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Create school and sign in
          </Button>
          <Link href="/login" className="text-xs font-semibold text-ink-muted hover:text-royal">
            Already have an account?
          </Link>
        </div>
      </form>

      <p className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-2xs leading-relaxed text-ink-subtle">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Every registration attempt is rate limited and audited. Administrators are never created into an existing school from
        this page — existing schools invite their staff from inside the workspace.
      </p>
    </AuthShell>
  );
}

export default function RegisterSchoolPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-ink-muted">Loading…</div>}>
      <RegisterSchoolForm />
    </Suspense>
  );
}
