import type { Config } from 'tailwindcss'

// Brand scale (deep teal). Pages use blue-*/indigo-* utilities heavily, so both map here.
const brand = {
  50: '#EEF7F7', 100: '#D5ECEC', 200: '#ADD9DA', 300: '#7DC0C2', 400: '#47A2A6',
  500: '#1E8489', 600: '#0E5C63', 700: '#0A4B51', 800: '#093E43', 900: '#082F33', 950: '#041C1F',
}

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // dark: variants follow the app's toggle (html.dark-mode), not the OS setting
  darkMode: ['selector', '.dark-mode'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '"Segoe UI"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      colors: {
        brand,
        blue: brand,
        indigo: brand,
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          light: 'var(--color-primary-light)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          hover: 'var(--color-accent-hover)',
        },
        app: {
          bg: 'var(--color-bg-app)',
          card: 'var(--color-bg-card)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          muted: 'var(--color-text-muted)',
          inverse: 'var(--color-text-inverse)',
          link: 'var(--color-text-link)',
          label: 'var(--color-text-label)',
        },
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
          table: 'var(--color-border-table)',
        },
        status: {
          active: {
            bg: 'var(--color-status-active-bg)',
            text: 'var(--color-status-active-text)',
            dot: 'var(--color-status-active-dot)',
          },
          inactive: {
            bg: 'var(--color-status-inactive-bg)',
            text: 'var(--color-status-inactive-text)',
          },
        },
        'header-dark': 'var(--color-bg-table-header)',
      },
      fontSize: {
        'fiori-page-title': ['var(--fs-page-title)', { lineHeight: '24px', fontWeight: '600' }],
        'fiori-page-subtitle': ['var(--fs-page-subtitle)', { lineHeight: '18px', fontWeight: '400' }],
        'fiori-section-header': ['var(--fs-section-header)', { lineHeight: '16px', fontWeight: '600' }],
        'fiori-tab-label': ['var(--fs-tab-label)', { lineHeight: '16px', fontWeight: '500' }],
        'fiori-table-header': ['var(--fs-table-header)', { lineHeight: '16px', fontWeight: '600' }],
        'fiori-table-data': ['var(--fs-table-data)', { lineHeight: '20px', fontWeight: '400' }],
        'fiori-form-label': ['var(--fs-form-label)', { lineHeight: '16px', fontWeight: '500' }],
        'fiori-form-input': ['var(--fs-form-input)', { lineHeight: '20px', fontWeight: '400' }],
        'fiori-button': ['var(--fs-button)', { lineHeight: '16px', fontWeight: '600' }],
        'fiori-badge': ['var(--fs-badge)', { lineHeight: '14px', fontWeight: '500' }],
      },
      borderRadius: {
        'fiori': '8px',
      },
    },
  },
  plugins: [],
} satisfies Config
