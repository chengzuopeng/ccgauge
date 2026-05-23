import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'rgb(var(--bg-base) / <alpha-value>)',
          surface: 'rgb(var(--bg-surface) / <alpha-value>)',
          'surface-hi': 'rgb(var(--bg-surface-hi) / <alpha-value>)',
          // One tier above `surface` for floating overlays (popovers,
          // dropdowns). The `--bg-elevated` CSS var already exists in
          // globals.css and `.card-elevated` consumes it via raw CSS;
          // exposing it as a Tailwind utility lets popover components
          // compose it inline like any other surface token.
          elevated: 'rgb(var(--bg-elevated) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          hi: 'rgb(var(--border-hi) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--text-tertiary) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          hover: 'rgb(var(--brand-hover) / <alpha-value>)',
          // High-contrast fill for chips with white text. AA-compliant in
          // both themes. Use as `bg-brand-strong text-white`.
          strong: 'rgb(var(--brand-strong) / <alpha-value>)',
        },
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        chart: {
          input: 'rgb(var(--chart-input) / <alpha-value>)',
          output: 'rgb(var(--chart-output) / <alpha-value>)',
          'cache-read': 'rgb(var(--chart-cache-read) / <alpha-value>)',
          'cache-create': 'rgb(var(--chart-cache-create) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '12px',
        button: '8px',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        popover: 'var(--shadow-popover)',
      },
      transitionTimingFunction: {
        'out-soft': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      gridTemplateColumns: {
        // 24 columns: hour-of-day heatmap on the overview activity card.
        24: 'repeat(24, minmax(0, 1fr))',
      },
    },
  },
  plugins: [],
};

export default config;
