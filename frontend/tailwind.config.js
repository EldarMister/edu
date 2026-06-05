/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Палитра из ТЗ «Требование к дизайну».
        primary: {
          DEFAULT: '#005BFF',
          hover: '#0049CC',
        },
        text: {
          primary: '#0F172A',
          secondary: '#475569',
          muted: '#64748B',
          light: '#94A3B8',
        },
        danger: '#EF4444',
        success: '#16A34A',
        warning: '#F59E0B',
        border: '#E2E8F0',
        background: '#F8FAFC',
        card: '#FFFFFF',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
        soft: '0 4px 16px rgba(15, 23, 42, 0.08)',
      },
    },
  },
  plugins: [],
};
