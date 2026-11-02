'use client';
import { cx } from '@/components/ui';

// 335차(대표 11/02 16:5x #918): 공고에서 온 업무의 설명 위 고정 칸 — 세대수(아파트 공고만) · 입찰 마감 일시 · 현장설명회(일시·필수 여부·장소). 모르면 '확인 필요'
export type BidInfoView = { apt: boolean; households: number | null; deadline: string | null; deadlineLabel: string | null; briefing: { kind: string | null; at: string | null; place: string | null; required: boolean } | null; briefingNone: boolean };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** '2026-11-04T14:00' → '11/4(수) 14:00' */
export function bidWhen(iso?: string | null) {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/); if (!m) return null;
  const dow = DOW[new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`).getUTCDay()];
  return `${Number(m[2])}/${Number(m[3])}(${dow})${m[4] && !(m[4] === '23' && m[5] === '59') ? ` ${m[4]}:${m[5]}` : ''}`;
}
/** 목록 칩용 짧은 꼴 '11/4 14:00' */
export const bidShort = (iso: string) => { const m = iso.match(/^\d{4}-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/); return m ? `${Number(m[1])}/${Number(m[2])}${m[3] ? ` ${m[3]}:${m[4]}` : ''}` : iso; };

export function BidInfoBox({ info }: { info: BidInfoView }) {
  const b = info.briefing;
  const Cell = ({ label, children, testid, missing }: { label: string; children: React.ReactNode; testid: string; missing?: boolean }) => (
    <div className="min-w-0" data-testid={testid} data-missing={missing || undefined}>
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className={cx('text-sm font-semibold leading-snug', missing ? 'text-amber-700' : 'text-ink')}>{children}</div>
    </div>
  );
  return (
    <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-card border border-sky-200 bg-sky-50/60 px-3 py-2.5 sm:grid-cols-3" data-testid="bid-info" data-apt={info.apt ? '1' : undefined}
      title="공고에서 읽어 온 칸입니다. 공고가 정정되면 정기 실행이 따라 바꾸고 변경 이력에 남깁니다">
      {info.apt && <Cell label="세대수" testid="bid-info-households" missing={!info.households}>{info.households ? `${info.households.toLocaleString('ko-KR')}세대` : '확인 필요'}</Cell>}
      <Cell label="입찰 마감 일시" testid="bid-info-deadline" missing={!info.deadlineLabel}>{info.deadlineLabel ?? '확인 필요'}</Cell>
      <Cell label="현장설명회" testid="bid-info-briefing" missing={!info.briefingNone && !b}>
        {info.briefingNone ? '없음' : b ? (<>
          {bidWhen(b.at) ?? '일시 확인 필요'}
          {b.required ? <span className="ml-1 rounded bg-red-50 px-1 text-[11px] font-medium text-red-700">필수</span> : b.kind ? <span className="ml-1 rounded bg-slate-100 px-1 text-[11px] font-normal text-ink-2">{b.kind}</span> : null}
          {b.place && <span className="block text-xs font-normal text-ink-2">{b.place}</span>}
        </>) : '확인 필요'}
      </Cell>
    </div>
  );
}
