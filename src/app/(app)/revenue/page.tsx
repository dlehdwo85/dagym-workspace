'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Download, FileUp, Info } from 'lucide-react';
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

type Row = { id: string; org_unit_id: string; month: string; revenue: number; expense: number; members: number | null; target: number | null; note: string | null; source: string; source_file: string | null; updated_at: string; updated_by_name: string | null };

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
  const { data, error, loading, reload } = useApi<{ year: number; units: any[]; rows: Row[] }>(`/api/revenue?year=${year}`, [year]);
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
    const head = '현장,월,매출,지출,회원수,목표,메모';
    const body = units.map((u) => `${u.name},${month},,,,,`).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + head + '\n' + body + '\n'], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `매출_${month}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const unitName = (id: string) => data?.units.find((u) => u.id === id)?.name ?? '';
  const brands = dir.brands.filter((b) => !HIDDEN_BRANDS.includes(b.id));

  return (
    <div className="space-y-4">
      <PageHeader title="매출" icon={BarChart3} sub="현장별 월 매출·지출 — 본사만 볼 수 있습니다" actions={<>
        <select className="h-9 rounded-input border border-line bg-white px-2 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="연도">
          {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select className="h-9 rounded-input border border-line bg-white px-2 text-sm" value={brand} onChange={(e) => { setBrand(e.target.value); setUnit(''); }} aria-label="브랜드">
          <option value="">전체 브랜드</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
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

        <Card className="p-4" data-testid="revenue-input">
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
            <div className={cx('mb-3 rounded-input border p-3 text-sm', csv.result?.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50')} data-testid="csv-preview">
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
                      <span className="text-[11px] text-ink-3">{e ? `근거: ${e.source === 'csv' ? `CSV ${e.source_file ?? ''}` : e.source === 'gpt' ? 'GPT 연동' : '직접 입력'} · ${e.updated_by_name ?? ''} ${fmtDateTime(e.updated_at)}` : '아직 입력 전'}</span>
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
        </Card>

        <p className="flex items-start gap-1.5 text-xs text-ink-3"><Info className="mt-0.5 size-3.5 shrink-0" />
          다음 단계(대표 결정 대기): GPT 자료 운영체계의 표준 CSV 업로드·Custom GPT Action 으로 월 실적 전송, AI 월간 요약·이상치 코멘트. 외부 AI 사용 여부·비용·전송 범위가 정해지면 붙입니다. 모든 숫자는 위 “근거”(입력 방식·파일·시각)와 함께 보관됩니다.
        </p>
        {unit && <p className="text-xs text-ink-3">선택한 현장: {unitName(unit)}</p>}
      </>}
    </div>
  );
}
