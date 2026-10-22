'use client';
// #161 V25 매출 자료 자동 분석 — 매출 화면 맨 위: 확인 대기 자료(읽은 값 vs 지금 값) · 분석 대기열 · AI 분석 보고서(동향·전망·대안·확인 필요)
import { useEffect, useState } from 'react';
import { FileText, Sparkles } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, Card, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

/** 이번 달(강조) = 매출 차트 올해 색, 지난 달들(약하게) — validate_palette: 정상 시각 ΔE 15.8 · 색약 13.7 · 대비 3:1 이상 */
const C_ACCENT = '#2a78d6';
const C_MUTED = '#8792a2';
const won = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n).toLocaleString('ko-KR')}원`);
const short = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Math.abs(n) >= 1e8 ? `${(n / 1e8).toFixed(1).replace(/\.0$/, '')}억` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1e4).toLocaleString('ko-KR')}만` : n.toLocaleString('ko-KR'));
const mon = (p: string) => `${Number(p.slice(5))}월`;
const KIND: Record<string, string> = { auto: '자동 분석', manual: '직접 분석', deep: '종합 보고' };
const METRIC: Record<string, string> = { revenue: '매출', expense: '지출', members: '회원 수' };
const ITEMS = ['매출', '지출', '회원수', '목표'];

/** 증감: 방향 화살표 + 부호 없는 % (색만으로 구분하지 않게) */
function Delta({ v, what }: { v: number | null | undefined; what: string }) {
  if (v === null || v === undefined) return <span className="text-ink-3">—</span>;
  const label = v === 0 ? `${what} 변화 없음` : `${what} ${Math.abs(v)}% ${v > 0 ? '증가' : '감소'}`;
  return <span className={cx('whitespace-nowrap', v > 0 ? 'text-emerald-700' : v < 0 ? 'text-red-700' : 'text-ink-2')} aria-label={label} title={label}>{v === 0 ? '± 0%' : `${v > 0 ? '▲' : '▼'} ${Math.abs(v)}%`}</span>;
}

/** 최근 12개월 매출 선(약하게) + 이번 달 점(강조). 값은 표·title 에도 있음 */
function Spark({ series, label }: { series: { month: string; revenue: number | null }[]; label: string }) {
  const W = 96, H = 26, P = 4;
  const vals = series.map((s) => s.revenue);
  const nums = vals.filter((x): x is number => x !== null);
  if (nums.length < 2) return <span className="text-[11px] text-ink-3">—</span>;
  const max = Math.max(...nums), min = Math.min(...nums), span = max - min || 1;
  const x = (i: number) => P + (i * (W - 2 * P)) / (series.length - 1);
  const y = (v: number) => H - P - ((v - min) / span) * (H - 2 * P);
  let d = '', pen = false;
  vals.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
  const last = vals.length - 1, lv = vals[last];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} 최근 12개월 매출 추이`} className="block shrink-0">
      <title>{series.map((s) => `${mon(s.month)} ${s.revenue === null ? '자료 없음' : won(s.revenue)}`).join(' · ')}</title>
      <path d={d} fill="none" stroke={C_MUTED} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {lv !== null && <circle cx={x(last)} cy={y(lv)} r={4} fill={C_ACCENT} stroke="#fff" strokeWidth={2} />}
    </svg>
  );
}

type Line = { site: string; month: string; item: string; amount: number; current: number | null; state: 'new' | 'same' | 'changed' | 'error'; error?: string };
const STATE: Record<string, [string, string]> = { new: ['새 값', 'bg-sky-50 text-sky-800'], same: ['같음', 'bg-slate-100 text-ink-2'], changed: ['바뀜', 'bg-amber-100 text-amber-900'], error: ['확인', 'bg-red-50 text-red-700'] };
const DETECT: Record<string, string> = { folder: '매출 폴더', name: '파일 이름', content: '본문 내용' };

/** 확인 대기 1건: 읽은 표(고치기·빼기) → [확정] = 실적 반영 + 같은 달 10분 모아 분석 / [무시] */
function ImportCard({ imp, sites, canEdit, onDone }: { imp: any; sites: string[]; canEdit: boolean; onDone: () => void }) {
  const [lines, setLines] = useState<Line[]>(imp.lines ?? []);
  const [errs, setErrs] = useState<{ line: number; message: string }[]>([]);
  const [busy, setBusy] = useState('');
  const serverKey = JSON.stringify(imp.lines ?? []); // 다른 카드 처리로 목록을 다시 불러와도, 이 자료의 서버 값이 그대로면 고치던 칸을 지우지 않는다
  useEffect(() => { setLines(JSON.parse(serverKey)); setErrs([]); }, [imp.id, serverKey]);
  const stateOf = (l: Line): Line['state'] => (l.state === 'error' ? 'error' : l.current === null ? 'new' : l.current === l.amount ? 'same' : 'changed');
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch, ...(patch.site || patch.month || patch.item ? { state: 'new' as const, current: null, error: undefined } : {}) } : l)));
  async function act(action: 'confirm' | 'dismiss') {
    setBusy(action);
    try {
      const r = await api(`/api/revenue/auto/imports/${imp.id}`, { body: action === 'confirm' ? { action, rows: lines.map(({ site, month, item, amount }) => ({ site, month, item, amount })) } : { action } });
      if (action === 'confirm' && !r.ok) { setErrs(r.errors ?? []); toast.error(`고칠 곳 ${r.errors?.length ?? 0}건 — 아무것도 저장되지 않았습니다`); return; }
      toast.ok(action === 'confirm' ? `${r.count}건을 실적에 반영했습니다 — ${mon(r.period)} 분석은 같은 달 자료를 10분 모아 한 번 합니다` : '이 자료는 실적에 반영하지 않습니다');
      onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  const changed = lines.filter((l) => stateOf(l) === 'changed').length;
  return (
    <div className="rounded-card border border-amber-300 bg-amber-50/40 p-3" data-testid="revenue-import" data-file={imp.file_name}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold"><span className="mr-1.5 rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold text-white">확인 대기</span>
          새 매출 자료 — 숫자 확인: {imp.file_ok && imp.file_id ? <a className="text-accent-600 underline" href={`/library?file=${imp.file_id}`}>{imp.file_name}</a> : imp.file_name}</p>
        <span className="text-[11px] text-ink-3">{imp.created_by_name ?? ''} 올림 · {fmtDateTime(imp.created_at)} · 찾은 곳: {DETECT[imp.detected_by] ?? imp.detected_by}</span>
      </div>
      <p className="mt-1 text-xs text-ink-2">AI 가 읽은 숫자 {lines.length}개{changed ? ` — 지금 실적과 다른 칸 ${changed}개(노란 줄)` : ''}. 확정해야 실적에 반영되고 분석(동향·전망·대안)이 시작됩니다.</p>
      {imp.notes && <p className="mt-1 rounded-input bg-amber-100/70 p-2 text-xs text-amber-900">AI 메모: {imp.notes}</p>}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="text-left text-xs text-ink-3"><th className="py-1 font-medium">현장</th><th className="font-medium">월</th><th className="font-medium">항목</th><th className="text-right font-medium">읽은 값</th><th className="text-right font-medium">지금 값</th><th className="pl-2 font-medium">비교</th><th /></tr></thead>
          <tbody className="divide-y divide-line">{lines.map((l, i) => {
            const st = stateOf(l);
            return (
              <tr key={i} className={cx(st === 'changed' && 'bg-amber-100/60', st === 'error' && 'bg-red-50')} data-state={st}>
                <td className="py-1 pr-1">{canEdit ? <select className={cx(inputCls, 'h-8 py-0')} value={l.site} onChange={(e) => set(i, { site: e.target.value })} aria-label={`${i + 1}번째 현장`}>
                  {!sites.includes(l.site) && <option value={l.site}>{l.site} (없는 현장)</option>}{sites.map((s) => <option key={s}>{s}</option>)}</select> : l.site}</td>
                <td className="pr-1">{canEdit ? <input type="month" className={cx(inputCls, 'h-8 py-0')} value={l.month} onChange={(e) => set(i, { month: e.target.value })} aria-label={`${i + 1}번째 월`} /> : l.month}</td>
                <td className="pr-1">{canEdit ? <select className={cx(inputCls, 'h-8 py-0')} value={l.item} onChange={(e) => set(i, { item: e.target.value })} aria-label={`${i + 1}번째 항목`}>
                  {!ITEMS.includes(l.item) && <option value={l.item}>{l.item}</option>}{ITEMS.map((t) => <option key={t}>{t}</option>)}</select> : l.item}</td>
                <td className="pr-1 text-right tabular-nums">{canEdit ? <input inputMode="numeric" className={cx(inputCls, 'h-8 py-0 text-right tabular-nums', st === 'changed' && 'border-amber-500 bg-amber-50 font-semibold')} value={l.amount.toLocaleString('ko-KR')}
                  onChange={(e) => set(i, { amount: Number(e.target.value.replace(/[^\d]/g, '')) || 0 })} aria-label={`${i + 1}번째 읽은 값`} /> : l.amount.toLocaleString('ko-KR')}</td>
                <td className="text-right tabular-nums text-ink-2">{l.current === null ? '—' : l.current.toLocaleString('ko-KR')}</td>
                <td className="pl-2"><span className={cx('rounded px-1.5 py-0.5 text-[11px] font-medium', STATE[st][1])} title={l.error}>{STATE[st][0]}</span>{l.error && <span className="ml-1 text-[11px] text-red-700">{l.error}</span>}</td>
                <td>{canEdit && <button className="px-1 text-xs text-red-600" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`${i + 1}번째 빼기`}>빼기</button>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {!!errs.length && <ul className="mt-1 list-disc pl-5 text-xs text-red-700">{errs.slice(0, 10).map((e, k) => <li key={k}>{e.line}번째 줄: {e.message}</li>)}</ul>}
      {canEdit ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => act('confirm')} disabled={!!busy || !lines.length} data-testid="revenue-import-confirm">{busy === 'confirm' ? '반영 중…' : '확정'}</Button>
          <Button size="sm" variant="secondary" onClick={() => act('dismiss')} disabled={!!busy} data-testid="revenue-import-dismiss">무시</Button>
        </div>
      ) : <p className="mt-2 text-xs text-ink-3">확정은 매출 입력 권한이 있는 사람이 합니다.</p>}
    </div>
  );
}

export function RevenueAuto({ period, aiEnabled, canEdit, sites, onFocus, onApplied }: {
  period: string; aiEnabled: boolean; canEdit: boolean; sites: string[]; onFocus: (site: string, month: string) => void; onApplied: () => void;
}) {
  const ov = useApi<{ imports: any[]; queue: any[]; reports: any[]; canEdit: boolean; auto: boolean; batchMinutes: number }>('/api/revenue/auto');
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { const q = new URLSearchParams(window.location.search).get('report'); if (q) setSel(q); }, []); // 알림 링크 ?report=
  const reports = ov.data?.reports ?? [];
  const id = sel ?? reports[0]?.id ?? null;
  const rep = useApi<{ report: any }>(id ? `/api/revenue/ai?id=${id}` : null, [id]);
  useEffect(() => { if (rep.error && sel) setSel(null); }, [rep.error, sel]); // 알림 링크의 보고서를 못 찾으면 최신 보고서로
  const [busy, setBusy] = useState('');
  const refresh = () => { ov.reload(); onApplied(); };
  async function run(kind: 'manual' | 'deep' | 'now', p = period) {
    setBusy(kind);
    try {
      const r = kind === 'now' ? await api('/api/revenue/auto/analyze', { body: { period: p } }) : await api('/api/revenue/ai', { body: { period: p, deep: kind === 'deep' } });
      setSel(r.report.id); ov.reload();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  async function retry(imp: any, action: 'retry' | 'dismiss') {
    setBusy(imp.id);
    try {
      const r = await api(`/api/revenue/auto/imports/${imp.id}`, { body: { action } });
      toast.ok(action === 'dismiss' ? '이 자료는 반영하지 않습니다' : r.status === 'pending' ? '다시 읽었습니다 — 숫자를 확인하세요' : `다시 읽지 못했습니다${r.error ? `: ${r.error}` : ''}`);
      ov.reload();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  const imps = ov.data?.imports ?? [];
  const pending = imps.filter((x) => x.status === 'pending');
  const reading = imps.filter((x) => x.status === 'queued' || x.status === 'extracting');
  const failed = imps.filter((x) => x.status === 'failed' || x.status === 'empty');
  const done = imps.filter((x) => x.status === 'confirmed' || x.status === 'dismissed');
  const r = rep.data?.report;
  const st = r?.stats, out = r?.output;
  return (
    <div className="space-y-3" id="imports">
      {(pending.length > 0 || reading.length > 0 || failed.length > 0) && (
        <Card className="space-y-2 p-4" data-testid="revenue-imports">
          <h2 className="text-sm font-semibold">새 매출 자료 {pending.length + reading.length + failed.length}건</h2>
          {pending.map((imp) => <ImportCard key={imp.id} imp={imp} sites={sites} canEdit={canEdit} onDone={refresh} />)}
          {reading.map((imp) => <p key={imp.id} className="text-sm text-ink-2" data-testid="revenue-import-reading">「{imp.file_name}」 숫자를 읽는 중…{imp.error ? ` (다시 시도 예정: ${imp.error})` : ''}</p>)}
          {failed.map((imp) => (
            <div key={imp.id} className="flex flex-wrap items-center gap-2 rounded-input bg-red-50 p-2 text-sm" data-testid="revenue-import-failed">
              <span className="min-w-0 flex-1">「{imp.file_name}」 {imp.status === 'empty' ? '자료에서 현장별 월 실적을 찾지 못했습니다' : `읽지 못했습니다: ${imp.error ?? ''}`}</span>
              {canEdit && <><Button size="sm" variant="secondary" disabled={busy === imp.id} onClick={() => retry(imp, 'retry')}>다시 읽기</Button><Button size="sm" variant="secondary" disabled={busy === imp.id} onClick={() => retry(imp, 'dismiss')}>무시</Button></>}
            </div>
          ))}
        </Card>
      )}
      {(ov.data?.queue ?? []).map((q) => (
        <div key={q.period} className="flex flex-wrap items-center gap-2 rounded-input border border-sky-200 bg-sky-50 p-3 text-sm" data-testid="revenue-queue">
          <span className="min-w-0 flex-1">{q.error ? <>{mon(q.period)} 분석 실패 — {q.error}. 30분 뒤 다시 하거나 지금 해 보세요.</>
            : <>{mon(q.period)} 분석 대기 — 확정한 자료 {q.imports}건을 모아 {fmtDateTime(q.run_after)}에 한 번 분석합니다(같은 달은 {ov.data?.batchMinutes ?? 10}분 모아 1번).</>}</span>
          {aiEnabled && <Button size="sm" variant="secondary" onClick={() => run('now', q.period)} disabled={!!busy} data-testid="revenue-analyze-now">{busy === 'now' ? '분석 중…' : '지금 분석'}</Button>}
        </div>
      ))}

      {(aiEnabled || reports.length > 0) && (
        <Card className="p-4" data-testid="revenue-ai">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-violet-500" />AI 분석 보고서{r ? ` · ${r.period.slice(0, 4)}년 ${mon(r.period)}` : ''}
              {r && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-2" data-testid="revenue-report-kind">{KIND[r.kind] ?? r.kind}</span>}</h2>
            <div className="flex flex-wrap items-center gap-2">
              {reports.length > 1 && (
                <select className="h-8 max-w-[15rem] rounded-input border border-line bg-white px-2 text-xs" value={id ?? ''} onChange={(e) => setSel(e.target.value)} aria-label="보고서 이력" data-testid="revenue-report-history">
                  {reports.map((x) => <option key={x.id} value={x.id}>{x.period} · {KIND[x.kind] ?? x.kind} · {fmtDateTime(x.created_at)}</option>)}
                </select>
              )}
              {aiEnabled && <>
                <Button size="sm" variant="secondary" onClick={() => run('manual')} disabled={!!busy}>{busy === 'manual' ? '분석 중…' : `AI 분석 · ${mon(period)}`}</Button>
                <Button size="sm" variant="secondary" onClick={() => run('deep')} disabled={!!busy} title="월 마감 종합 보고 — 더 깊은 모델(시간·비용 더 듦)">{busy === 'deep' ? '작성 중…' : '종합 보고'}</Button>
              </>}
            </div>
          </div>
          {!r ? (
            <p className="text-sm text-ink-3">{rep.loading ? '불러오는 중…' : <>아직 보고서가 없습니다. 자료실 &ldquo;매출 근거&rdquo; 폴더나 이름에 매출·정산이 들어간 자료를 올리면 숫자를 읽어 확인을 요청하고, [확정]하면 자동으로 분석합니다.
              AI 에는 현장별 집계 숫자(현장 이름·월·매출·지출·회원 수·목표)와 서버가 계산한 지표만 보내며, 메모·파일·개인정보는 보내지 않습니다.</>}</p>
          ) : (
            <div className="space-y-4 text-sm">
              {out?.summary && <p className="rounded-input bg-violet-50 p-3 leading-relaxed"><span className="mr-1.5 rounded bg-violet-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">AI 제안</span>{out.summary}</p>}
              {st?.total && (
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="revenue-report-kpis">
                  <div className="min-w-0 rounded-input border border-line p-3"><div className="text-xs text-ink-2">{mon(r.period)} 전체 매출</div>
                    <div className="mt-1 text-lg font-semibold">{short(st.total.revenue)}</div><div className="text-xs">전월 대비 <Delta v={st.total.mom} what="전월 대비" /></div>
                    <div className="mt-1"><Spark series={st.total.series} label="전체" /></div></div>
                  <div className="rounded-input border border-line p-3"><div className="text-xs text-ink-2">전년 같은 달 대비</div><div className="mt-1 text-lg font-semibold"><Delta v={st.total.yoy} what="전년 같은 달 대비" /></div><div className="text-xs text-ink-3">작년 {short(st.total.lastYear)}</div></div>
                  <div className="rounded-input border border-line p-3"><div className="text-xs text-ink-2">최근 3개월 평균</div><div className="mt-1 text-lg font-semibold">{short(st.total.ma3)}</div><div className="text-xs">직전 3개월보다 <Delta v={st.total.ma3Change} what="직전 3개월 평균 대비" /></div></div>
                  <div className="rounded-input border border-line p-3"><div className="text-xs text-ink-2">6개월 추세(월 평균)</div><div className="mt-1 text-lg font-semibold"><Delta v={st.total.trend} what="월 평균 추세" /></div><div className="text-xs text-ink-3">변동폭 ±{st.total.vol}%</div></div>
                </div>
              )}
              {(!!out?.trend || st?.sites?.length > 0) && (
                <section data-testid="revenue-trend">
                  <h3 className="mb-1 text-xs font-semibold text-ink-2">동향</h3>
                  {out?.trend && <p className="mb-2 leading-relaxed text-ink">{out.trend}</p>}
                  {st?.ranking && (st.ranking.up.length > 0 || st.ranking.down.length > 0) && (
                    <p className="mb-2 flex flex-wrap gap-1.5 text-xs">
                      {st.ranking.up.map((x: any) => <span key={`u${x.site}`} className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">성장 {x.site} ▲ {x.mom}%</span>)}
                      {st.ranking.down.map((x: any) => <span key={`d${x.site}`} className="rounded-full bg-red-50 px-2 py-0.5 text-red-800">하락 {x.site} ▼ {Math.abs(x.mom)}%</span>)}
                    </p>
                  )}
                  {st?.sites?.length > 0 && (
                    <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-right text-xs">
                      <thead><tr className="text-ink-2"><th className="py-1 text-left font-medium">현장</th><th className="font-medium">{mon(r.period)} 매출</th><th className="font-medium">전월 대비</th><th className="font-medium">전년 같은 달</th><th className="font-medium">3개월 평균</th><th className="font-medium">추세(월)</th><th className="pl-3 text-left font-medium">최근 12개월</th></tr></thead>
                      <tbody className="divide-y divide-line tabular-nums">{st.sites.map((s: any) => (
                        <tr key={s.site}><td className="py-1 text-left"><button className="text-accent-600 underline" onClick={() => onFocus(s.site, r.period)} title="근거 숫자로 이동">{s.site}</button></td>
                          <td>{won(s.revenue)}</td><td><Delta v={s.mom} what={`${s.site} 전월 대비`} /></td><td><Delta v={s.yoy} what={`${s.site} 전년 같은 달 대비`} /></td><td>{won(s.ma3)}</td><td><Delta v={s.trend} what={`${s.site} 월 평균 추세`} /></td>
                          <td className="pl-3"><Spark series={s.series} label={s.site} /></td></tr>
                      ))}</tbody>
                    </table></div>
                  )}
                </section>
              )}
              {(st?.total?.forecast?.length > 0 || out?.forecast?.length > 0) && (
                <section data-testid="revenue-forecast">
                  <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-ink-2">향후 전망 <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">추정</span></h3>
                  {st?.total?.forecast?.length > 0 && (
                    <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-right text-xs">
                      <thead><tr className="text-ink-2"><th className="py-1 text-left font-medium">대상</th>{st.total.forecast.map((f: any) => <th key={f.month} className="font-medium">{mon(f.month)} 범위</th>)}</tr></thead>
                      <tbody className="divide-y divide-line tabular-nums">{[{ site: '전체', forecast: st.total.forecast }, ...st.sites.filter((s: any) => s.forecast?.length)].map((s: any) => (
                        <tr key={s.site}><td className="py-1 text-left">{s.site}</td>{s.forecast.map((f: any) => <td key={f.month} title={`가운데 값 ${won(f.base)}`}>{short(f.low)}~{short(f.high)}</td>)}</tr>
                      ))}</tbody>
                    </table></div>
                  )}
                  {out?.forecast?.length > 0 && <ul className="mt-1.5 space-y-1">{out.forecast.map((f: any, i: number) => <li key={i}><span className="font-medium">{f.site}</span> <span className="text-ink-2">{f.comment}</span></li>)}</ul>}
                </section>
              )}
              {out?.actions?.length > 0 && (
                <section data-testid="revenue-actions">
                  <h3 className="mb-1 text-xs font-semibold text-ink-2">대안·실행 제안 (현장별)</h3>
                  <div className="grid gap-2 md:grid-cols-2">{out.actions.map((a: any, i: number) => (
                    <div key={i} className="rounded-input border border-line p-2.5"><div className="mb-1 font-medium">{a.site}</div>
                      <ul className="list-disc space-y-0.5 pl-5 text-ink-2">{a.items.map((t: string, k: number) => <li key={k}>{t}</li>)}</ul></div>
                  ))}</div>
                </section>
              )}
              {out?.anomalies?.length > 0 && (
                <section><h3 className="mb-1 text-xs font-semibold text-ink-2">눈에 띄는 변화</h3>
                  <ul className="space-y-1">{out.anomalies.map((a: any, i: number) => {
                    const row = r.input?.rows?.find((x: any) => x.site === a.site && x.month === a.month); const v = row?.[a.metric];
                    return (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                        <button className="font-medium text-accent-600 underline" onClick={() => onFocus(a.site, a.month)} title="근거 숫자로 이동">{a.site} · {mon(a.month)} {METRIC[a.metric]} {v === null || v === undefined ? '' : a.metric === 'members' ? `${Number(v).toLocaleString('ko-KR')}명` : won(v)}</button>
                        <span className="text-ink-2">{a.comment}</span>
                      </li>
                    );
                  })}</ul>
                </section>
              )}
              {out?.comparisons?.length > 0 && (
                <section><h3 className="mb-1 text-xs font-semibold text-ink-2">현장 비교</h3>
                  <ul className="space-y-1">{out.comparisons.map((c: any, i: number) => <li key={i}><button className="font-medium text-accent-600 underline" onClick={() => onFocus(c.site, r.period)}>{c.site}</button> <span className="text-ink-2">{c.comment}</span></li>)}</ul>
                </section>
              )}
              {(st?.checks?.length > 0 || out?.checks?.length > 0) && (
                <section className="rounded-input bg-amber-50 p-3" data-testid="revenue-checks"><h3 className="mb-1 text-xs font-semibold text-amber-900">확인 필요</h3>
                  <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">{[...(st?.checks ?? []), ...(out?.checks ?? [])].map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>
                </section>
              )}
              <details>
                <summary className="cursor-pointer text-xs text-ink-2">근거 · AI 에 보낸 숫자 · 계산 방법 · {r.model} · {fmtDateTime(r.created_at)}</summary>
                <div className="mt-2 space-y-2 text-xs">
                  {r.files?.length > 0 && <p className="flex flex-wrap items-center gap-2" data-testid="revenue-report-files"><FileText className="size-3.5 text-ink-3" />근거 파일: {r.files.map((f: any) => <a key={f.id} className="text-accent-600 underline" href={`/library?file=${f.id}`}>{f.file_name}</a>)}</p>}
                  {st?.method && <p className="text-ink-3">계산: {st.method}</p>}
                  <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-right tabular-nums">
                    <thead><tr className="text-ink-2"><th className="text-left font-medium">현장</th><th className="font-medium">월</th><th className="font-medium">매출</th><th className="font-medium">지출</th><th className="font-medium">회원 수</th><th className="font-medium">목표</th></tr></thead>
                    <tbody className="divide-y divide-line">{(r.input?.rows ?? []).filter((x: any) => x.month === r.period).map((x: any) => (
                      <tr key={x.site}><td className="py-0.5 text-left">{x.site}</td><td>{x.month}</td><td>{won(x.revenue)}</td><td>{won(x.expense)}</td><td>{x.members ?? '—'}</td><td>{won(x.target)}</td></tr>
                    ))}</tbody>
                  </table></div>
                </div>
              </details>
              <p className="text-[11px] text-ink-3">숫자(증감률·이동평균·추세·전망 범위)는 서버가 입력값으로 계산했고, AI 는 해석과 문장만 썼습니다. 전망은 추정이며, 입력에 없는 현장·월을 가리키는 내용은 서버에서 걸러 냅니다.</p>
            </div>
          )}
        </Card>
      )}
      {done.length > 0 && (
        <details className="text-xs text-ink-3" data-testid="revenue-imports-done">
          <summary className="cursor-pointer">최근 처리한 매출 자료 {done.length}건</summary>
          <ul className="mt-1 space-y-0.5 pl-4">{done.map((x) => <li key={x.id}>「{x.file_name}」 {x.status === 'confirmed' ? `확정 · ${x.applied?.count ?? 0}건 반영${x.applied?.edited ? '(고쳐서)' : ''}` : '무시'} · {x.decided_by_name ?? ''} {x.decided_at ? fmtDateTime(x.decided_at) : ''}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
