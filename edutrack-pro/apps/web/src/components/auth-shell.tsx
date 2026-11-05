'use client';

import Link from 'next/link';
import { ArrowLeft, GraduationCap, ShieldCheck } from 'lucide-react';

/**
 * Shared frame for every unauthenticated screen (sign in, registration,
 * activation, password reset).
 *
 * Left: the deep-navy brand panel — product identity, the promise of the
 * platform and the security posture. Right: a light blue-grey workspace that
 * holds the form card. On small screens the navy panel collapses into a compact
 * header so the form is immediately reachable.
 */
export function AuthShell({
  title,
  description,
  eyebrow,
  children,
  footer,
  backHref = '/login',
  backLabel = 'Back to sign in',
}: {
  title: string;
  description?: React.ReactNode;
  eyebrow?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="app-canvas grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* ------------------------------ brand panel ------------------------------ */}
      <aside className="hero-gradient relative hidden flex-col justify-between overflow-hidden px-10 py-12 lg:flex">
        <div className="hero-grid-lines pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-bright/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-accent/15 blur-3xl" aria-hidden />

        <div className="relative">
          <Link href="/login" className="inline-flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-royal to-royal-strong shadow-lg">
              <GraduationCap className="h-6 w-6 text-white" aria-hidden />
            </span>
            <span>
              <span className="block text-base font-semibold tracking-[-0.01em] text-white">EduTrack Pro</span>
              <span className="block text-2xs uppercase tracking-[0.18em] text-ink-inverse-muted">Junior school platform</span>
            </span>
          </Link>

          <h1 className="mt-12 max-w-md text-3xl font-semibold leading-tight text-white">
            Competency-based learning records, assessment and timetabling for Kenyan junior schools.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-inverse-muted">
            Grades 7–9 · strands and sub-strands · school-defined achievement bands · timetable generation with conflict
            detection and validated publication.
          </p>
        </div>

        <ul className="relative mt-12 space-y-3.5 text-sm text-ink-inverse-muted">
          {[
            'Exactly three roles: administrator, teacher and parent/guardian.',
            'Guardians see only the learners the school has verified them against.',
            'School records stay separate from official national outcomes.',
          ].map((line) => (
            <li key={line} className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
              <span className="leading-relaxed">{line}</span>
            </li>
          ))}
        </ul>

        <p className="relative text-2xs text-ink-inverse-muted/80">
          Sessions are short-lived and rotate on refresh. Passwords are hashed with Argon2id; reset links are single-use.
        </p>
      </aside>

      {/* --------------------------------- form ---------------------------------- */}
      <main id="main-content" className="flex flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface/80 px-5 py-3.5 backdrop-blur lg:hidden">
          <Link href="/login" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-navy-800 to-navy-950">
              <GraduationCap className="h-5 w-5 text-white" aria-hidden />
            </span>
            <span>
              <span className="block text-sm font-semibold text-ink-strong">EduTrack Pro</span>
              <span className="block text-2xs uppercase tracking-[0.16em] text-ink-subtle">Junior school</span>
            </span>
          </Link>
          <Link href={backHref} className="inline-flex items-center gap-1.5 text-xs font-semibold text-royal hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {backLabel}
          </Link>
        </header>

        <div className="flex flex-1 items-start justify-center px-5 py-8 sm:px-8 lg:items-center lg:py-12">
          <div className="w-full max-w-xl">
            <div className="hidden lg:block">
              <Link href={backHref} className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-royal">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                {backLabel}
              </Link>
            </div>

            <div className="mt-0 lg:mt-5">
              {eyebrow ? (
                <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-royal">{eyebrow}</p>
              ) : null}
              <h2 className="mt-1.5 text-2xl font-semibold tracking-[-0.01em] text-ink-strong">{title}</h2>
              {description ? <p className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</p> : null}
            </div>

            <div className="surface-elevated mt-6 rounded-xl border border-line p-5 sm:p-6">{children}</div>

            {footer ? <div className="mt-4 text-center text-xs text-ink-muted">{footer}</div> : null}
          </div>
        </div>
      </main>
    </div>
  );
}
