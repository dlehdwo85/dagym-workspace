import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#1f3a5f', 50: '#f2f6fb', 100: '#e1e9f4', 500: '#2d5487', 600: '#1f3a5f', 700: '#172c49' },
      },
      fontFamily: { sans: ['Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
