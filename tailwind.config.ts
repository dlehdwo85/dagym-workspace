import type { Config } from 'tailwindcss';
/** 디자인 시스템 토큰 — docs/DESIGN_SYSTEM.md. 색은 CSS 변수(globals.css)로 두어 다크 모드와 공유 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // V14 31번(D안): 로고 청록. 600 = 기본(#0F766E)
        // 로컬 10/19(대표): 공간마다 강조색(업무 청록·영업 파랑·마케팅 보라) — globals.css :root[data-space] 변수, 기본은 청록
        brand: { DEFAULT: 'rgb(var(--brand-600) / <alpha-value>)', 50: 'rgb(var(--brand-50) / <alpha-value>)', 100: 'rgb(var(--brand-100) / <alpha-value>)', 200: 'rgb(var(--brand-200) / <alpha-value>)', 300: 'rgb(var(--brand-300) / <alpha-value>)', 400: 'rgb(var(--brand-400) / <alpha-value>)', 500: 'rgb(var(--brand-500) / <alpha-value>)', 600: 'rgb(var(--brand-600) / <alpha-value>)', 700: 'rgb(var(--brand-700) / <alpha-value>)', 800: 'rgb(var(--brand-800) / <alpha-value>)', 900: 'rgb(var(--brand-900) / <alpha-value>)' },
        accent: { DEFAULT: '#0D9488', 50: '#F0FDFA', 100: '#CCFBF1', 500: '#14B8A6', 600: '#0D9488', 700: '#0F766E' },
        warm: { DEFAULT: '#F59E0B', 50: '#FFFBEB', 500: '#F59E0B', 600: '#D97706' }, // 보조 강조(소량)
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
