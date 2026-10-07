'use client';

/**
 * ComingSoonClient - the animated pre-launch landing.
 *
 * A full-screen, on-brand hero: an aurora gradient backdrop, drifting paw
 * particles, a blur-to-sharp headline reveal, a live countdown to launch, and
 * an early-access email capture wired to the joinWaitlist server action.
 *
 * Built with framer-motion (already a dependency - no three.js, keeps it fast).
 * Every ambient animation is disabled under prefers-reduced-motion.
 */

import * as React from 'react';
import Image from 'next/image';
import { motion, type Variants } from 'framer-motion';
import { PawPrint, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { useReducedMotion } from '@/lib/animation/useReducedMotion';
import { joinWaitlist } from '@/actions/waitlist';

interface TimeLeft {
  days: number; hours: number; minutes: number; seconds: number; done: boolean;
}

function computeTimeLeft(launchAtMs: number): TimeLeft {
  const diff = launchAtMs - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  const sec = Math.floor(diff / 1000);
  return {
    days: Math.floor(sec / 86400),
    hours: Math.floor((sec % 86400) / 3600),
    minutes: Math.floor((sec % 3600) / 60),
    seconds: sec % 60,
    done: false,
  };
}

function useCountdown(launchAtMs: number): TimeLeft {
  const [left, setLeft] = React.useState<TimeLeft | null>(null);
  React.useEffect(() => {
    setLeft(computeTimeLeft(launchAtMs));
    const id = window.setInterval(() => setLeft(computeTimeLeft(launchAtMs)), 1000);
    return () => window.clearInterval(id);
  }, [launchAtMs]);
  return left ?? { days: 0, hours: 0, minutes: 0, seconds: 0, done: false };
}

const container: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 16, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { type: 'spring', stiffness: 260, damping: 24 } },
};

export interface ComingSoonClientProps { launchAtMs: number; }

type FormState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export function ComingSoonClient({ launchAtMs }: ComingSoonClientProps) {
  const reduced = useReducedMotion();
  const left = useCountdown(launchAtMs);
  const [email, setEmail] = React.useState('');
  const [form, setForm] = React.useState<FormState>({ kind: 'idle' });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (form.kind === 'submitting') return;
    setForm({ kind: 'submitting' });
    try {
      const res = await joinWaitlist(email);
      if (res.ok) { setForm({ kind: 'success', message: res.message }); setEmail(''); }
      else { setForm({ kind: 'error', message: res.error }); }
    } catch {
      setForm({ kind: 'error', message: 'Something went wrong. Please try again.' });
    }
  }

  const units: Array<{ label: string; value: number }> = [
    { label: 'Days', value: left.days },
    { label: 'Hours', value: left.hours },
    { label: 'Minutes', value: left.minutes },
    { label: 'Seconds', value: left.seconds },
  ];

  const paws = [
    { left: '8%', top: '18%', size: 26, dur: 9, delay: 0 },
    { left: '82%', top: '22%', size: 20, dur: 11, delay: 1.4 },
    { left: '16%', top: '68%', size: 18, dur: 10, delay: 0.8 },
    { left: '74%', top: '72%', size: 30, dur: 13, delay: 2.1 },
    { left: '46%', top: '12%', size: 16, dur: 12, delay: 1.1 },
  ];

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-base-200 px-5 py-16 text-center">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div className="absolute -left-1/4 -top-1/4 h-[60vmax] w-[60vmax] rounded-full bg-primary/25 blur-[100px]"
          animate={reduced ? undefined : { x: [0, 60, 0], y: [0, 40, 0], scale: [1, 1.1, 1] }}
          transition={reduced ? undefined : { duration: 18, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="absolute -bottom-1/4 -right-1/4 h-[55vmax] w-[55vmax] rounded-full bg-accent/25 blur-[100px]"
          animate={reduced ? undefined : { x: [0, -50, 0], y: [0, -30, 0], scale: [1, 1.15, 1] }}
          transition={reduced ? undefined : { duration: 22, repeat: Infinity, ease: 'easeInOut', delay: 2 }} />
        <motion.div className="absolute left-1/3 top-1/2 h-[40vmax] w-[40vmax] rounded-full bg-secondary/20 blur-[90px]"
          animate={reduced ? undefined : { x: [0, 40, 0], y: [0, -50, 0] }}
          transition={reduced ? undefined : { duration: 26, repeat: Infinity, ease: 'easeInOut', delay: 1 }} />
      </div>

      {!reduced && paws.map((p, i) => (
        <motion.span key={i} aria-hidden="true" className="pointer-events-none absolute text-base-content/10"
          style={{ left: p.left, top: p.top }}
          animate={{ y: [0, -24, 0], opacity: [0.08, 0.22, 0.08], rotate: [0, 8, 0] }}
          transition={{ duration: p.dur, repeat: Infinity, ease: 'easeInOut', delay: p.delay }}>
          <PawPrint style={{ width: p.size, height: p.size }} />
        </motion.span>
      ))}

      <motion.div className="relative z-10 flex w-full max-w-xl flex-col items-center" variants={container} initial="hidden" animate="show">
        <motion.div variants={item}>
          <Image src="/pawxisLogo.png" alt="Pawxis" width={320} height={128} priority className="mb-8 h-14 w-auto object-contain sm:h-16" />
        </motion.div>

        <motion.span variants={item} className="mb-5 inline-flex items-center gap-2 rounded-full border border-base-content/10 bg-base-100/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary backdrop-blur-md">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          Launching soon
        </motion.span>

        <motion.h1 variants={item} className="font-display text-4xl font-bold leading-tight text-base-content sm:text-5xl">
          Something great for{' '}
          <span className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">mobile groomers</span>{' '}
          is almost here.
        </motion.h1>

        <motion.p variants={item} className="mt-5 max-w-md text-base text-base-content/70 sm:text-lg">
          Pawxis is the booking, routing and no-show shield built for solo mobile pet
          groomers. We&apos;re putting on the finishing touches &mdash; launching in just a few days.
        </motion.p>

        <motion.div variants={item} className="mt-9 flex items-center justify-center gap-3 sm:gap-4">
          {units.map((u) => (
            <div key={u.label} className="flex min-w-[64px] flex-col items-center rounded-2xl border border-base-content/10 bg-base-100/70 px-3 py-3 shadow-card backdrop-blur-md sm:min-w-[76px] sm:px-4">
              <span className="font-display text-2xl font-bold tabular-nums text-base-content sm:text-3xl">{String(u.value).padStart(2, '0')}</span>
              <span className="mt-1 text-[0.65rem] font-medium uppercase tracking-wide text-base-content/50">{u.label}</span>
            </div>
          ))}
        </motion.div>

        <motion.div variants={item} className="mt-9 w-full max-w-md">
          {form.kind === 'success' ? (
            <div role="status" className="flex items-center justify-center gap-2 rounded-2xl border border-success/30 bg-success/10 px-4 py-4 text-sm font-medium text-base-content">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
              {form.message}
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row" noValidate>
              <input type="email" inputMode="email" autoComplete="email" required value={email}
                onChange={(e) => { setEmail(e.target.value); if (form.kind === 'error') setForm({ kind: 'idle' }); }}
                placeholder="you@example.com" aria-label="Email address for early access" aria-invalid={form.kind === 'error'}
                className="min-h-[48px] flex-1 rounded-2xl border border-base-content/15 bg-base-100/80 px-4 text-base text-base-content outline-none backdrop-blur-md transition focus:border-primary focus:ring-2 focus:ring-primary/30" />
              <button type="submit" disabled={form.kind === 'submitting'} className="btn btn-primary min-h-[48px] gap-2 rounded-2xl px-6 text-base">
                {form.kind === 'submitting' ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <>Get early access<ArrowRight className="h-4 w-4" aria-hidden="true" /></>
                )}
              </button>
            </form>
          )}
          {form.kind === 'error' && (
            <p role="alert" className="mt-2 text-sm text-error">{form.message}</p>
          )}
          {form.kind !== 'success' && (
            <p className="mt-3 text-xs text-base-content/50">Be the first to know when we go live. No spam, ever.</p>
          )}
        </motion.div>
      </motion.div>

      <motion.p variants={item} initial="hidden" animate="show" className="relative z-10 mt-14 text-xs text-base-content/40">
        &copy; {new Date().getFullYear()} Pawxis. Groom more dogs. Drive less.
      </motion.p>
    </main>
  );
}

export default ComingSoonClient;
