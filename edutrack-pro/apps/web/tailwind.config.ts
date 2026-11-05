import type { Config } from 'tailwindcss';

/**
 * Tailwind theme for EduTrack Pro.
 *
 * Two layers:
 *  1. The `slate` (and `rose`/`amber`/`teal`) ramps are re-pointed at the
 *     navy system, so the existing markup — which was written with Tailwind's
 *     defaults — now renders in navy blue without a page-by-page rewrite.
 *  2. Semantic tokens (`surface`, `ink`, `line`, `royal`, `brand`, `accent`…)
 *     for new work, all backed by the CSS variables in globals.css.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ---- product identity: navy ---- */
        navy: {
          50: '#F4F8FE',
          100: '#EDF4FC',
          200: '#D9E6F4',
          300: '#B8CCE1',
          400: '#8BA3BE',
          500: '#63758B',
          600: '#63758B',
          700: '#477DB5',
          800: '#315F91',
          900: '#244A78',
          950: '#23364D',
        },
        /* Interactive blues */
        royal: {
          DEFAULT: 'rgb(var(--royal) / <alpha-value>)',
          strong: 'rgb(var(--royal-strong) / <alpha-value>)',
          soft: '#EDF4FC',
        },
        bright: { DEFAULT: '#3B82F6', soft: '#D9E6F4' },

        /* The school's own colour, injected at runtime from the school profile */
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          soft: 'rgb(var(--brand-soft) / <alpha-value>)',
          fg: 'rgb(var(--brand-fg) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          soft: '#DDF7F1',
        },

        /* Semantic surfaces and ink */
        canvas: 'rgb(var(--bg-canvas) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          muted: 'rgb(var(--surface-muted) / <alpha-value>)',
          tint: 'rgb(var(--surface-tint) / <alpha-value>)',
          tintStrong: 'rgb(var(--surface-tint-strong) / <alpha-value>)',
          inverse: 'rgb(var(--surface-inverse) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--text) / <alpha-value>)',
          strong: 'rgb(var(--text-strong) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
          subtle: 'rgb(var(--text-subtle) / <alpha-value>)',
          inverse: 'rgb(var(--text-inverse) / <alpha-value>)',
          'inverse-muted': 'rgb(var(--text-inverse-muted) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          strong: 'rgb(var(--border-strong) / <alpha-value>)',
          inverse: 'rgb(var(--border-inverse) / <alpha-value>)',
        },
        success: {
          DEFAULT: '#16865B',
          strong: '#0F6F49',
          soft: 'rgb(var(--success-soft) / <alpha-value>)',
        },
        warning: {
          DEFAULT: '#F2B84B',
          strong: '#8F631F',
          soft: 'rgb(var(--warning-soft) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--danger) / <alpha-value>)',
          strong: 'rgb(var(--danger-strong) / <alpha-value>)',
          soft: 'rgb(var(--danger-soft) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--info) / <alpha-value>)',
          strong: 'rgb(var(--info-strong) / <alpha-value>)',
          soft: 'rgb(var(--info-soft) / <alpha-value>)',
        },

        /* ---- re-pointed Tailwind defaults ------------------------------------
           Existing screens use slate/amber/rose/teal class names heavily; these
           values make those names resolve to the navy design system so the
           palette is consistent everywhere.                                        */
        slate: {
          50: '#F4F8FE',
          100: '#EDF4FC',
          200: '#D9E6F4',
          300: '#B8CCE1',
          400: '#8BA3BE',
          500: '#63758B',
          600: '#63758B',
          700: '#315F91',
          800: '#23364D',
          900: '#23364D',
          950: '#244A78',
        },
        rose: {
          50: '#FFF4F4',
          100: '#FCE6E6',
          200: '#F7CACA',
          300: '#F2A5A5',
          400: '#E77A7A',
          500: '#D64545',
          600: '#C13D3D',
          700: '#AC3737',
          800: '#8E3030',
          900: '#772D2D',
        },
        amber: {
          50: '#FFF9E9',
          100: '#FFF4D6',
          200: '#F6D58E',
          300: '#F2C56F',
          400: '#F2B84B',
          500: '#F2B84B',
          600: '#B98124',
          700: '#8F631F',
          800: '#704E21',
          900: '#5D421F',
        },
        teal: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E',
          800: '#115E59',
          900: '#134E4A',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        /* Tightened, readable scale for data-dense screens */
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
        xs: ['0.75rem', { lineHeight: '1.05rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        lg: ['1rem', { lineHeight: '1.5rem' }],
        xl: ['1.125rem', { lineHeight: '1.65rem' }],
        '2xl': ['1.375rem', { lineHeight: '1.85rem' }],
        '3xl': ['1.75rem', { lineHeight: '2.15rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.6rem' }],
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-sm)',
        card: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        'inner-top': 'var(--shadow-inset-top)',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0, 0.2, 1)',
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: { 120: '120ms', 180: '180ms', 260: '260ms' },
      spacing: {
        '4.5': '1.125rem',
        18: '4.5rem',
        sidebar: '17.5rem',
        topbar: '4rem',
      },
      zIndex: { drawer: '50', modal: '60', toast: '70' },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        rise: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        slideIn: { from: { transform: 'translateX(-100%)' }, to: { transform: 'none' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
      },
      animation: {
        'fade-in': 'fadeIn 180ms cubic-bezier(0.2, 0, 0.2, 1)',
        rise: 'rise 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in': 'slideIn 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-soft': 'pulseSoft 1.6s ease-in-out infinite',
      },
      backgroundImage: {
        'navy-fade': 'linear-gradient(135deg, #477DB5 0%, #315F91 48%, #244A78 100%)',
        'royal-cta': 'linear-gradient(135deg, rgb(var(--royal)) 0%, rgb(var(--royal-strong)) 100%)',
        'teal-cta': 'linear-gradient(135deg, #14B8A6 0%, #0D9488 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
