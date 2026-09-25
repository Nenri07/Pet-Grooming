import type { Config } from 'tailwindcss';
import daisyui from 'daisyui';

/**
 * PawPort theme catalog for DaisyUI.
 *
 * Each theme registers its semantic colors as OKLCH values so DaisyUI emits a
 * real `[data-theme="pawport_*"]{ --p: ...; --b1: ...; ... }` block. Switching
 * `data-theme` on <html> (via next-themes) then recolors every DaisyUI utility
 * (bg-primary, text-base-content, …) across BOTH the marketing site and the
 * portal. The `--pp-*` custom tokens (hero gradient, glow, card shadow, glass,
 * border) are attached per theme so shadow-card / bg-hero / shadow-glow recolor
 * too.
 *
 * IMPORTANT: DaisyUI OWNS these color tokens (we do NOT use `themes:false`).
 * theme.css is kept only for the non-color design tokens (radii, fonts, the
 * visible-by-default reveal rules) and its per-theme --pp-* fallbacks.
 */
const ppTokens = (
  heroGradient: string,
  glow: string,
  cardShadow: string,
) => ({
  '--pp-hero-gradient': heroGradient,
  '--pp-glow': glow,
  '--pp-shadow-card': cardShadow,
  '--pp-border': 'oklch(var(--bc) / 0.10)',
  '--pp-glass': 'oklch(var(--b1) / 0.7)',
  '--rounded-box': '1.5rem',
  '--rounded-btn': '999px',
  '--rounded-badge': '999px',
});

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display-stack)'],
        sans: ['var(--font-body-stack)'],
      },
      fontSize: {
        hero: ['clamp(2.75rem, 7vw, 5.5rem)', { lineHeight: '1.08' }],
        h2: ['clamp(1.75rem, 4vw, 3rem)', { lineHeight: '1.15' }],
      },
      borderRadius: {
        '2xl': '1rem',
      },
      boxShadow: {
        card: 'var(--pp-shadow-card)',
        glow: 'var(--pp-glow)',
        soft: '0 10px 30px -12px rgb(31 41 55 / 0.18)',
      },
      backgroundImage: {
        hero: 'var(--pp-hero-gradient)',
      },
      spacing: {
        section: 'clamp(4rem, 10vw, 9rem)',
        gutter: 'clamp(1rem, 5vw, 3rem)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    darkTheme: 'pawport_dark',
    themes: [
      {
        pawport_light: {
          'color-scheme': 'light',
          primary: 'oklch(42% 0.11 255)',
          'primary-content': 'oklch(98% 0.01 255)',
          secondary: 'oklch(74% 0.08 170)',
          'secondary-content': 'oklch(24% 0.04 170)',
          accent: 'oklch(80% 0.09 15)',
          'accent-content': 'oklch(30% 0.05 15)',
          neutral: 'oklch(24% 0.03 260)',
          'neutral-content': 'oklch(96% 0.01 260)',
          'base-100': 'oklch(98.5% 0.008 85)',
          'base-200': 'oklch(95.5% 0.012 85)',
          'base-300': 'oklch(91% 0.016 85)',
          'base-content': 'oklch(24% 0.025 260)',
          info: 'oklch(70% 0.12 235)',
          success: 'oklch(72% 0.14 155)',
          warning: 'oklch(82% 0.14 85)',
          error: 'oklch(64% 0.20 25)',
          ...ppTokens(
            'radial-gradient(120% 90% at 20% 10%, oklch(92% 0.05 240) 0%, oklch(97% 0.02 85) 55%, oklch(94% 0.05 15) 100%)',
            '0 20px 60px -20px oklch(42% 0.11 255 / 0.35)',
            '0 10px 30px -12px oklch(20% 0.03 260 / 0.10)',
          ),
        },
      },
      {
        pawport_dark: {
          'color-scheme': 'dark',
          primary: 'oklch(74% 0.12 245)',
          'primary-content': 'oklch(18% 0.03 245)',
          secondary: 'oklch(78% 0.09 175)',
          'secondary-content': 'oklch(20% 0.04 175)',
          accent: 'oklch(82% 0.10 20)',
          'accent-content': 'oklch(22% 0.04 20)',
          neutral: 'oklch(26% 0.03 265)',
          'neutral-content': 'oklch(95% 0.01 265)',
          'base-100': 'oklch(18% 0.025 265)',
          'base-200': 'oklch(15% 0.025 265)',
          'base-300': 'oklch(12% 0.025 265)',
          'base-content': 'oklch(94% 0.01 90)',
          info: 'oklch(72% 0.12 235)',
          success: 'oklch(76% 0.14 155)',
          warning: 'oklch(84% 0.14 85)',
          error: 'oklch(68% 0.19 25)',
          ...ppTokens(
            'radial-gradient(120% 90% at 20% 10%, oklch(30% 0.08 250) 0%, oklch(18% 0.025 265) 55%, oklch(24% 0.06 15) 100%)',
            '0 20px 80px -20px oklch(74% 0.12 245 / 0.45)',
            '0 12px 40px -12px oklch(0% 0 0 / 0.55)',
          ),
          '--pp-glass': 'oklch(18% 0.025 265 / 0.6)',
        },
      },
      {
        pawport_meadow: {
          'color-scheme': 'light',
          primary: 'oklch(52% 0.12 150)',
          'primary-content': 'oklch(98% 0.01 150)',
          secondary: 'oklch(68% 0.09 130)',
          'secondary-content': 'oklch(22% 0.05 130)',
          accent: 'oklch(78% 0.11 75)',
          'accent-content': 'oklch(26% 0.06 75)',
          neutral: 'oklch(30% 0.03 150)',
          'neutral-content': 'oklch(96% 0.01 150)',
          'base-100': 'oklch(98.5% 0.012 130)',
          'base-200': 'oklch(96% 0.018 130)',
          'base-300': 'oklch(92% 0.024 130)',
          'base-content': 'oklch(26% 0.04 155)',
          info: 'oklch(68% 0.11 200)',
          success: 'oklch(70% 0.15 150)',
          warning: 'oklch(82% 0.14 85)',
          error: 'oklch(62% 0.20 25)',
          ...ppTokens(
            'radial-gradient(120% 90% at 20% 10%, oklch(90% 0.07 150) 0%, oklch(97% 0.02 130) 55%, oklch(92% 0.08 75) 100%)',
            '0 20px 60px -20px oklch(52% 0.12 150 / 0.35)',
            '0 10px 30px -12px oklch(30% 0.04 150 / 0.12)',
          ),
        },
      },
      {
        pawport_sand: {
          'color-scheme': 'light',
          primary: 'oklch(58% 0.13 55)',
          'primary-content': 'oklch(98% 0.01 55)',
          secondary: 'oklch(72% 0.10 40)',
          'secondary-content': 'oklch(26% 0.06 40)',
          accent: 'oklch(66% 0.14 25)',
          'accent-content': 'oklch(98% 0.01 25)',
          neutral: 'oklch(32% 0.04 50)',
          'neutral-content': 'oklch(96% 0.01 50)',
          'base-100': 'oklch(98% 0.016 75)',
          'base-200': 'oklch(95% 0.022 70)',
          'base-300': 'oklch(90% 0.03 65)',
          'base-content': 'oklch(28% 0.05 50)',
          info: 'oklch(68% 0.11 235)',
          success: 'oklch(70% 0.14 150)',
          warning: 'oklch(80% 0.14 80)',
          error: 'oklch(60% 0.20 28)',
          ...ppTokens(
            'radial-gradient(120% 90% at 20% 10%, oklch(90% 0.08 60) 0%, oklch(97% 0.03 75) 55%, oklch(88% 0.10 30) 100%)',
            '0 20px 60px -20px oklch(58% 0.13 55 / 0.35)',
            '0 10px 30px -12px oklch(32% 0.05 50 / 0.14)',
          ),
        },
      },
      {
        pawport_blossom: {
          'color-scheme': 'light',
          primary: 'oklch(60% 0.15 355)',
          'primary-content': 'oklch(98% 0.01 355)',
          secondary: 'oklch(74% 0.09 330)',
          'secondary-content': 'oklch(26% 0.05 330)',
          accent: 'oklch(80% 0.09 30)',
          'accent-content': 'oklch(28% 0.05 30)',
          neutral: 'oklch(32% 0.04 350)',
          'neutral-content': 'oklch(96% 0.01 350)',
          'base-100': 'oklch(99% 0.01 350)',
          'base-200': 'oklch(96.5% 0.018 350)',
          'base-300': 'oklch(93% 0.026 350)',
          'base-content': 'oklch(28% 0.05 350)',
          info: 'oklch(68% 0.11 300)',
          success: 'oklch(70% 0.14 150)',
          warning: 'oklch(82% 0.14 85)',
          error: 'oklch(62% 0.20 20)',
          ...ppTokens(
            'radial-gradient(120% 90% at 20% 10%, oklch(92% 0.07 350) 0%, oklch(98% 0.02 350) 55%, oklch(93% 0.06 30) 100%)',
            '0 20px 60px -20px oklch(60% 0.15 355 / 0.35)',
            '0 10px 30px -12px oklch(32% 0.05 350 / 0.12)',
          ),
        },
      },
      {
        pawport_ocean: {
          'color-scheme': 'light',
          primary: 'oklch(56% 0.11 210)',
          'primary-content': 'oklch(98% 0.01 210)',
          secondary: 'oklch(72% 0.10 185)',
          'secondary-content': 'oklch(22% 0.05 185)',
          accent: 'oklch(80% 0.09 70)',
          'accent-content': 'oklch(28% 0.05 70)',
          neutral: 'oklch(30% 0.04 220)',
          'neutral-content': 'oklch(96% 0.01 220)',
          'base-100': 'oklch(98.5% 0.012 200)',
          'base-200': 'oklch(96% 0.018 200)',
          'base-300': 'oklch(91% 0.026 200)',
          'base-content': 'oklch(26% 0.04 220)',
          info: 'oklch(66% 0.12 220)',
          success: 'oklch(70% 0.14 165)',
          warning: 'oklch(82% 0.14 85)',
          error: 'oklch(62% 0.20 25)',
          ...ppTokens(
            'radial-gradient(120% 90% at 20% 10%, oklch(88% 0.08 205) 0%, oklch(97% 0.02 195) 55%, oklch(92% 0.06 70) 100%)',
            '0 20px 60px -20px oklch(56% 0.11 210 / 0.35)',
            '0 10px 30px -12px oklch(30% 0.04 210 / 0.12)',
          ),
        },
      },
      {
        pawport_charcoal: {
          'color-scheme': 'dark',
          primary: 'oklch(80% 0.13 75)',
          'primary-content': 'oklch(20% 0.04 75)',
          secondary: 'oklch(72% 0.06 40)',
          'secondary-content': 'oklch(18% 0.03 40)',
          accent: 'oklch(78% 0.12 55)',
          'accent-content': 'oklch(20% 0.04 55)',
          neutral: 'oklch(28% 0.01 60)',
          'neutral-content': 'oklch(94% 0.01 60)',
          'base-100': 'oklch(20% 0.006 60)',
          'base-200': 'oklch(16% 0.006 60)',
          'base-300': 'oklch(13% 0.006 60)',
          'base-content': 'oklch(92% 0.012 75)',
          info: 'oklch(72% 0.11 235)',
          success: 'oklch(76% 0.14 155)',
          warning: 'oklch(84% 0.14 85)',
          error: 'oklch(68% 0.19 25)',
          ...ppTokens(
            'radial-gradient(120% 90% at 20% 10%, oklch(34% 0.06 70) 0%, oklch(18% 0.006 60) 55%, oklch(28% 0.08 45) 100%)',
            '0 20px 80px -20px oklch(80% 0.13 75 / 0.40)',
            '0 12px 40px -12px oklch(0% 0 0 / 0.55)',
          ),
          '--pp-glass': 'oklch(20% 0.006 60 / 0.6)',
        },
      },
    ],
  },
};

export default config;