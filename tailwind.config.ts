import type { Config } from 'tailwindcss';
import daisyui from 'daisyui';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display-stack)'],
        sans: ['var(--font-body-stack)'],
      },
      fontSize: {
        // Kept so existing `text-hero` / `text-h2` callers keep working.
        hero: ['clamp(2.75rem, 7vw, 5.5rem)', { lineHeight: '1.08' }],
        h2: ['clamp(1.75rem, 4vw, 3rem)', { lineHeight: '1.15' }],
      },
      borderRadius: {
        // `2xl` alias kept so existing callers stay valid.
        '2xl': '1rem',
      },
      boxShadow: {
        card: 'var(--pp-shadow-card)',
        glow: 'var(--pp-glow)',
        // Kept so existing `shadow-soft` callers keep working.
        soft: '0 10px 30px -12px rgb(31 41 55 / 0.18)',
      },
      backgroundImage: {
        hero: 'var(--pp-hero-gradient)',
      },
      spacing: {
        // Kept so existing `py-section` / `px-gutter` callers keep working.
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
    themes: false,
    darkTheme: 'pawport_dark',
  },
};

export default config;
