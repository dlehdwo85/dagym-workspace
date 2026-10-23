'use client';
import { cx } from '@/components/ui';

/** #499-1 용도: 콘텐츠형(참여) / 광고형(전환) — 첫 줄·구성 안내와 훅 채점이 다르다(서버 mktQuality HookMode) */
export type Mode = 'content' | 'ad';
export const MODE_LABEL: Record<Mode, string> = { content: '콘텐츠형', ad: '광고형' };
export const MODE_HINT: Record<Mode, string> = {
  content: '참여(시청·저장·공유·댓글) — 질문·공감·이야기로 시작하고 판매 문구는 뒤로',
  ad: '전환(리드·문의) — 2초 안에 대상과 제안(무료 진단·가격 등), 끝은 신청·문의 1개',
};
export const asMode = (x: unknown): Mode => (x === 'ad' ? 'ad' : 'content');

export function ModeToggle({ value, onChange, testId = 'mode-toggle', disabled }: { value: Mode; onChange: (m: Mode) => void; testId?: string; disabled?: boolean }) {
  return (
    <span role="radiogroup" aria-label="용도" className="inline-flex shrink-0 rounded-full bg-slate-100 p-0.5 text-xs" data-testid={testId} data-mode={value}>
      {(['content', 'ad'] as Mode[]).map((m) => (
        <button key={m} type="button" role="radio" aria-checked={value === m} title={MODE_HINT[m]} disabled={disabled} onClick={() => value !== m && onChange(m)}
          className={cx('whitespace-nowrap rounded-full px-2.5 py-1', value === m ? 'bg-white font-semibold text-ink shadow-sm' : 'text-ink-2 hover:text-ink')} data-testid={`${testId}-${m}`}>{MODE_LABEL[m]}</button>
      ))}
    </span>
  );
}

/** 목록·카드: 광고형만 표시(콘텐츠형이 기본이라 칩을 달지 않음) */
export const ModeChip = ({ mode }: { mode?: string | null }) =>
  mode === 'ad' ? <span className="whitespace-nowrap rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800" title={MODE_HINT.ad} data-testid="mode-chip-ad">광고형</span> : null;
