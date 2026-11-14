import type { Config } from 'tailwindcss';
import daisyui from 'daisyui';
import tailwindcssAnimate from 'tailwindcss-animate';

/**
 * PawPort theme catalog for DaisyUI.
 *
 * Each theme registers its semantic colors as OKLCH values so DaisyUI emits a
 * real `[data-theme="pawport_*"]{ --p: ...; --b1: ...; ... }` block. Switching
 * `data-theme` on <html> (via next-themes) then recolors every DaisyUI utility
 * (bg-primary, text-base-content, …) across BOTH the marketing site and the
 * portal. The `--pp-*` custom tokens (hero gradient, card shadow, glass,
 * border) are attached per theme.
 *
 * IMPORTANT: DaisyUI OWNS these color tokens (we do NOT use `themes:false`).
 * theme.css is kept only for the non-color design tokens (radii, fonts, the
 * visible-by-default reveal rules).
 */

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      fontSize: {
        hero: ['clamp(2.5rem, 6vw, 4.5rem)', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '600' }],
        h2: ['clamp(1.75rem, 3.5vw, 2.5rem)', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
        pageTitle: ['1.875rem', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
        sectionTitle: ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '600' }],
        cardTitle: ['1rem', { lineHeight: '1.4', fontWeight: '600' }],
        caption: ['0.75rem', { lineHeight: '1.4', fontWeight: '500' }],
      },
      borderRadius: {
        '2xl': '1rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.05)',
        glow: 'none',
        soft: '0 1px 3px rgb(0 0 0 / 0.06)',
      },
      backgroundImage: {
        hero: 'var(--pp-hero-gradient)',
      },
      spacing: {
        section: 'clamp(4rem, 10vw, 9rem)',
        // Tighter vertical rhythm for the landing page only (`section` is still
        // used by legal / for-groomers / demo pages).
        band: 'clamp(3rem, 5vw, 4.5rem)',
        gutter: 'clamp(1rem, 5vw, 3rem)',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [daisyui, tailwindcssAnimate],
  daisyui: {
    darkTheme: 'pawport_dark',
    themes: [
      {
        pawport_light: {
          'color-scheme': 'light',
          primary: 'oklch(48% 0.13 195)',
          'primary-content': 'oklch(98% 0.01 195)',
          secondary: 'oklch(60% 0.10 175)',
          'secondary-content': 'oklch(20% 0.04 175)',
          accent: 'oklch(70% 0.10 40)',
          'accent-content': 'oklch(20% 0.05 40)',
          neutral: 'oklch(22% 0.02 260)',
          'neutral-content': 'oklch(96% 0.01 260)',
          'base-100': 'oklch(99% 0.005 85)',
          'base-200': 'oklch(96% 0.008 85)',
          'base-300': 'oklch(91% 0.012 85)',
          'base-content': 'oklch(22% 0.02 260)',
          info: 'oklch(70% 0.12 235)',
          success: 'oklch(72% 0.14 155)',
          warning: 'oklch(82% 0.14 85)',
          error: 'oklch(64% 0.20 25)',
          '--pp-hero-gradient': 'linear-gradient(180deg, oklch(99% 0.005 85) 0%, oklch(96% 0.008 85) 100%)',
          '--pp-glow': 'none',
          '--pp-shadow-card': '0 1px 2px rgb(0 0 0 / 0.04)',
          '--pp-border': 'oklch(91% 0.012 85)',
          '--pp-glass': 'oklch(99% 0.005 85 / 0.85)',
          '--rounded-box': '1.5rem',
          '--rounded-btn': '999px',
          '--rounded-badge': '999px',
        },
      },
      {
        pawport_dark: {
          'color-scheme': 'dark',
          primary: 'oklch(72% 0.13 195)',
          'primary-content': 'oklch(15% 0.03 195)',
          secondary: 'oklch(70% 0.10 175)',
          'secondary-content': 'oklch(15% 0.04 175)',
          accent: 'oklch(75% 0.10 40)',
          'accent-content': 'oklch(15% 0.05 40)',
          neutral: 'oklch(94% 0.01 260)',
          'neutral-content': 'oklch(14% 0.005 260)',
          'base-100': 'oklch(14% 0.005 260)',
          'base-200': 'oklch(11% 0.005 260)',
          'base-300': 'oklch(20% 0.008 260)',
          'base-content': 'oklch(94% 0.01 260)',
          info: 'oklch(72% 0.12 235)',
          success: 'oklch(76% 0.14 155)',
          warning: 'oklch(84% 0.14 85)',
          error: 'oklch(68% 0.19 25)',
          '--pp-hero-gradient': 'linear-gradient(180deg, oklch(14% 0.005 260) 0%, oklch(11% 0.005 260) 100%)',
          '--pp-glow': 'none',
          '--pp-shadow-card': '0 1px 2px rgb(0 0 0 / 0.3)',
          '--pp-border': 'oklch(20% 0.008 260)',
          '--pp-glass': 'oklch(14% 0.005 260 / 0.85)',
          '--rounded-box': '1.5rem',
          '--rounded-btn': '999px',
          '--rounded-badge': '999px',
        },
      },
    ],
  },
};

export default config;