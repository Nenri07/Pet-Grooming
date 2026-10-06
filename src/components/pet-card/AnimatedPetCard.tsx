'use client';

/**
 * AnimatedPetCard — the flagship, animated hero visual for a Digital Pet Card.
 *
 * This is a RESKIN of the proven 21st.dev "Animated Profile Card"
 * (isaiahbjork): a full-bleed cover image, stacked gradient/blur overlays that
 * fade the bottom into a readable panel, a letter-by-letter animated name
 * reveal (staggerChildren), a stats row, and a corner QR. Every shadcn color
 * token from the reference is MAPPED to a DaisyUI theme token so the card
 * recolours with all 7 themes:
 *   background        → base-100
 *   foreground        → base-content
 *   muted-foreground  → base-content/60
 *   border            → base-content/10
 *   accent / primary  → primary
 *
 * "GIF-like" life: a slow ambient parallax drift on the photo, a shimmer on the
 * name, and a couple of floating paw particles run on an infinite framer-motion
 * loop so a screenshot or screen-recording of the card looks alive when shared.
 * Everything — hover spring, tilt, reveal, and the ambient loops — is disabled
 * under prefers-reduced-motion, which renders the final static state instead.
 */
import { useRef, useState } from 'react';
import Image from 'next/image';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import {
  PawPrint,
  Scissors,
  CalendarClock,
  BadgeCheck,
  QrCode,
} from 'lucide-react';
import { useReducedMotion } from '@/lib/animation/useReducedMotion';
import type { PetCardViewData } from './PetCardRenderer';
import { safeHttpsImageSrc } from '@/lib/images';

/** Tiny classnames join helper (no `@/lib/utils` `cn` in this project). */
function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// safeHttpsImageSrc now lives in '@/lib/images' (shared across every
// DB-sourced <Image> site) — see import above.

type SerializedDate = Date | string;

function toDate(value: SerializedDate | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: SerializedDate | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function titleCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface AnimatedPetCardProps {
  data: PetCardViewData;
  /** The absolute shareable URL encoded in the QR code. */
  shareUrl: string;
  className?: string;
}

/* ---- motion variants (reused from the reference, retimed) ---------------- */

const containerVariants: Variants = {
  rest: { scale: 1, y: 0 },
  hover: {
    scale: 1.02,
    y: -4,
    transition: { type: 'spring', stiffness: 300, damping: 20 },
  },
};

const contentVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.15 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring', stiffness: 260, damping: 22 },
  },
};

const letterVariants: Variants = {
  hidden: { opacity: 0, y: 14, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring', stiffness: 320, damping: 18 },
  },
};

export function AnimatedPetCard({
  data,
  shareUrl,
  className,
}: AnimatedPetCardProps) {
  const reduced = useReducedMotion();
  const [showQr, setShowQr] = useState(false);

  // Pointer-driven 3D tilt (framer only — no competing transform libs).
  const cardRef = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [8, -8]), {
    stiffness: 200,
    damping: 20,
  });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-8, 8]), {
    stiffness: 200,
    damping: 20,
  });

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (reduced) return;
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    px.set((e.clientX - rect.left) / rect.width - 0.5);
    py.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  function handlePointerLeave() {
    px.set(0);
    py.set(0);
  }

  const name = data.name || 'Pet';
  const letters = Array.from(name);
  const nextDate = formatDate(data.nextRecommendedDate);
  const ageLabel = `${data.age} ${data.age === 1 ? 'yr' : 'yrs'}`;

  // Ambient, always-on motion (disabled under reduced motion) that makes a
  // screenshot / screen-recording of the card feel alive.
  const photoAmbient = reduced
    ? undefined
    : {
        scale: [1.06, 1.12, 1.06],
        x: [0, -10, 0],
        y: [0, -6, 0],
      };
  const photoTransition = reduced
    ? undefined
    : { duration: 7, repeat: Infinity, ease: 'easeInOut' as const };

  return (
    <motion.div
      ref={cardRef}
      className={cx(
        'group relative mx-auto w-full max-w-sm select-none',
        '[perspective:1200px]',
        className,
      )}
      initial="rest"
      animate="rest"
      whileHover={reduced ? undefined : 'hover'}
      variants={reduced ? undefined : containerVariants}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <motion.article
        className={cx(
          'relative aspect-[3/4.1] w-full overflow-hidden rounded-box',
          'border border-base-content/10 bg-base-100 shadow-card',
          '[transform-style:preserve-3d]',
        )}
        style={reduced ? undefined : { rotateX, rotateY }}
      >
        {/* ---- Full-cover pet photo (ambient parallax drift) -------------- */}
        <div className="absolute inset-0 overflow-hidden">
          {safeHttpsImageSrc(data.photoUrl) ? (
            <motion.div
              className="absolute inset-0"
              animate={photoAmbient}
              transition={photoTransition}
              style={{ willChange: 'transform' }}
            >
              <Image
                src={safeHttpsImageSrc(data.photoUrl) as string}
                alt={name}
                fill
                priority
                className="object-cover"
                sizes="(max-width: 640px) 100vw, 384px"
              />
            </motion.div>
          ) : (
            <motion.div
              className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/30 via-base-200 to-accent/30"
              animate={photoAmbient}
              transition={photoTransition}
            >
              <PawPrint
                aria-hidden="true"
                className="h-40 w-40 text-base-content/15"
              />
            </motion.div>
          )}
        </div>

        {/* ---- Layered gradient + blur overlays fading to base-100 -------- */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-base-100 via-base-100/80 to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-base-100 to-transparent backdrop-blur-[2px] [mask-image:linear-gradient(to_top,black,transparent)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-base-content/10 rounded-box"
        />

        {/* ---- Floating paw particles (ambient, reduced-motion safe) ------ */}
        {!reduced && (
          <>
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute left-6 top-24 text-primary/30"
              animate={{ y: [0, -18, 0], opacity: [0.15, 0.4, 0.15] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            >
              <PawPrint className="h-5 w-5" />
            </motion.span>
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute right-10 top-16 text-accent/30"
              animate={{ y: [0, -22, 0], opacity: [0.1, 0.35, 0.1] }}
              transition={{
                duration: 8,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: 1.2,
              }}
            >
              <PawPrint className="h-4 w-4" />
            </motion.span>
          </>
        )}

        {/* ---- Groomer branding header pill (top-left) -------------------- */}
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-base-content/10 bg-base-100/70 px-2.5 py-1.5 backdrop-blur-md">
          {safeHttpsImageSrc(data.branding.logoUrl) ? (
            <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-full bg-base-100">
              <Image
                src={safeHttpsImageSrc(data.branding.logoUrl) as string}
                alt={`${data.branding.businessName || 'Business'} logo`}
                fill
                className="object-cover"
                sizes="24px"
              />
            </span>
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <PawPrint aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="max-w-[9rem] truncate text-xs font-semibold text-base-content">
            {data.branding.businessName || 'Pet Grooming'}
          </span>
        </div>

        {/* ---- QR tile (top-right, flips a readable scan panel) ----------- */}
        <div className="absolute right-3 top-3 z-10 flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setShowQr((v) => !v)}
            aria-pressed={showQr}
            aria-label={showQr ? 'Hide QR code' : 'Show QR code to scan'}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-base-content/10 bg-white p-1.5 shadow-card transition-transform hover:scale-105"
          >
            {showQr ? (
              <QRCodeSVG
                value={shareUrl}
                size={72}
                level="M"
                marginSize={0}
                bgColor="#ffffff"
                fgColor="#111827"
              />
            ) : (
              <QrCode aria-hidden="true" className="h-7 w-7 text-neutral-800" />
            )}
          </button>
          <span className="rounded-full bg-base-100/70 px-2 py-0.5 text-[0.6rem] font-medium text-base-content/70 backdrop-blur-md">
            {showQr ? 'Scan for details' : 'Tap for QR'}
          </span>
        </div>

        {/* ---- Content block (reveal with blur→sharp staggerChildren) ----- */}
        <motion.div
          className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3 p-5"
          variants={reduced ? undefined : contentVariants}
          initial={reduced ? false : 'hidden'}
          animate="visible"
        >
          {/* Coat "verified" badge */}
          <motion.div variants={reduced ? undefined : itemVariants}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-base-content/10 bg-base-100/70 px-2.5 py-1 text-xs font-medium text-primary backdrop-blur-md">
              <BadgeCheck aria-hidden="true" className="h-3.5 w-3.5" />
              {titleCase(data.coatCondition)} coat
            </span>
          </motion.div>

          {/* Letter-by-letter animated name */}
          <motion.h2
            className="relative font-display text-4xl font-bold leading-none text-base-content"
            variants={reduced ? undefined : contentVariants}
            aria-label={name}
          >
            <span className="flex flex-wrap">
              {letters.map((char, i) => (
                <motion.span
                  key={`${char}-${i}`}
                  variants={reduced ? undefined : letterVariants}
                  className="inline-block"
                  aria-hidden="true"
                >
                  {char === ' ' ? '\u00A0' : char}
                </motion.span>
              ))}
            </span>
            {/* Gentle shimmer sweep (ambient; off under reduced motion) */}
            {!reduced && (
              <motion.span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-primary/40 to-transparent bg-clip-text text-transparent"
                initial={{ backgroundPosition: '-150% 0' }}
                animate={{ backgroundPosition: ['-150% 0', '250% 0'] }}
                transition={{
                  duration: 5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  repeatDelay: 1.5,
                }}
                style={{ backgroundSize: '200% 100%' }}
              >
                <span className="flex flex-wrap">
                  {letters.map((char, i) => (
                    <span key={`sh-${i}`} className="inline-block">
                      {char === ' ' ? '\u00A0' : char}
                    </span>
                  ))}
                </span>
              </motion.span>
            )}
          </motion.h2>

          {/* breed • weight • age */}
          <motion.p
            variants={reduced ? undefined : itemVariants}
            className="text-sm text-base-content/60"
          >
            {data.breed} • {data.weight} {data.weightUnit} • {ageLabel}
          </motion.p>

          {/* Stat row — pet facts */}
          <motion.div
            variants={reduced ? undefined : itemVariants}
            className="grid grid-cols-3 gap-2 rounded-box border border-base-content/10 bg-base-100/60 p-3 backdrop-blur-md"
          >
            <Stat
              icon={<PawPrint className="h-4 w-4" />}
              label="Temperament"
              value={titleCase(data.temperament)}
            />
            <Stat
              icon={<Scissors className="h-4 w-4" />}
              label="Coat"
              value={titleCase(data.coatCondition)}
            />
            <Stat
              icon={<CalendarClock className="h-4 w-4" />}
              label="Next visit"
              value={nextDate || '—'}
            />
          </motion.div>

          {/* Special flags as themed chips */}
          {data.specialFlags.length > 0 && (
            <motion.div
              variants={reduced ? undefined : itemVariants}
              className="flex flex-wrap gap-1.5"
            >
              {data.specialFlags.map((flag) => (
                <span
                  key={flag}
                  className="rounded-full bg-secondary/15 px-2.5 py-1 text-xs font-medium text-secondary"
                >
                  {flag}
                </span>
              ))}
            </motion.div>
          )}
        </motion.div>
      </motion.article>
    </motion.div>
  );
}

/** A compact labelled stat in the reskinned stats row. */
function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 text-center">
      <span className="text-primary" aria-hidden="true">
        {icon}
      </span>
      <span className="text-[0.6rem] uppercase tracking-wide text-base-content/50">
        {label}
      </span>
      <span className="w-full truncate text-xs font-semibold text-base-content">
        {value}
      </span>
    </div>
  );
}

export default AnimatedPetCard;
