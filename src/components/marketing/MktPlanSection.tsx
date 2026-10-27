'use client';
import { api, useApi } from '@/components/client';
import { Field, cx, inputCls, toast } from '@/components/ui';

const KIND: Record<string, string> = { feed: '피드', blog: '블로그', reels: '릴스', video: '생성 영상', shorts: '쇼츠', story: '스토리', photo: '사진 게시물' };
type Plan = { label: string; price: number | null; weekly: Record<string, number>; monthlyCredits: number; videoMonthly: number; regenMonthly: number };
type Data = { planCode: string | null; overrides: { monthlyCredits: number | null; weeklyCredits: number | null; videoMonthly: number | null; regenMonthly: number | null };
  plans: Record<string, Plan>; used: { monthCredits: number; monthVideos: number; monthRegens: number }; canEdit: boolean };

/**
 * 대표 10/27 ⑤ '요금제는 한곳에 모아 달라 — 자동 제작실은 제작하는 곳으로만': 마케팅 제작 요금제(월 제작 크레딧·주간 제작 수)를 사용량·요금제 화면에서 고르고 고친다.
 * 요금제마다 '이번 달 n 크레딧 남음 / 초과'를 같은 꼴로(예전엔 고른 요금제가 모자랄 때만 '모두 썼습니다'가 떠서 요금제마다 문구가 달랐음). 마케팅 공간이 없으면 안 보임
 */
export function MktPlanSection() {
  const { data, error, reload } = useApi<Data>('/api/marketing/plan');
  if (error || !data) return null;
  const used = Math.round(data.used.monthCredits * 10) / 10;
  async function save(patch: Record<string, unknown>) { try { await api('/api/marketing/auto', { method: 'PUT', body: patch }); toast.ok('저장했습니다'); reload(); } catch (e: any) { toast.error(e.message); } }
  async function pick(code: string, p: Plan) {
    const off = data!.planCode === code;
    if (!confirm(off ? `마케팅 요금제 '${p.label}'을(를) 해제할까요? 월 크레딧은 아래에 직접 적은 값만 남습니다.` : `마케팅 요금제를 '${p.label}'(으)로 바꿀까요? 이번 달 남은 제작 크레딧이 이 요금제 기준으로 바뀝니다.`)) return;
    await save({ planCode: off ? null : code });
  }
  const num = (v: string) => (v === '' ? null : Number(v));
  return (
    <section id="mkt-plan" className="scroll-mt-20 rounded-card border border-line bg-white p-4 shadow-card" data-testid="mkt-plan">
      <h2 className="text-sm font-semibold">마케팅 제작 요금제</h2>
      <p className="mt-0.5 text-xs text-ink-2">자동 제작실이 쓰는 월 제작 크레딧·주간 제작 수입니다. 이번 달 쓴 크레딧 <b className="tabular-nums text-ink" data-testid="mkt-plan-used">{used}</b> · 요금제마다 남는 양을 같이 보여 드립니다.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">{Object.entries(data.plans).map(([k, p]) => {
        const cur = data.planCode === k;
        const limit = cur && data.overrides.monthlyCredits !== null ? data.overrides.monthlyCredits : p.monthlyCredits;
        const left = Math.round((limit - used) * 10) / 10;
        return (
          <button key={k} type="button" disabled={!data.canEdit} onClick={() => pick(k, p)} aria-pressed={cur} data-testid={`auto-plan-${k}`}
            className={cx('rounded-input border p-3 text-left text-xs disabled:cursor-default', cur ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-line hover:bg-slate-50')}>
            <div className="text-sm font-semibold">{p.label}{cur && <span className="ml-1.5 rounded-full bg-brand-600 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-white">지금 요금제</span>}
              <span className="ml-1 font-normal text-ink-3">· 가격 {p.price ? `${Number(p.price).toLocaleString('ko-KR')}원/월` : '결정 전'}</span></div>
            <div className="mt-1 text-ink-2">주간 {Object.entries(p.weekly).map(([kk, n]) => `${KIND[kk] ?? kk} ${n}`).join(' · ')}</div>
            <div className="text-ink-2">월 크레딧 {limit} · 생성 영상 {p.videoMonthly}편 · 재생성 {p.regenMonthly}회</div>
            <div className={cx('mt-1 font-semibold tabular-nums', left < 0 ? 'text-red-700' : 'text-emerald-700')} data-testid={`auto-plan-left-${k}`}>이번 달 {left < 0 ? `${-left} 크레딧 초과` : `${left} 크레딧 남음`}</div>
          </button>);
      })}</div>
      {data.canEdit && <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <Field label="월 크레딧(비우면 요금제)"><input className={inputCls} type="number" defaultValue={data.overrides.monthlyCredits ?? ''} onBlur={(e) => save({ monthlyCredits: num(e.target.value) })} data-testid="mkt-plan-monthly" /></Field>
        <Field label="주 크레딧(비우면 월÷4.3)"><input className={inputCls} type="number" defaultValue={data.overrides.weeklyCredits ?? ''} onBlur={(e) => save({ weeklyCredits: num(e.target.value) })} /></Field>
        <Field label="월 생성 영상"><input className={inputCls} type="number" defaultValue={data.overrides.videoMonthly ?? ''} onBlur={(e) => save({ videoMonthly: num(e.target.value) })} /></Field>
        <Field label="월 재생성"><input className={inputCls} type="number" defaultValue={data.overrides.regenMonthly ?? ''} onBlur={(e) => save({ regenMonthly: num(e.target.value) })} /></Field>
      </div>}
    </section>
  );
}
