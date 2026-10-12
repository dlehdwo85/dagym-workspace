import type { Config } from 'tailwindcss';
/** 디자인 시스템 토큰 — docs/DESIGN_SYSTEM.md. 색은 CSS 변수(globals.css)로 두어 다크 모드와 공유 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#1f3a5f', 50: '#f2f6fb', 100: '#e1e9f4', 200: '#c3d3e8', 500: '#2d5487', 600: '#1f3a5f', 700: '#172c49', 800: '#0f1f35' },
        accent: { DEFAULT: '#3b82f6', 50: '#eff6ff', 100: '#dbeafe', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' },
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        line: 'var(--line)',
        ink: { DEFAULT: 'var(--ink)', 2: 'var(--ink-2)', 3: 'var(--ink-3)' },
      },
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', '"Apple SD Gothic Neo"', '"Malgun Gothic"', 'sans-serif'],
      },
      fontSize: { '2xs': ['11px', '14px'], '13': ['13px', '18px'] },
      borderRadius: { card: '12px', input: '8px' },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,0.06)', pop: '0 8px 24px rgba(16,24,40,0.14)' },
      keyframes: {
        'slide-in': { from: { transform: 'translateX(16px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        'fade-up': { from: { transform: 'translateY(6px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: { 'slide-in': 'slide-in .18s ease-out', 'fade-up': 'fade-up .16s ease-out', shimmer: 'shimmer 1.3s linear infinite' },
    },
  },
  plugins: [],
} satisfies Config;
