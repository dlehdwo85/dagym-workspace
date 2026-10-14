'use client';
/**
 * V20 이월 표시: 끝나지 않은 업무 중 마감일(없으면 만든 날)이 이번 달 이전이면 "이월 · 9월부터", 2개월 이상이면 "이월 2개월".
 * 데이터를 옮기지 않고 화면에서 계산(서울 기준 달). 지연(마감 지남) 빨간 표시는 따로 그대로 — 이 표시는 회색.
 */
const ymOf = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(typeof d === 'string' ? new Date(d.length === 10 ? d + 'T12:00:00+09:00' : d) : d);
export function carriedMonths(t: { status: string; due_date?: string | null; created_at?: string | null }, now = new Date()): { months: number; from: number } | null {
  if (t.status === 'done') return null;
  const base = t.due_date || t.created_at;
  if (!base) return null;
  const [by, bm] = ymOf(base).split('-').map(Number), [ny, nm] = ymOf(now).split('-').map(Number);
  const months = (ny * 12 + nm) - (by * 12 + bm);
  return months >= 1 ? { months, from: bm } : null;
}
export function CarriedBadge({ t }: { t: { status: string; due_date?: string | null; created_at?: string | null } }) {
  const c = carriedMonths(t);
  if (!c) return null;
  return <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-medium text-ink-2" title="지난달부터 이어진 업무" data-testid="carried">{c.months >= 2 ? `이월 ${c.months}개월` : `이월 · ${c.from}월부터`}</span>;
}
