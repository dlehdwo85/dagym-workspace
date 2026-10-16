'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Download, FileUp, Info, Sparkles } from 'lucide-react';
import { DropHint, UploadProgress, putFile } from '@/components/upload';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, Card, ErrorBox, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { HIDDEN_BRANDS } from '@/lib/types';

/** 차트 색: 올해(파랑)·작년(주황) — 색약 구분 검증(validate_palette) 통과, 표 보기 제공 */
const C_THIS = '#2a78d6';
const C_PREV = '#eb6834';
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const fmtWon = (n: number) => (Math.abs(n) >= 1e8 ? `${(n / 1e8).toFixed(1).replace(/\.0$/, '')}억` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1e4).toLocaleString('ko-KR')}만` : n.toLocaleString('ko-KR'));
const fmtFull = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n).toLocaleString('ko-KR')}원`);
const pct = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(1)}%` : '—');

type Row = { id: string; org_unit_id: string; month: string; revenue: number; expense: number; members: number | null; target: number | null; note: string | null; source: string; source_file: string | null; source_file_ids?: string[] | null; updated_at: string; updated_by_name: string | null };

function Chart({ year, thisY, prevY, target }: { year: number; thisY: number[]; prevY: number[]; target: (number | null)[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // 화면 폭에 맞춰 그리되 높이는 고정 (넓은 화면에서 차트가 지나치게 커지지 않게)
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const H = 240, L = 48, B = 24, T = 12;
  const max = Math.max(1, ...thisY, ...prevY, ...target.map((x) => x ?? 0));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const cw = (W - L) / 12, bw = Math.min(14, cw / 3);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  return (
    <div className="relative min-w-0" ref={box}>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-ink-2" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: C_THIS }} />{year}년 매출</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: C_PREV }} />{year - 1}년 매출</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink-2" />목표</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={`${year}년 월별 매출과 전년 비교 차트 (아래 표에 같은 값)`} onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="#eceef1" />
            <text x={L - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 text-[10px] tabular-nums">{fmtWon(v)}</text>
          </g>
        ))}
        {MONTHS.map((m, i) => {
          const cx0 = L + cw * i + cw / 2;
          const bar = (v: number, x: number, c: string) => v > 0 && <path d={`M${x},${y(0)} V${y(v) + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${y(0)} Z`} fill={c} />;
          return (
            <g key={m} onMouseEnter={() => setHover(i)}>
              <rect x={L + cw * i} y={T} width={cw} height={H - T - B} fill={hover === i ? '#f1f5f9' : 'transparent'} />
              {bar(prevY[i], cx0 - bw - 1, C_PREV)}
              {bar(thisY[i], cx0 + 1, C_THIS)}
              {target[i] ? <line x1={cx0 - bw - 4} x2={cx0 + bw + 4} y1={y(target[i]!)} y2={y(target[i]!)} stroke="#334155" strokeWidth={2} strokeDasharray="4 3" /> : null}
              <text x={cx0} y={H - 6} textAnchor="middle" className="fill-slate-500 text-[11px]">{i + 1}월</text>
            </g>
          );
        })}
        <line x1={L} x2={W} y1={y(0)} y2={y(0)} stroke="#cbd5e1" />
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-6 z-10 rounded-input border border-line bg-white px-3 py-2 text-xs shadow-pop" style={{ left: `min(calc(${((hover + 0.5) / 12) * 100}% + 8px), calc(100% - 180px))` }} role="status">
          <div className="mb-1 font-semibold">{hover + 1}월</div>
          <div className="flex justify-between gap-4"><span className="flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: C_THIS }} />{year}년</span><span className="tabular-nums">{fmtFull(thisY[hover])}</span></div>
          <div className="flex justify-between gap-4"><span className="flex items-center gap-1"><span className="size-2 rounded-sm" style={{ background: C_PREV }} />{year - 1}년</span><span className="tabular-nums">{fmtFull(prevY[hover])}</span></div>
          {target[hover] ? <div className="flex justify-between gap-4"><span>목표</span><span className="tabular-nums">{fmtFull(target[hover])}</span></div> : null}
          <div className="mt-1 text-ink-2">전년 대비 {pct(thisY[hover], prevY[hover])}</div>
        </div>
      )}
    </div>
  );
}

export default function RevenuePage() {
  const { dir } = useSession();
  const thisYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()));
  const [year, setYear] = useState(thisYear);
  const [brand, setBrand] = useState('');
  const [unit, setUnit] = useState('');
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7));
  const { data, error, loading, reload } = useApi<{ year: number; units: any[]; rows: Row[]; aiEnabled?: boolean; canEdit?: boolean }>(`/api/revenue?year=${year}`, [year]);
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [csv, setCsv] = useState<{ name: string; text: string; result?: any } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const units = useMemo(() => (data?.units ?? []).filter((u) => !HIDDEN_BRANDS.includes(u.brand_id) && (!brand || u.brand_id === brand)), [data, brand]);
  const shownIds = new Set(unit ? [unit] : units.map((u) => u.id));
  const rows = (data?.rows ?? []).filter((r) => shownIds.has(r.org_unit_id));
  const sumBy = (y: number, f: (r: Row) => number | null) => MONTHS.map((m) => rows.filter((r) => r.month === `${y}-${m}`).reduce((a, r) => a + (f(r) ?? 0), 0));
  const thisY = sumBy(year, (r) => r.revenue), prevY = sumBy(year - 1, (r) => r.revenue), expY = sumBy(year, (r) => r.expense);
  const targetY = MONTHS.map((m) => { const t = rows.filter((r) => r.month === `${year}-${m}` && r.target); return t.length ? t.reduce((a, r) => a + (r.target ?? 0), 0) : null; });
  const filled = thisY.map((v, i) => v > 0 || expY[i] > 0);
  const lastIdx = filled.lastIndexOf(true);
  const ytd = thisY.reduce((a, b) => a + b, 0), ytdExp = expY.reduce((a, b) => a + b, 0);
  const prevSame = prevY.slice(0, lastIdx + 1).reduce((a, b) => a + b, 0);
  // 목표 달성률: 목표를 입력한 현장·월의 매출만 그 목표와 비교
  const tgtRows = rows.filter((r) => r.month.startsWith(`${year}-`) && r.target);
  const tgtSum = tgtRows.reduce((a, r) => a + (r.target ?? 0), 0), tgtAct = tgtRows.reduce((a, r) => a + r.revenue, 0);

  if (error) return <ErrorBox error={error} retry={reload} />;

  const entry = (unitId: string) => data?.rows.find((r) => r.org_unit_id === unitId && r.month === month);
  const draft = (unitId: string) => drafts[unitId] ?? (() => { const e = entry(unitId); return { revenue: e?.revenue ?? '', expense: e?.expense ?? '', members: e?.members ?? '', target: e?.target ?? '', note: e?.note ?? '' }; })();
  const setD = (unitId: string, k: string, v: string) => setDrafts((d) => ({ ...d, [unitId]: { ...draft(unitId), [k]: v } }));
  async function save(unitId: string) {
    const d = draft(unitId);
    if (d.revenue === '') return toast.error('매출을 입력하세요');
    try {
      await api('/api/revenue', { method: 'PUT', body: { orgUnitId: unitId, month, revenue: Number(d.revenue), expense: Number(d.expense || 0), members: d.members === '' ? null : Number(d.members), target: d.target === '' ? null : Number(d.target), note: d.note || null } });
      setDrafts((x) => { const n = { ...x }; delete n[unitId]; return n; });
      toast.ok('저장했습니다'); reload();
    } catch (e: any) { toast.error(e.message); }
  }
  async function pickFile(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    try { const r = await api('/api/revenue/import', { body: { csv: text, fileName: f.name, dryRun: true } }); setCsv({ name: f.name, text, result: r }); }
    catch (e: any) { toast.error(e.message); }
    if (fileRef.current) fileRef.current.value = '';
  }
  async function commitCsv() {
    if (!csv) return;
    try { const r = await api('/api/revenue/import', { body: { csv: csv.text, fileName: csv.name } }); toast.ok(`${r.count}건을 가져왔습니다`); setCsv(null); reload(); }
    catch (e: any) { toast.error(e.message); }
  }
  function template() {
    // 앱(WebView)은 blob 내려받기가 안 됨 → 서버 주소로(안드로이드 내려받기 처리기가 받음)
    if (document.documentElement.classList.contains('native')) { location.href = `/api/revenue/template?month=${month}${brand ? `&brand=${brand}` : ''}`; return; }
    // 표준 양식: 한 줄 = 현장·월·항목 하나 (GPT 자료 운영체계와 같은 칸)
    const head = '현장,월,항목,금액,근거파일명';
    const body = units.flatMap((u) => ['매출', '지출', '회원수', '목표'].map((it) => `${u.name},${month},${it},,`)).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + head + '\n' + body + '\n'], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `매출_${month}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const unitName = (id: string) => data?.units.find((u) => u.id === id)?.name ?? '';
  const brands = dir.brands.filter((b) => !HIDDEN_BRANDS.includes(b.id));

  return (
    <div className="space-y-4">
      <PageHeader title="매출" icon={BarChart3} sub="현장별 월 매출·지출 — 대표가 권한을 켜 준 사람만 볼 수 있습니다" actions={<>
        <select className="h-9 rounded-input border border-line bg-white px-2 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="연도">
          {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
{dir.brands.length > 0 && (
        <select className="h-9 rounded-input border border-line bg-white px-2 text-sm" value={brand} onChange={(e) => { setBrand(e.target.value); setUnit(''); }} aria-label="브랜드">
          <option value="">전체 브랜드</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>)}
        <select className="h-9 max-w-[11rem] rounded-input border border-line bg-white px-2 text-sm" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="현장">
          <option value="">전체 현장</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </>} />
      {loading && !data ? <Skeleton rows={6} /> : <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="revenue-kpis">
          {([['올해 누적 매출', fmtFull(ytd), lastIdx >= 0 ? `1~${lastIdx + 1}월 입력분` : '입력 전'], ['누적 지출', fmtFull(ytdExp), `이익 ${fmtFull(ytd - ytdExp)}`],
            ['전년 같은 기간 대비', prevSame ? pct(ytd, prevSame) : '—', prevSame ? `작년 ${fmtFull(prevSame)}` : '작년 자료 없음'], ['목표 달성률', tgtSum ? `${((tgtAct / tgtSum) * 100).toFixed(1)}%` : '—', tgtSum ? `목표 ${fmtFull(tgtSum)}` : '목표 미입력']] as const).map(([l, v, sub]) => (
            <Card key={l} className="p-4"><div className="text-xs text-ink-2">{l}</div><div className="mt-1 truncate text-xl font-bold tabular-nums">{v}</div><div className="mt-0.5 truncate text-xs text-ink-3">{sub}</div></Card>
          ))}
        </div>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">월별 추이 · 전년 대비 · 목표 대비</h2>
          <Chart year={year} thisY={thisY} prevY={prevY} target={targetY} />
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-ink-2">표로 보기</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-right text-xs tabular-nums" data-testid="revenue-table">
                <thead><tr className="text-ink-2"><th className="py-1 text-left font-medium">월</th><th className="font-medium">{year}년 매출</th><th className="font-medium">{year - 1}년 매출</th><th className="font-medium">전년 대비</th><th className="font-medium">지출</th><th className="font-medium">목표</th></tr></thead>
                <tbody className="divide-y divide-line">{MONTHS.map((m, i) => (
                  <tr key={m}><td className="py-1 text-left">{i + 1}월</td><td>{fmtFull(thisY[i] || null)}</td><td>{fmtFull(prevY[i] || null)}</td><td>{thisY[i] && prevY[i] ? pct(thisY[i], prevY[i]) : '—'}</td><td>{fmtFull(expY[i] || null)}</td><td>{fmtFull(targetY[i])}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </Card>

        {data?.canEdit ? <Card className="p-4" data-testid="revenue-input">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">월 실적 입력</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input type="month" className="h-9 rounded-input border border-line px-2 text-sm" value={month} onChange={(e) => { setMonth(e.target.value); setDrafts({}); }} aria-label="입력할 월" />
              <Button variant="secondary" size="sm" onClick={template}><Download />CSV 양식</Button>
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><FileUp />CSV 가져오기</Button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} aria-label="CSV 파일 선택" />
            </div>
          </div>
          {csv && (
            <div className={cx('mb-3 rounded-input border p-3 text-sm', csv.result?.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50')} data-testid="csv-preview">
              <p className="font-medium">{csv.name} — {csv.result?.ok ? `${csv.result.count}건 가져올 수 있습니다` : `오류 ${csv.result?.errors.length}건 (아무것도 저장되지 않았습니다)`}</p>
              {!!csv.result?.errors.length && <ul className="mt-1 list-disc pl-5 text-xs text-red-700">{csv.result.errors.slice(0, 10).map((e: any) => <li key={e.line}>{e.line}번째 줄: {e.message}</li>)}</ul>}
              <div className="mt-2 flex gap-2">{csv.result?.ok && <Button size="sm" onClick={commitCsv}>가져오기</Button>}<Button size="sm" variant="secondary" onClick={() => setCsv(null)}>취소</Button></div>
            </div>
          )}
          {!units.length ? <p className="py-6 text-center text-sm text-ink-3">등록된 현장(지점·위탁현장)이 없습니다. 운영 상태 → 조직 구성에서 추가하세요.</p> : (
            <ul className="divide-y divide-line">
              {(unit ? units.filter((u) => u.id === unit) : units).map((u) => {
                const d = draft(u.id), e = entry(u.id);
                return (
                  <li key={u.id} className="py-3" data-unit={u.name}>
                    <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium">{u.name}</span>
                      <span className="text-[11px] text-ink-3">{e?.source_file_ids?.map((id, k) => <a key={id} href={`/api/library/${id}/download`} target="_blank" rel="noreferrer" className="mr-1 text-accent-600 underline">근거 파일{e.source_file_ids!.length > 1 ? ` ${k + 1}` : ''}</a>)}{e ? `근거: ${e.source === 'csv' ? `CSV ${e.source_file ?? ''}` : e.source === 'gpt' ? 'GPT 연동' : e.source === 'ai' ? `AI 추출 ${e.source_file ?? ''}` : '직접 입력'} · ${e.updated_by_name ?? ''} ${fmtDateTime(e.updated_at)}` : '아직 입력 전'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.5fr)_auto]">
                      {([['revenue', '매출(원)'], ['expense', '지출(원)'], ['members', '회원 수'], ['target', '목표(원)']] as const).map(([k, l]) => (
                        <label key={k} className="min-w-0 text-xs text-ink-2">{l}
                          <input inputMode="numeric" className={cx(inputCls, 'mt-0.5 h-9 text-right tabular-nums')} value={d[k]} onChange={(ev) => setD(u.id, k, ev.target.value.replace(/[^\d]/g, ''))} aria-label={`${u.name} ${l}`} />
                        </label>
                      ))}
                      <label className="col-span-2 min-w-0 text-xs text-ink-2 sm:col-span-1">메모·근거 파일
                        <input className={cx(inputCls, 'mt-0.5 h-9')} value={d.note} onChange={(ev) => setD(u.id, 'note', ev.target.value)} aria-label={`${u.name} 메모`} maxLength={500} />
                      </label>
                      <Button className="col-span-2 self-end sm:col-span-1" size="sm" variant={drafts[u.id] ? 'primary' : 'secondary'} onClick={() => save(u.id)} aria-label={`${u.name} 저장`}>저장</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card> : <p className="rounded-input bg-slate-50 p-3 text-sm text-ink-2" data-testid="revenue-view-only">보기 권한입니다 — 숫자 입력·가져오기는 대표가 &ldquo;입력&rdquo; 권한을 켜 준 사람만 할 수 있습니다.</p>}

        {data?.aiEnabled && <AiPanel period={month} onFocus={(site, m) => {
          const u = data.units.find((x) => x.name === site); if (u) setUnit(u.id); setMonth(m); setDrafts({});
          document.querySelector('[data-testid=revenue-input]')?.scrollIntoView({ behavior: 'smooth' });
        }} />}
        {data?.canEdit && data?.aiEnabled && <AiInputPanel units={units} onDone={reload} />}
        <p className="flex items-start gap-1.5 text-xs text-ink-3"><Info className="mt-0.5 size-3.5 shrink-0" />
          모든 숫자는 근거(입력 방식·파일·입력자·시각)와 함께 보관됩니다. CSV 는 표준 양식(현장·월·항목·금액·근거파일명)과 가로형(현장·월·매출·지출…) 모두 받습니다.
          {!data?.aiEnabled && ' 자료로 입력(AI)·AI 분석은 워크인 내장 AI 가 켜지면 나타납니다(운영자 설정).'}
        </p>
        {unit && <p className="text-xs text-ink-3">선택한 현장: {unitName(unit)}</p>}
      </>}
    </div>
  );
}

const METRIC: Record<string, string> = { revenue: '매출', expense: '지출', members: '회원 수' };

/** AI 분석: 집계 숫자만 보내 받은 요약·이상치·현장 비교. 결과는 "AI 제안"으로 구분하고 근거 숫자로 바로 이동 */
function AiPanel({ period, onFocus }: { period: string; onFocus: (site: string, month: string) => void }) {
  const cur = useApi<{ report: any }>(`/api/revenue/ai?period=${period}`, [period]);
  const [busy, setBusy] = useState(false);
  const r = cur.data?.report;
  async function run() {
    setBusy(true);
    try { await api('/api/revenue/ai', { body: { period } }); cur.reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const val = (site: string, month: string, metric: string) => {
    const row = r?.input?.rows?.find((x: any) => x.site === site && x.month === month);
    const v = row?.[metric];
    return v === null || v === undefined ? null : metric === 'members' ? `${Number(v).toLocaleString('ko-KR')}명` : fmtFull(v);
  };
  return (
    <Card className="p-4" data-testid="revenue-ai">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-violet-500" />AI 월간 분석 · {Number(period.slice(5))}월</h2>
        <Button size="sm" variant="secondary" onClick={run} disabled={busy}>{busy ? '분석 중…' : r ? '다시 분석' : 'AI 분석'}</Button>
      </div>
      {!r ? <p className="text-sm text-ink-3">이 달의 분석이 없습니다. 현장별 집계 숫자(현장 이름·월·매출·지출·회원 수·목표)만 보내며, 메모·파일·개인정보는 보내지 않습니다.</p> : (
        <div className="space-y-3 text-sm">
          <p className="rounded-input bg-violet-50 p-3 leading-relaxed"><span className="mr-1.5 rounded bg-violet-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">AI 제안</span>{r.output.summary}</p>
          {r.output.anomalies.length > 0 && (
            <div><h3 className="mb-1 text-xs font-semibold text-ink-2">눈에 띄는 변화</h3>
              <ul className="space-y-1">{r.output.anomalies.map((a: any, i: number) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <button className="font-medium text-accent-600 underline" onClick={() => onFocus(a.site, a.month)} title="근거 숫자로 이동">{a.site} · {Number(a.month.slice(5))}월 {METRIC[a.metric]} {val(a.site, a.month, a.metric) ?? ''}</button>
                  <span className="text-ink-2">{a.comment}</span>
                </li>
              ))}</ul>
            </div>
          )}
          {r.output.comparisons.length > 0 && (
            <div><h3 className="mb-1 text-xs font-semibold text-ink-2">현장 비교</h3>
              <ul className="space-y-1">{r.output.comparisons.map((c: any, i: number) => (
                <li key={i}><button className="font-medium text-accent-600 underline" onClick={() => onFocus(c.site, period)}>{c.site}</button> <span className="text-ink-2">{c.comment}</span></li>
              ))}</ul>
            </div>
          )}
          <details><summary className="cursor-pointer text-xs text-ink-2">AI 에 보낸 숫자 (근거) · {r.model} · {fmtDateTime(r.created_at)}</summary>
            <div className="mt-1 overflow-x-auto"><table className="w-full min-w-[480px] text-right text-xs tabular-nums">
              <thead><tr className="text-ink-2"><th className="text-left font-medium">현장</th><th className="font-medium">월</th><th className="font-medium">매출</th><th className="font-medium">지출</th><th className="font-medium">회원 수</th><th className="font-medium">목표</th></tr></thead>
              <tbody className="divide-y divide-line">{r.input.rows.filter((x: any) => x.month === period).map((x: any) => (
                <tr key={x.site}><td className="py-0.5 text-left">{x.site}</td><td>{x.month}</td><td>{fmtFull(x.revenue)}</td><td>{fmtFull(x.expense)}</td><td>{x.members ?? '—'}</td><td>{fmtFull(x.target)}</td></tr>
              ))}</tbody>
            </table></div>
          </details>
          <p className="text-[11px] text-ink-3">AI 제안은 참고용입니다. 숫자는 위 표의 입력값이 기준이며, 입력에 없는 현장·월을 가리키는 제안은 서버에서 걸러 냅니다.</p>
        </div>
      )}
    </Card>
  );
}

/** V13 1번 자료로 입력(AI): 정산서·매출 보고(엑셀·PDF·사진) → 자료실 "매출 근거"에 원본 저장 → 내장 AI 가 뽑은 표 미리보기 → 확인·수정 후 반영 */
type XRow = { site: string; month: string; item: string; amount: number };
function AiInputPanel({ units, onDone }: { units: { name: string }[]; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [prog, setProg] = useState<{ name: string; pct: number; error?: string }[]>([]);
  const [busy, setBusy] = useState('');
  const [res, setRes] = useState<{ ids: string[]; fileName: string; rows: XRow[]; notes: string; errors: any[] } | null>(null);
  async function go(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list).slice(0, 5);
    setRes(null); setProg(files.map((f) => ({ name: f.name, pct: 0 })));
    const ids: string[] = [];
    for (const [n, file] of files.entries()) {
      setBusy(`${file.name} 올리는 중…`);
      try {
        const r = await api('/api/library', { body: { fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, purpose: 'revenue' } });
        await putFile(r.upload, file, (pct) => setProg((x) => x.map((y, j) => (j === n ? { ...y, pct } : y))));
        await api(`/api/library/${r.id}/complete`, { body: {} });
        ids.push(r.id);
      } catch (e: any) { setProg((x) => x.map((y, j) => (j === n ? { ...y, error: e.message } : y))); }
    }
    if (ref.current) ref.current.value = '';
    if (!ids.length) { setBusy(''); return; }
    setBusy('AI 가 숫자를 뽑는 중… (최대 1분)');
    try {
      const r = await api('/api/revenue/extract', { body: { fileIds: ids } });
      setRes({ ids, fileName: r.fileName, rows: r.rows, notes: r.notes, errors: r.errors ?? [] }); setProg([]);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  const setRow = (i: number, k: keyof XRow, v: string) => setRes((r) => r && { ...r, rows: r.rows.map((x, j) => (j === i ? { ...x, [k]: k === 'amount' ? Number(v.replace(/[^\d]/g, '')) || 0 : v } : x)) });
  async function apply() {
    if (!res) return;
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = ['현장,월,항목,금액,근거파일명', ...res.rows.map((x) => [x.site, x.month, x.item, String(x.amount), res.fileName].map(esc).join(','))].join('\n');
    try {
      const r = await api('/api/revenue/import', { body: { csv, fileName: res.fileName, evidenceFileIds: res.ids } });
      if (!r.ok) { setRes({ ...res, errors: r.errors }); return toast.error(`고칠 곳 ${r.errors.length}건 — 아무것도 저장되지 않았습니다`); }
      toast.ok(`${r.count}건을 반영했습니다`); setRes(null); onDone();
    } catch (e: any) { toast.error(e.message); }
  }
  return (
    <Card className="p-4" data-testid="revenue-ai-input">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-violet-500" />자료로 입력 (AI)</h2>
        <Button size="sm" variant="secondary" onClick={() => ref.current?.click()} disabled={!!busy}><FileUp />정산서 올리기</Button>
        <input ref={ref} type="file" multiple accept=".xlsx,.xls,.csv,.pdf,image/*" className="hidden" onChange={(e) => go(e.target.files)} data-testid="revenue-ai-file" aria-label="정산서 파일 선택" />
      </div>
      {!res && <DropHint onClick={() => ref.current?.click()} disabled={!!busy} what="정산서·매출 보고 엑셀·PDF·사진" testid="revenue-ai-drop" />}
      {busy && <p className="mt-2 text-sm text-ink-2">{busy}</p>}
      <UploadProgress items={prog} />
      {res && (
        <div className="space-y-2" data-testid="revenue-ai-preview">
          <p className="text-sm"><span className="mr-1.5 rounded bg-violet-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">AI 추출</span>
            {res.rows.length ? `${res.rows.length}개 숫자를 찾았습니다 — 확인하고 고친 뒤 반영하세요` : '자료에서 실적을 찾지 못했습니다'}</p>
          {res.notes && <p className="rounded-input bg-amber-50 p-2 text-xs text-amber-900">AI 메모: {res.notes}</p>}
          {!!res.rows.length && <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm">
            <thead><tr className="text-left text-xs text-ink-3"><th className="py-1">현장</th><th>월</th><th>항목</th><th className="text-right">금액(원)</th><th /></tr></thead>
            <tbody className="divide-y divide-line">{res.rows.map((x, i) => (
              <tr key={i}>
                <td className="py-1 pr-1"><select className={cx(inputCls, 'h-8')} value={x.site} onChange={(e) => setRow(i, 'site', e.target.value)} aria-label={`${i + 1}번째 현장`}>
                  {!units.some((u) => u.name === x.site) && <option value={x.site}>{x.site} (없는 현장)</option>}{units.map((u) => <option key={u.name}>{u.name}</option>)}</select></td>
                <td className="pr-1"><input type="month" className={cx(inputCls, 'h-8')} value={x.month} onChange={(e) => setRow(i, 'month', e.target.value)} aria-label={`${i + 1}번째 월`} /></td>
                <td className="pr-1"><select className={cx(inputCls, 'h-8')} value={x.item} onChange={(e) => setRow(i, 'item', e.target.value)} aria-label={`${i + 1}번째 항목`}>{['매출', '지출', '회원수', '목표'].map((t) => <option key={t}>{t}</option>)}</select></td>
                <td className="pr-1"><input inputMode="numeric" className={cx(inputCls, 'h-8 text-right tabular-nums')} value={x.amount.toLocaleString('ko-KR')} onChange={(e) => setRow(i, 'amount', e.target.value)} aria-label={`${i + 1}번째 금액`} /></td>
                <td><button className="px-1 text-xs text-red-600" onClick={() => setRes({ ...res, rows: res.rows.filter((_, j) => j !== i) })} aria-label={`${i + 1}번째 빼기`}>빼기</button></td>
              </tr>
            ))}</tbody>
          </table></div>}
          {!!res.errors.length && <ul className="list-disc pl-5 text-xs text-red-700">{res.errors.slice(0, 10).map((e: any, i: number) => <li key={i}>{e.line ? `${e.line - 1}번째 줄: ` : ''}{e.message}</li>)}</ul>}
          <div className="flex gap-2">{!!res.rows.length && <Button size="sm" onClick={apply} data-testid="revenue-ai-apply">확인 후 반영</Button>}<Button size="sm" variant="secondary" onClick={() => setRes(null)}>취소</Button></div>
          <p className="text-[11px] text-ink-3">원본은 자료실 &ldquo;매출 근거&rdquo; 폴더에 보관되고, 반영한 숫자마다 근거 파일로 연결됩니다.</p>
        </div>
      )}
    </Card>
  );
}
