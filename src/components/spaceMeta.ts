/** V41 공간별 이름·강조색(시안: 업무 청록 · 영업 파랑 · 마케팅 보라). 나머지 디자인은 워크인 그대로 */
export const SPACE_META = {
  work: { label: '워크인 · 업무', short: '업무', color: '#0F766E', soft: '#F0FDFA', border: '#99F6E4', bg: '', home: '/' },
  sales: { label: '워크인 · 영업', short: '영업', color: '#2563EB', soft: '#EFF6FF', border: '#BFDBFE', bg: '#F5F8FF', home: '/s/sales' },
  marketing: { label: '워크인 · 마케팅', short: '마케팅', color: '#7C3AED', soft: '#F5F3FF', border: '#DDD6FE', bg: '#F8F6FF', home: '/s/marketing' },
} as const;
export type SpaceKey = keyof typeof SPACE_META;
export const spaceOfPath = (p: string): SpaceKey => (p.startsWith('/s/sales') ? 'sales' : p.startsWith('/s/marketing') ? 'marketing' : 'work');
