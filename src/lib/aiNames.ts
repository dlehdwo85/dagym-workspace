/** 대표 10/21 12:20 결정: AI 명칭 통일 — 업무 = AI 비서 · 영업 = AI 세일즈 · 마케팅 = AI 마케터 (메뉴·카드·알림·문구 공통) */
export const AI_NAME = { work: 'AI 비서', sales: 'AI 세일즈', marketing: 'AI 마케터' } as const;
export type AiSpace = keyof typeof AI_NAME;
export const aiName = (space?: string | null): string => AI_NAME[(space ?? 'work') as AiSpace] ?? AI_NAME.work;
