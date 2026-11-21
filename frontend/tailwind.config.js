/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Палитра из ТЗ «Требование к дизайну».
        primary: {
          DEFAULT: 'rgb(var(--edu-primary) / <alpha-value>)',
          hover: 'rgb(var(--edu-primary-hover) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--edu-text) / <alpha-value>)',
          secondary: 'rgb(var(--edu-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--edu-text-muted) / <alpha-value>)',
          light: 'rgb(var(--edu-text-light) / <alpha-value>)',
        },
        danger: 'rgb(var(--edu-danger) / <alpha-value>)',
        success: 'rgb(var(--edu-success) / <alpha-value>)',
        warning: 'rgb(var(--edu-warning) / <alpha-value>)',
        border: 'rgb(var(--edu-border) / <alpha-value>)',
        background: 'rgb(var(--edu-background) / <alpha-value>)',
        card: 'rgb(var(--edu-card) / <alpha-value>)',
      },
      backgroundColor: {
        white: 'rgb(var(--edu-card) / <alpha-value>)',
        paper: '#fff',
      },
      textColor: {
        primary: 'rgb(var(--edu-link) / <alpha-value>)',
        'primary-hover': 'rgb(var(--edu-link-hover) / <alpha-value>)',
      },
      borderColor: { primary: 'rgb(var(--edu-focus) / <alpha-value>)' },
      outlineColor: { primary: 'rgb(var(--edu-focus) / <alpha-value>)' },
      ringColor: { primary: 'rgb(var(--edu-focus) / <alpha-value>)' },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: 'var(--edu-shadow-card)',
        soft: 'var(--edu-shadow-soft)',
      },
    },
  },
  plugins: [],
};
