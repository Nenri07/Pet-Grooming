'use client';
import * as React from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { heroLine, staggerParent, micro, useReducedMotion } from '@/lib/animation';
import { heroMedia } from './heroMedia';
import Link from 'next/link';

/**
 * Hero background resolution order (D3):
 *   1. <video> (muted, loop, playsInline, poster) IF sources exist AND motion allowed
 *   2. poster <Image> (priority for LCP) IF poster exists
 *   3. CSS gradient fallback (always present under everything)
 *
 * The video is deferred (preload="none" + lazy attach) so it never blocks LCP;
 * the poster image is the LCP candidate and paints immediately.
 */
export function Hero() {
  const reduced = useReducedMotion();
  const hasVideo = Boolean(heroMedia.videoMp4 || heroMedia.videoWebm) && !reduced;
  const [videoReady, setVideoReady] = React.useState(false);

  return (
    <section className="relative isolate flex min-h-[92vh] items-center overflow-hidden">
      {/* Layer 0: gradient — always present, guarantees non-empty hero */}
      <div
        aria-hidden
        className="absolute inset-0 -z-30"
        style={{
          background:
            'radial-gradient(1200px 600px at 70% 20%, hsl(var(--color-primary)/0.35), transparent 60%),' +
            'linear-gradient(180deg, hsl(var(--color-base-100)), hsl(var(--color-base-200)))',
        }}
      />

      {/* Layer 1: poster (LCP image) */}
      {heroMedia.poster && (
        <Image
          src={heroMedia.poster}
          alt=""
          fill
          priority
          sizes="100vw"
          className={`-z-20 object-cover transition-opacity duration-700 ${
            videoReady ? 'opacity-0' : 'opacity-100'
          }`}
        />
      )}

      {/* Layer 2: deferred video (only when allowed + available) */}
      {hasVideo && (
        <video
          className="absolute inset-0 -z-20 h-full w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          poster={heroMedia.poster ?? undefined}
          onCanPlay={() => setVideoReady(true)}
        >
          {heroMedia.videoWebm && <source src={heroMedia.videoWebm} type="video/webm" />}
          {heroMedia.videoMp4 && <source src={heroMedia.videoMp4} type="video/mp4" />}
        </video>
      )}

      {/* Readability scrim */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-ink/20" />

      {/* Foreground content — Framer owns these reveals */}
      <motion.div
        className="mx-auto max-w-5xl px-gutter text-center text-primary-content"
        variants={staggerParent(0.12)}
        initial="hidden"
        animate="show"
      >
        <motion.p variants={heroLine} className="mb-4 text-sm uppercase tracking-[0.3em]">
          Luxury mobile pet spa
        </motion.p>
        <motion.h1 variants={heroLine} className="text-hero font-display font-bold">
          Grooming that comes to your door
        </motion.h1>
        <motion.p variants={heroLine} className="mx-auto mt-6 max-w-xl text-lg opacity-90">
          Effortless booking, calm pets, happy owners.
        </motion.p>
        <motion.div variants={heroLine} className="mt-10 flex justify-center gap-4">
          <motion.div whileHover={micro.hover} whileTap={micro.tap}>
            <Link href="/register" className="btn btn-primary rounded-btn min-h-[44px]">
              Get started
            </Link>
          </motion.div>
          <Link href="#features" className="btn btn-ghost rounded-btn min-h-[44px]">
            See how it works
          </Link>
        </motion.div>
      </motion.div>
    </section>
  );
}
