'use client';
import * as React from 'react';
import Link from 'next/link';
import { useGsapContext } from '@/lib/animation';

/**
 * Sticky header. GSAP ScrollTrigger toggles a "scrolled" class that adds a
 * translucent background, reduced height, and a soft shadow. Framer is NOT
 * used for these properties (D4). Reduced-motion users get the scrolled style
 * applied instantly (no tween) via the same class toggle.
 */
export function MarketingHeader() {
  const scopeRef = useGsapContext(({ gsap, scope }) => {
    const el = scope.querySelector('[data-header]');
    if (!el) return;
    gsap.to(el, {
      scrollTrigger: {
        start: 'top+=40 top',
        end: 99999,
        toggleClass: { targets: el, className: 'is-scrolled' },
      },
    });
  });

  return (
    <div ref={scopeRef as React.RefObject<HTMLDivElement>}>
      <header
        data-header
        className="fixed inset-x-0 top-0 z-50 flex h-20 items-center justify-between px-gutter transition-[height,background-color,box-shadow] duration-300 [&.is-scrolled]:h-16 [&.is-scrolled]:bg-base-100/80 [&.is-scrolled]:shadow-soft [&.is-scrolled]:backdrop-blur"
      >
        <Link href="/" className="text-xl font-bold text-primary">PawPort</Link>
        <nav className="hidden gap-6 md:flex">
          <Link href="#features">Features</Link>
          <Link href="#pricing">Pricing</Link>
          <Link href="/login" className="btn btn-sm btn-primary rounded-btn">Log in</Link>
        </nav>
      </header>
    </div>
  );
}
