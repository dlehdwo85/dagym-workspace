'use client';
import { aiName } from '@/lib/aiNames';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useSession } from '@/components/session';
import { cx } from '@/components/ui';

/**
 * 대표 10/20 오후 5): 'AI에게 요청' 진입점을 영업·마케팅 공간에도 — 업무 공간(홈 입력줄·업무 상세 메뉴)과 같은 자리(목록 상단·상세 맨 위).
 * 공간 맞춤 예시 문구를 칩으로 보여 주고, 보내면 AI 비서(/assistant?space=…&q=…)가 그 공간 맥락으로 답한다. 상세에서는 [거래처 ○○] 같은 머리말을 붙여 무엇에 대한 요청인지 알린다.
 */
export const AI_ASK_EXAMPLES = {
  salesLeads: ['이번 주 연락할 거래처 정리해 줘', '미팅 예정 리드 요약', '오래 연락 안 한 거래처 찾아 줘'],
  salesLead: ['이 거래처 다음 연락 문자 초안', '이 거래처 제안 포인트 3개', '이 거래처 미팅 준비 메모'],
  salesBids: ['마감 임박 공고 요약', '우리에 맞는 공고 골라 줘', '이번 주 입찰 일정 정리'],
  salesBid: ['이 공고 참가 자격 정리', '이 공고 제안서 목차 초안', '이 공고 질문할 것 뽑아 줘'],
  mktContents: ['승인 대기 시안 요약', '이번 주 게시 계획 점검', '다음 주 게시 주제 3개 제안'],
  mktContent: ['이 시안 수정안 3개', '이 시안 해시태그 추천', '이 시안을 스토리용으로 줄여 줘'],
} as const;

export function AiAsk({ space, examples, subject, compact, testId = 'ai-ask' }: { space: 'sales' | 'marketing'; examples: readonly string[]; /** 상세: 무엇에 대한 요청인지 머리말(예: 거래처 ○○) */ subject?: string | null; compact?: boolean; testId?: string }) {
  const { features } = useSession();
  const router = useRouter();
  const [q, setQ] = useState(''); const [open, setOpen] = useState(!compact);
  if (!features.ai) return null;
  const go = (text: string) => { const t = text.trim(); if (!t) return; router.push(`/assistant?space=${space}&q=${encodeURIComponent(subject ? `[${subject}] ${t}` : t)}`); };
  if (compact && !open) return <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-input border border-violet-200 bg-violet-50/60 px-2.5 py-1 text-xs font-medium text-violet-800 hover:bg-violet-100" data-testid={testId}><Sparkles className="size-3.5" aria-hidden />AI에게 요청</button>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); go(q); }} className={cx('rounded-card border border-violet-200 bg-white px-3 py-2 shadow-card', compact && 'w-full')} data-testid={testId}>
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-violet-600" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`✨ ${aiName(space)}에게 요청${subject ? ` — ${subject}` : ''}`} aria-label={`${aiName(space)}에게 요청`} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3" maxLength={2000} data-testid={`${testId}-input`} autoFocus={compact} />
        <button type="submit" className="shrink-0 rounded-input px-3 py-1 text-xs font-semibold text-white disabled:opacity-50" style={{ background: space === 'sales' ? '#1D4ED8' : '#7C3AED' }} disabled={!q.trim()} data-testid={`${testId}-send`}>요청</button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid={`${testId}-examples`}>
        {examples.map((x) => <button key={x} type="button" onClick={() => go(x)} className="rounded-full border border-line bg-slate-50 px-2 py-0.5 text-[11px] text-ink-2 hover:border-violet-300 hover:bg-violet-50">{x}</button>)}
      </div>
    </form>
  );
}
