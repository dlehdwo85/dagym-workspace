import type { Config } from 'tailwindcss';
/** 디자인 시스템 토큰 — docs/DESIGN_SYSTEM.md. 색은 CSS 변수(globals.css)로 두어 다크 모드와 공유 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // V14 31번(D안): 로고 청록. 600 = 기본(#0F766E)
        brand: { DEFAULT: '#0F766E', 50: '#F0FDFA', 100: '#CCFBF1', 200: '#99F6E4', 300: '#5EEAD4', 400: '#2DD4BF', 500: '#0D9488', 600: '#0F766E', 700: '#115E59', 800: '#134E4A', 900: '#134E4A' },
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
