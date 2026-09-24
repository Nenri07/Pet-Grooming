import type { Config } from 'tailwindcss';
import daisyui from 'daisyui';

/** Wraps an HSL-triple CSS var so Tailwind alpha modifiers (bg-primary/40) work. */
const hsl = (v: string) => `hsl(var(${v}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: hsl('--color-primary'),
        'primary-content': hsl('--color-primary-content'),
        secondary: hsl('--color-secondary'),
        'secondary-content': hsl('--color-secondary-content'),
        accent: hsl('--color-accent'),
        'accent-content': hsl('--color-accent-content'),
        neutral: hsl('--color-neutral'),
        'neutral-content': hsl('--color-neutral-content'),
        'base-100': hsl('--color-base-100'),
        'base-200': hsl('--color-base-200'),
        'base-300': hsl('--color-base-300'),
        'base-content': hsl('--color-base-content'),
        info: hsl('--color-info'),
        success: hsl('--color-success'),
        warning: hsl('--color-warning'),
        error: hsl('--color-error'),
        // marketing-only tokens
        cream: hsl('--color-cream'),
        sand: hsl('--color-sand'),
        ink: hsl('--color-ink'),
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        base: ['16px', { lineHeight: '1.5' }],
        hero: ['var(--text-hero)', { lineHeight: 'var(--leading-tight)' }],
        h2: ['var(--text-h2)', { lineHeight: '1.15' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        '2xl': 'var(--radius-lg)', // keep existing "2xl" callers valid
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        soft: 'var(--shadow-soft)',
        glow: 'var(--shadow-glow)',
      },
      spacing: {
        section: 'var(--space-section)',
        gutter: 'var(--space-gutter)',
      },
      transitionTimingFunction: {
        'out-expo': 'var(--ease-out-expo)',
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        pawport_light: {
          primary: 'hsl(var(--color-primary))',
          'primary-content': 'hsl(var(--color-primary-content))',
          secondary: 'hsl(var(--color-secondary))',
          'secondary-content': 'hsl(var(--color-secondary-content))',
          accent: 'hsl(var(--color-accent))',
          'accent-content': 'hsl(var(--color-accent-content))',
          neutral: 'hsl(var(--color-neutral))',
          'neutral-content': 'hsl(var(--color-neutral-content))',
          'base-100': 'hsl(var(--color-base-100))',
          'base-200': 'hsl(var(--color-base-200))',
          'base-300': 'hsl(var(--color-base-300))',
          'base-content': 'hsl(var(--color-base-content))',
          info: 'hsl(var(--color-info))',
          success: 'hsl(var(--color-success))',
          warning: 'hsl(var(--color-warning))',
          error: 'hsl(var(--color-error))',
          '--rounded-box': 'var(--radius-lg)',
          '--rounded-btn': 'var(--radius-md)',
        },
      },
      {
        pawport_dark: {
          // Same var references — the values differ only because the
          // [data-theme="dark"] block in theme.css overrides the vars.
          primary: 'hsl(var(--color-primary))',
          'primary-content': 'hsl(var(--color-primary-content))',
          secondary: 'hsl(var(--color-secondary))',
          'secondary-content': 'hsl(var(--color-secondary-content))',
          accent: 'hsl(var(--color-accent))',
          'accent-content': 'hsl(var(--color-accent-content))',
          neutral: 'hsl(var(--color-neutral))',
          'neutral-content': 'hsl(var(--color-neutral-content))',
          'base-100': 'hsl(var(--color-base-100))',
          'base-200': 'hsl(var(--color-base-200))',
          'base-300': 'hsl(var(--color-base-300))',
          'base-content': 'hsl(var(--color-base-content))',
          info: 'hsl(var(--color-info))',
          success: 'hsl(var(--color-success))',
          warning: 'hsl(var(--color-warning))',
          error: 'hsl(var(--color-error))',
          '--rounded-box': 'var(--radius-lg)',
          '--rounded-btn': 'var(--radius-md)',
        },
      },
    ],
    darkTheme: 'pawport_dark',
    base: true,
    styled: true,
    utils: true,
  },
};

export default config;
