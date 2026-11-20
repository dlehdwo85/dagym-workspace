'use client';
// 점검 리포트(숫자·표) — docs/check-feature-design.md 12절. 곳·분야·항목별 양호율 · 반복 항목 · 보완 처리 기간. AI 요약은 대표 결정 뒤(여기에는 없음)
import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useApi } from '@/components/client';
import { useMultiSite, useSession, useTerms } from '@/components/session';
import { ErrorBox, Skeleton, cx, inputCls } from '@/components/ui';

type Tally = { ok: number; fix: number; na: number; rate: number | null };
type Report = {
  period: { from: string; to: string; days: number; prevFrom: string; prevTo: string };
  summary: Tally & { rounds: number; roundsByKind: { regular: number; sample: number; adhoc: number }; openRounds: number; prevRate: number | null; followups: number; followupsOpen: number; avgDays: number | null; improvementsOpen: number };
  byUnit: (Tally & { id: string; name: string; rounds: number; followupsOpen: number; avgDays: number | null })[];
  byCategory: (Tally & { id: string | null; name: string })[];
  byItem: (Tally & { itemId: string; title: string })[];
  repeats: { itemId: string; title: string; unitId: string; unitName: string; fix: number; streak: number; improvement: boolean }[];
  followups: { total: number; closed: number; waiting: number; requested: number; canceled: number; avgDays: number | null; maxDays: number | null; buckets: { d0: number; d1_3: number; d4_7: number; d8: number }; overdue: number; again: number };
};
const box = 'rounded-card border border-line bg-white shadow-card';
const seoul = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const shift = (ymd: string, n: number) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const rateText = (r: number | null) => (r === null ? '—' : `${r}%`);
const daysText = (d: number | null) => (d === null ? '—' : d === 0 ? '당일' : `${d}일`);
const tone = (r: number | null) => (r === null ? 'text-ink-3' : r >= 90 ? 'text-green-700' : r >= 70 ? 'text-amber-700' : 'text-red-700');

/** 기간 고르기: 이번 달 · 지난달 · 최근 90일 · 직접 */
function ranges(today: string) {
  const first = `${today.slice(0, 7)}-01`; const lastPrev = shift(first, -1);
  return { month: [first, today], prev: [`${lastPrev.slice(0, 7)}-01`, lastPrev], d90: [shift(today, -89), today] } as Record<string, [string, string]>;
}

export function CheckReport() {
  const sess = useSession(); const multi = useMultiSite(); const terms = useTerms();
  const today = useMemo(() => seoul(new Date()), []);
  const R = useMemo(() => ranges(today), [today]);
  const [preset, setPreset] = useState<'month' | 'prev' | 'd90' | 'custom'>('month');
  const [from, setFrom] = useState(R.month[0]); const [to, setTo] = useState(R.month[1]);
  const [unit, setUnit] = useState('');
  const units = sess.dir.orgUnits.filter((o) => o.active);
  const qs = new URLSearchParams({ from, to }); if (unit) qs.set('unitId', unit);
  const ok = from && to && from <= to;
  const st = useApi<Report>(ok ? `/api/check/report?${qs}` : null, [from, to, unit]);
  const pick = (k: 'month' | 'prev' | 'd90') => { setPreset(k); setFrom(R[k][0]); setTo(R[k][1]); };
  const d = st.data;
  return (
    <div className="space-y-3 text-sm" data-testid="check-report">
      <section className={cx(box, 'p-3')}>
        <div className="flex flex-wrap items-center gap-1.5">
          {([['month', '이번 달'], ['prev', '지난달'], ['d90', '최근 90일']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => pick(k)} aria-pressed={preset === k} data-testid={`check-report-${k}`}
              className={cx('h-9 rounded-full border px-3 font-medium', preset === k ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line text-ink-2 hover:bg-slate-50')}>{l}</button>
          ))}
          <a href={ok ? `/api/check/report/export?${qs}` : undefined} download className={cx('ml-auto inline-flex h-9 items-center gap-1 rounded-input border border-line px-3 font-medium text-ink-2 hover:bg-slate-50', !ok && 'pointer-events-none opacity-50')} data-testid="check-report-export"><Download className="size-4" />엑셀</a>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[auto_auto_1fr]">
          <label className="flex items-center gap-1.5 text-xs text-ink-2">시작<input type="date" className={cx(inputCls, 'h-9')} value={from} max={to} onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }} data-testid="check-report-from" /></label>
          <label className="flex items-center gap-1.5 text-xs text-ink-2">끝<input type="date" className={cx(inputCls, 'h-9')} value={to} min={from} max={today} onChange={(e) => { setPreset('custom'); setTo(e.target.value); }} data-testid="check-report-to" /></label>
          {multi && units.length > 1 && (
            <select className={cx(inputCls, 'col-span-2 h-9 sm:col-span-1')} value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={terms.unit.branch} data-testid="check-report-unit">
              <option value="">{`모든 ${terms.unit.branch}`}</option>{units.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>)}
        </div>
      </section>
      {st.error ? <ErrorBox error={st.error} retry={st.reload} /> : !d ? <Skeleton rows={6} /> : (
        <>
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="check-report-summary">
            <Stat label="끝낸 점검" value={`${d.summary.rounds}회`} sub={d.summary.openRounds > 0 ? `진행 중 ${d.summary.openRounds}회는 빼고 셈` : `정기 ${d.summary.roundsByKind.regular + d.summary.roundsByKind.sample} · 수시 ${d.summary.roundsByKind.adhoc}`} testid="check-report-rounds" />
            <Stat label="양호율" value={rateText(d.summary.rate)} valueCls={tone(d.summary.rate)} sub={d.summary.prevRate === null ? `양호 ${d.summary.ok} · 보완 필요 ${d.summary.fix}` : `지난 기간 ${rateText(d.summary.prevRate)} · 양호 ${d.summary.ok} · 보완 ${d.summary.fix}`} testid="check-report-rate" />
            <Stat label="보완 요청" value={`${d.summary.followups}건`} sub={`열린 것 ${d.summary.followupsOpen}건`} testid="check-report-followups" />
            <Stat label="평균 처리 기간" value={daysText(d.summary.avgDays)} sub={d.summary.improvementsOpen > 0 ? `열린 개선 과제 ${d.summary.improvementsOpen}건` : '요청 → 양호 확인'} testid="check-report-avg" />
          </section>
          {!d.summary.rounds && !d.summary.followups ? (
            <p className={cx(box, 'p-4 text-center text-ink-3')} data-testid="check-report-empty">이 기간에 끝낸 점검이 없습니다 — 기간을 넓혀 보세요.</p>
          ) : (
            <>
              <Table title={`${terms.unit.branch}별`} testid="check-report-units" head={['', '점검', '양호율', '보완\n필요', '열린\n보완']}
                rows={d.byUnit.map((x) => [x.name, `${x.rounds}회`, <b key="r" className={tone(x.rate)}>{rateText(x.rate)}</b>, x.fix, x.followupsOpen])} />
              <Table title="분야별" testid="check-report-cats" head={['', '양호율', '양호', '보완\n필요', '해당\n없음']}
                rows={d.byCategory.map((x) => [x.name, <b key="r" className={tone(x.rate)}>{rateText(x.rate)}</b>, x.ok, x.fix, x.na])} />
              <Table title="보완이 잦은 항목" note="보완 필요가 많은 순 — 위에서 10개" testid="check-report-items" head={['', '양호율', '양호', '보완\n필요']}
                rows={d.byItem.filter((x) => x.fix > 0).slice(0, 10).map((x) => [x.title, <b key="r" className={tone(x.rate)}>{rateText(x.rate)}</b>, x.ok, x.fix])} empty="이 기간에는 보완 필요로 적힌 항목이 없습니다." />
              <Table title="반복 항목" note="같은 곳에서 보완 필요가 2번 이상" testid="check-report-repeats" head={['', terms.unit.branch, '보완\n필요', '지금\n연속']}
                rows={d.repeats.map((x) => [<span key="t">{x.title}{x.improvement && <span className="ml-1.5 rounded-full bg-violet-50 px-1.5 text-[11px] font-medium text-violet-700">개선 과제</span>}</span>, x.unitName, `${x.fix}번`, x.streak > 0 ? `${x.streak}번` : '—'])}
                empty="같은 곳에서 되풀이된 항목이 없습니다." />
              <section className={box} data-testid="check-report-fu">
                <h2 className="border-b border-line px-3 py-2 font-semibold">보완 처리 기간 <span className="ml-1 text-xs font-normal text-ink-3">이 기간에 보낸 보완 요청 {d.followups.total}건</span></h2>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-3 sm:grid-cols-4">
                  {([['닫힘(양호 확인)', d.followups.closed], ['확인 대기', d.followups.waiting], ['조치 중', d.followups.requested], ['기한을 넘긴 것', d.followups.overdue], ['다시 보완(2차 이상)', d.followups.again],
                    ['평균', daysText(d.followups.avgDays)], ['가장 긴 것', daysText(d.followups.maxDays)]] as [string, string | number][]).map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-2 border-b border-dashed border-line pb-1"><dt className="text-ink-2">{k}</dt><dd className="font-semibold tabular-nums">{v}{typeof v === 'number' ? '건' : ''}</dd></div>))}
                </dl>
                {d.followups.closed > 0 && (
                  <p className="border-t border-line px-3 py-2 text-xs text-ink-2" data-testid="check-report-buckets">닫히기까지: 당일 {d.followups.buckets.d0} · 1~3일 {d.followups.buckets.d1_3} · 4~7일 {d.followups.buckets.d4_7} · 8일 이상 {d.followups.buckets.d8}</p>)}
              </section>
            </>
          )}
          <p className="px-1 text-xs leading-relaxed text-ink-3" data-testid="check-report-rules">
            셈 규칙: {d.period.from} ~ {d.period.to}에 <b>끝낸</b> 점검을 셉니다. 양호율 = 양호 ÷ (양호 + 보완 필요)이고 &lsquo;해당 없음&rsquo;은 뺍니다. 처리 기간은 보완 요청을 보낸 날부터 [양호 확인]으로 닫힌 날까지입니다. 사람별 순위는 만들지 않습니다.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, valueCls, testid }: { label: string; value: string; sub?: string; valueCls?: string; testid: string }) {
  return (
    <div className={cx(box, 'p-3')} data-testid={testid}>
      <div className="text-xs text-ink-2">{label}</div>
      <div className={cx('mt-0.5 text-xl font-bold tabular-nums', valueCls)}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

/** 좁은 화면에서도 넘치지 않게: 첫 칸(이름)은 줄바꿈, 숫자 칸은 좁게 */
function Table({ title, note, head, rows, empty, testid }: { title: string; note?: string; head: string[]; rows: React.ReactNode[][]; empty?: string; testid: string }) {
  return (
    <section className={box} data-testid={testid}>
      <h2 className="border-b border-line px-3 py-2 font-semibold">{title}{note && <span className="ml-1.5 text-xs font-normal text-ink-3">{note}</span>}</h2>
      {!rows.length ? <p className="p-3 text-ink-3">{empty ?? '기록이 없습니다.'}</p> : (
        <table className="w-full table-fixed text-left">
          <thead><tr className="text-xs text-ink-3">{head.map((h, i) => <th key={i} className={cx('whitespace-pre-line px-2 py-1.5 align-bottom font-medium leading-tight first:pl-3 last:pr-3 sm:whitespace-normal', i === 0 ? 'w-[40%]' : 'text-right')}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, k) => <tr key={k} data-testid={`${testid}-row`}>{r.map((c, i) => <td key={i} className={cx('px-2 py-2 align-top first:pl-3 last:pr-3', i === 0 ? 'break-words font-medium' : 'text-right tabular-nums')}>{c}</td>)}</tr>)}
          </tbody>
        </table>
      )}
    </section>
  );
}
