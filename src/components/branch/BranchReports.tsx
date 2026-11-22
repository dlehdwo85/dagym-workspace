'use client';
import { useEffect, useMemo, useState } from 'react';
import { FileDown, FileUp, Loader2, Plus, Printer, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, Empty, ErrorBox, Field, Loading, Modal, PageHeader, askConfirm, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { ReportView, STATE_TONE, type Body, type Line } from './ReportView';
import { MembersSection, MonthlyView, delta, usageTotal, type MonthlyBody } from './MonthlyView';

/**
 * #1096 지점 주간보고(다짐 전용) — 설계 docs/branch-report-design.md, 대표 결정 11/21.
 * 지점·주(금요일) 고르기 → 지점 관리자가 카톡에 올린 주간보고 글 붙여 넣기(+선택: 대화 파일) → [초안 만들기](AI) → 고치기 → [제출](잠김)
 * 항목마다 근거(D줄·대화)를 눌러 봄. '확인 필요'는 제출 전에 확인. PDF 는 인쇄 화면에서.
 * 지점 = 기능 안의 '보고 지점' 목록(다짐 조직 단위와 따로) — 작성 담당은 자기 지점만, 검토 담당·대표·관리자는 전체
 * 2단계 월간: 달 고르기 → 그 달 제출된 주간보고로 [월간 초안 만들기] → 양식 B(중요업무·진행사항·차월 목표) + C(시설별 이용 현황) + 미완료 → 고치기·제출 → PDF·엑셀
 */
type Home = { admin: boolean; friday: string; siteId: string | null; canWrite: boolean; canReopen: boolean; sites: { id: string; name: string; writer: string | null; reviewer: string | null; hidden: boolean }[];
  reports: { id: string; report_day: string; status: string; updated_at: string; submitted_at: string | null }[]; chat: { n: number; last: string | null } | null;
  monthly: { id: string; month: string; status: string; updated_at: string; submitted_at: string | null }[]; today: string };
const monthsBack = (today: string, n: number) => Array.from({ length: n }, (_, k) => { const [y, m] = today.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - k, 1)).toISOString().slice(0, 7); });
const STATES = ['완료', '진행 중', '확인 필요'] as const;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const PLACEHOLDER = `예) ○○ 주간보고
<이용인원> 헬스 120 / 골프 35 / 독서실 18
<특이사항 건의사항 및 민원>
내용 : 사우나 온도 민원
- 11/18 접수, 설비 업체 점검 예정(11/25)
<골프장> 총이용인원 35 / 청소상태 청결 / 시설상태 양호
- 타석 3번 센서 : 완료`;
const countCheck = (b: Body | null) => !b ? 0 : b.usage.filter((x) => x.count === '확인 필요').length + b.facilities.reduce((a, f) => a + [f.visitors, f.cleaning, f.condition].filter((v) => v === '확인 필요').length + f.lines.filter((l) => l.state === '확인 필요').length, 0) + b.issues.filter((x) => x.state === '확인 필요').length;

export function BranchReports() {
  const [site, setSite] = useState<string | null>(null);
  useEffect(() => { const q = new URLSearchParams(location.search).get('site'); if (q) setSite(q); }, []);
  const home = useApi<Home>(`/api/branch-reports${site ? `?site=${site}` : ''}`);
  const h = home.data;
  const [day, setDay] = useState<string | null>(null);
  const [mode, setMode] = useState<'weekly' | 'monthly'>('weekly');
  const [month, setMonth] = useState<string | null>(null);
  const curDay = day ?? h?.friday ?? null;
  const curMonth = month ?? h?.today.slice(0, 7) ?? null;
  const fridays = useMemo(() => (h ? Array.from({ length: 12 }, (_, k) => addDays(h.friday, -7 * k)) : []), [h]);
  const months = useMemo(() => (h ? monthsBack(h.today, 12) : []), [h]);
  const rep = mode === 'weekly' ? h?.reports.find((r) => r.report_day === curDay) ?? null : h?.monthly.find((r) => r.month === curMonth) ?? null;
  const weeksIn = (m: string) => (h?.reports ?? []).filter((r) => r.status === 'submitted' && r.report_day.startsWith(m)).length;
  const detail = useApi<{ report: any; canWrite: boolean; canReopen: boolean; admin: boolean }>(rep ? `/api/branch-reports/${rep.id}` : null);
  const [setup, setSetup] = useState(false);
  const [ev, setEv] = useState<{ refs: string[]; items?: any[] } | null>(null);
  if (home.error) return <ErrorBox error={home.error} retry={home.reload} />;
  if (!h) return <Loading />;
  const siteId = h.siteId; const siteName = h.sites.find((t) => t.id === siteId)?.name ?? '';
  const reload = () => { home.reload(); detail.reload(); };
  const showEvidence = async (refs: string[]) => {
    if (!rep || !refs.length) return;
    setEv({ refs });
    try { const r = await api<{ items: any[] }>(`/api/branch-reports/${rep.id}/evidence?refs=${refs.join(',')}`); setEv({ refs, items: r.items }); } catch (e: any) { toast.error(e.message); setEv(null); }
  };
  return (
    <div className="space-y-3" data-testid="branch-reports">
      <PageHeader title="지점 보고" sub={mode === 'weekly' ? "지점 관리자의 주간보고 글로 AI 가 초안을 만들고, 담당이 고쳐서 제출합니다 — 숫자는 글에 있는 것만, 모르면 '확인 필요'" : '그 달 제출된 주간보고로 월간 업무 보고서(중요업무·진행사항·차월 목표)와 시설별 이용 현황을 만듭니다 — 이용 인원·미완료는 주간보고 그대로'} actions={h.admin ? <Button size="sm" variant="secondary" onClick={() => setSetup(true)} data-testid="branch-setup-open"><Settings2 />보고 지점</Button> : undefined} />
      {!h.sites.length ? <Empty title="아직 보고 지점이 없습니다">{h.admin ? '[보고 지점]에서 지점 이름을 한 번에 붙여 넣고 작성 담당·검토 담당을 고르세요.' : '관리자에게 내 지점의 작성 담당 지정을 요청하세요.'}</Empty> : <>
        <div className="inline-flex rounded-input border border-line bg-white p-0.5 text-sm" role="tablist" data-testid="branch-mode">
          {(['weekly', 'monthly'] as const).map((m) => <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cx('rounded-[6px] px-3 py-1', mode === m ? 'bg-brand-700 text-white' : 'text-ink-2 hover:bg-slate-50')} data-testid={`branch-mode-${m}`}>{m === 'weekly' ? '주간' : '월간'}</button>)}
        </div>
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-white p-3 shadow-card">
          <Field label="지점" className="min-w-[180px] flex-1"><select className={inputCls} value={siteId ?? ''} onChange={(e) => { setSite(e.target.value); setDay(null); }} data-testid="branch-unit">
            {h.sites.map((t) => <option key={t.id} value={t.id}>{t.name}{t.hidden ? ' (숨김)' : ''}{t.writer ? ` — ${t.writer}` : ''}</option>)}</select></Field>
          {mode === 'weekly' ? <Field label="보고 주(금요일 11:00 기준)" className="min-w-[200px] flex-1"><select className={inputCls} value={curDay ?? ''} onChange={(e) => setDay(e.target.value)} data-testid="branch-week">
            {fridays.map((f) => { const r = h.reports.find((x) => x.report_day === f); return <option key={f} value={f}>{md(f)}(금) · {md(addDays(f, -7))}~{md(addDays(f, -1))}{r ? (r.status === 'submitted' ? ' · 제출함' : ' · 초안') : ''}</option>; })}</select></Field>
            : <Field label="보고 달" className="min-w-[200px] flex-1"><select className={inputCls} value={curMonth ?? ''} onChange={(e) => setMonth(e.target.value)} data-testid="branch-month">
              {months.map((m) => { const r = h.monthly.find((x) => x.month === m); return <option key={m} value={m}>{Number(m.slice(0, 4))}년 {Number(m.slice(5, 7))}월 · 주간 제출 {weeksIn(m)}건{r ? (r.status === 'submitted' ? ' · 제출함' : ' · 초안') : ''}</option>; })}</select></Field>}
          {h.chat && h.chat.n > 0 && <p className="w-full text-xs text-ink-3" data-testid="branch-chat-count">올린 대화 {h.chat.n.toLocaleString('ko-KR')}건(가린 글){h.chat.last ? ` · 마지막 ${h.chat.last.slice(0, 16)}` : ''}</p>}
        </div>
        {mode === 'monthly' && siteId && curMonth && (detail.data?.report?.status === 'submitted' && detail.data.report.kind === 'monthly'
          ? <MonthlySubmitted r={detail.data.report} canReopen={detail.data.canReopen} onChange={reload} onEvidence={showEvidence} />
          : <>
            {h.canWrite && <MonthlyComposer key={`${siteId}:${curMonth}`} siteId={siteId} month={curMonth} weeks={weeksIn(curMonth)} hasDraft={!!rep} onDone={reload} />}
            {detail.data?.report?.kind === 'monthly' && <MonthlyEditor key={detail.data.report.id + detail.data.report.updated_at} r={detail.data.report} canWrite={detail.data.canWrite} onChange={reload} onEvidence={showEvidence} />}
            {!rep && !h.canWrite && <Empty title={`${siteName} ${Number(curMonth.slice(5, 7))}월 월간 보고서가 아직 없습니다`}>작성 담당이 초안을 만들면 여기서 볼 수 있습니다.</Empty>}
          </>)}
        {mode === 'weekly' && siteId && curDay && (detail.data?.report?.status === 'submitted'
          ? <Submitted r={detail.data.report} canReopen={detail.data.canReopen} onChange={reload} onEvidence={showEvidence} />
          : <>
            {h.canWrite && <Composer key={`${siteId}:${curDay}`} siteId={siteId} day={curDay} hasDraft={!!rep} onDone={reload} />}
            {detail.data?.report && <Editor key={detail.data.report.id + detail.data.report.updated_at} r={detail.data.report} canWrite={detail.data.canWrite} onChange={reload} onEvidence={showEvidence} />}
            {!rep && !h.canWrite && <Empty title={`${siteName} ${md(curDay)} 주간보고가 아직 없습니다`}>작성 담당이 초안을 만들면 여기서 볼 수 있습니다.</Empty>}
          </>)}
      </>}
      {setup && <Setup onClose={() => { setSetup(false); home.reload(); }} />}
      <Modal open={!!ev} onClose={() => setEv(null)} title="근거">
        <div className="space-y-2 text-sm" data-testid="branch-evidence">{!ev?.items ? <Loading /> : ev.items.map((x) => (
          <div key={x.ref} className="rounded-input border border-line p-2"><div className="text-xs text-ink-3">{x.ref} · {x.kind}{x.at ? ` · ${x.at}` : ''}{x.sender ? ` · ${x.sender}` : ''}</div><p className="mt-0.5 whitespace-pre-line">{x.text}</p></div>))}</div>
      </Modal>
    </div>
  );
}

/** 입력: 주간보고 글 붙여 넣기 + (선택) 대화 파일 → [초안 만들기] */
function Composer({ siteId, day, hasDraft, onDone }: { siteId: string; day: string; hasDraft: boolean; onDone: () => void }) {
  const [text, setText] = useState(''); const [useChat, setUseChat] = useState(true);
  const [busy, setBusy] = useState<'' | 'upload' | 'draft'>(''); const [up, setUp] = useState<string>('');
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy('upload');
    try {
      const list = await Promise.all(Array.from(files).slice(0, 5).map(async (f) => {
        if (f.size > 4_000_000) throw new Error(`${f.name}: 4MB 가 넘습니다 — 기간을 줄여 다시 내보내 주세요`);
        if (/\.zip$/i.test(f.name)) { const b = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let k = 0; k < b.length; k += 0x8000) s += String.fromCharCode(...b.subarray(k, k + 0x8000)); return { name: f.name, b64: btoa(s) }; }
        return { name: f.name, text: await f.text() };
      }));
      const r = await api<any>('/api/branch-reports/upload', { body: { siteId, files: list } });
      setUp(`대화 ${r.added.toLocaleString('ko-KR')}건을 가려서 넣었습니다(${r.from ?? '?'} ~ ${r.to ?? '?'} · 겹침 ${r.duplicates} · 사진 등 ${r.skipped})`); onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  };
  const draft = async () => {
    if (hasDraft && !(await askConfirm('이 주 초안을 새로 만들까요? 지금 고친 내용은 새 초안으로 바뀝니다.', { title: '초안 다시 만들기', ok: '다시 만들기' }))) return;
    setBusy('draft');
    try { const r = await api<any>('/api/branch-reports/draft', { body: { siteId, day, text, useChat } }); toast.ok(`초안을 만들었습니다${r.fixed ? ` — 근거가 약한 ${r.fixed}곳은 '확인 필요'로 바꿨습니다` : ''}`); setText(''); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  };
  return (
    <section className="space-y-2 rounded-card border border-line bg-white p-3 shadow-card" data-testid="branch-composer">
      <Field label="이번 주 주간보고 글(카톡에 올린 글 그대로 붙여 넣기)"><textarea className={cx(inputCls, 'min-h-[160px] font-mono text-[13px]')} value={text} onChange={(e) => setText(e.target.value)} placeholder={PLACEHOLDER} maxLength={20000} data-testid="branch-text" /></Field>
      <p className="text-xs text-ink-3">전화번호·동호수·주민번호·계좌·카드·차량번호·이메일은 AI 로 보내기 전에 가립니다. 원본 파일은 저장하지 않습니다.</p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-input border border-line px-2.5 py-1.5 hover:bg-slate-50" data-testid="branch-upload-label">
          {busy === 'upload' ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}대화 파일 올리기(선택 · txt·csv·zip)
          <input type="file" className="hidden" accept=".txt,.csv,.zip" multiple onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} data-testid="branch-upload" disabled={!!busy} /></label>
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={useChat} onChange={(e) => setUseChat(e.target.checked)} data-testid="branch-use-chat" />올린 대화도 근거로</label>
      </div>
      {up && <p className="text-xs text-brand-800" data-testid="branch-upload-result">{up}</p>}
      <div className="flex justify-end"><Button onClick={draft} disabled={!!busy} data-testid="branch-draft">{busy === 'draft' ? <Loader2 className="animate-spin" /> : <Sparkles />}{hasDraft ? '초안 다시 만들기' : '초안 만들기'}</Button></div>
    </section>
  );
}

/** 초안 고치기 — 표 칸을 바로 고침, 항목 더하기·빼기, 근거 보기, [저장]·[제출] */
function Editor({ r, canWrite, onChange, onEvidence }: { r: any; canWrite: boolean; onChange: () => void; onEvidence: (refs: string[]) => void }) {
  const [b, setB] = useState<Body>(r.body as Body); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  const set = (nb: Body) => { setB(nb); setDirty(true); };
  const need = countCheck(b);
  const save = async () => { setBusy(true); try { await api(`/api/branch-reports/${r.id}`, { method: 'PUT', body: b }); setDirty(false); toast.ok('저장했습니다'); onChange(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const submit = async () => {
    if (!(await askConfirm(`${r.unit_name} ${md(r.report_day)} 주간보고를 제출할까요?${need ? `\n\n'확인 필요'가 ${need}곳 남아 있습니다.` : ''}\n\n제출하면 잠기고, 고치려면 검토 담당·관리자의 [제출 취소]가 필요합니다.`, { title: '주간보고 제출', ok: '제출' }))) return;
    setBusy(true); try { if (dirty) await api(`/api/branch-reports/${r.id}`, { method: 'PUT', body: b }); await api(`/api/branch-reports/${r.id}/submit`, { body: {} }); toast.ok('제출했습니다'); onChange(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const inp = cx(inputCls, 'h-8 px-2 py-1 text-[13px]');
  const Ev = ({ refs }: { refs: string[] }) => refs.length ? <button type="button" onClick={() => onEvidence(refs)} className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-2 hover:bg-slate-200" data-testid="branch-ev">근거 {refs.length}</button> : <span className="shrink-0 text-[11px] text-amber-700">근거 없음</span>;
  const StateSel = ({ v, on }: { v: string; on: (s: string) => void }) => <select className={cx(inp, STATE_TONE[v])} value={v} onChange={(e) => on(e.target.value)} disabled={!canWrite} aria-label="처리 상태">{STATES.map((s) => <option key={s}>{s}</option>)}</select>;
  return (
    <section className="space-y-3 rounded-card border border-line bg-white p-3 shadow-card" data-testid="branch-editor">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b>{r.unit_name} {md(r.report_day)}(금) 초안</b><span className="text-xs text-ink-3">고친 시각 {fmtDateTime(r.updated_at)}</span>
        {need > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800" data-testid="branch-need">확인 필요 {need}곳 — 제출 전에 확인하세요</span>}
        <span className="ml-auto flex gap-3"><a href={`/branch-print/${r.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-ink-2 underline" data-testid="branch-print-link"><Printer className="size-3.5" />미리 보기·PDF</a>
          <a href={`/api/branch-reports/${r.id}/xlsx`} className="inline-flex items-center gap-1 text-xs text-ink-2 underline" data-testid="branch-xlsx-link"><FileDown className="size-3.5" />엑셀</a></span>
      </div>
      <h3 className="text-sm font-semibold">1. 이용 인원 현황</h3>
      {b.usage.map((x, k) => <div key={k} className="grid grid-cols-[minmax(0,1fr)_8rem_1rem] items-center gap-1.5"><input className={inp} value={x.item} onChange={(e) => set({ ...b, usage: b.usage.map((y, j) => j === k ? { ...y, item: e.target.value } : y) })} disabled={!canWrite} aria-label="항목" />
        <input className={cx(inp, x.count === '확인 필요' && '!border-amber-400 !bg-amber-50')} value={x.count} onChange={(e) => set({ ...b, usage: b.usage.map((y, j) => j === k ? { ...y, count: e.target.value } : y) })} disabled={!canWrite} aria-label="인원" data-testid="branch-usage-count" />
        {canWrite && <button type="button" onClick={() => set({ ...b, usage: b.usage.filter((_, j) => j !== k) })} aria-label="빼기" className="text-ink-3"><Trash2 className="size-4" /></button>}</div>)}
      {canWrite && <button type="button" className="inline-flex items-center gap-1 text-xs text-brand-700" onClick={() => set({ ...b, usage: [...b.usage, { item: '', count: '' }] })}><Plus className="size-3.5" />이용 항목</button>}
      <h3 className="text-sm font-semibold">락커 사용 현황(하이링크 관리자 화면 값 — 손으로)</h3>
      {b.lockers.map((x, k) => <div key={k} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_1rem] items-center gap-1.5"><input className={inp} value={x.name} placeholder="구분" onChange={(e) => set({ ...b, lockers: b.lockers.map((y, j) => j === k ? { ...y, name: e.target.value } : y) })} disabled={!canWrite} aria-label="락커 구분" />
        <input className={inp} value={x.used} placeholder="사용" onChange={(e) => set({ ...b, lockers: b.lockers.map((y, j) => j === k ? { ...y, used: e.target.value } : y) })} disabled={!canWrite} aria-label="사용" />
        <input className={inp} value={x.total} placeholder="전체" onChange={(e) => set({ ...b, lockers: b.lockers.map((y, j) => j === k ? { ...y, total: e.target.value } : y) })} disabled={!canWrite} aria-label="전체" />
        {canWrite && <button type="button" onClick={() => set({ ...b, lockers: b.lockers.filter((_, j) => j !== k) })} aria-label="빼기" className="text-ink-3"><Trash2 className="size-4" /></button>}</div>)}
      {canWrite && <button type="button" className="inline-flex items-center gap-1 text-xs text-brand-700" onClick={() => set({ ...b, lockers: [...b.lockers, { name: '', used: '', total: '' }] })}><Plus className="size-3.5" />락커 구분</button>}
      <h3 className="text-sm font-semibold">2. 시설 점검 보고</h3>
      {b.facilities.map((f, k) => {
        const setF = (nf: typeof f) => set({ ...b, facilities: b.facilities.map((y, j) => j === k ? nf : y) });
        return (
          <div key={k} className="space-y-1.5 rounded-input border border-line p-2" data-testid="branch-facility">
            <div className="grid grid-cols-2 items-center gap-1.5 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_1rem]"><input className={cx(inp, 'font-semibold')} value={f.name} placeholder="시설"  onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!canWrite} aria-label="시설" />
              <input className={cx(inp, f.visitors === '확인 필요' && '!border-amber-400 !bg-amber-50')} value={f.visitors} placeholder="총 이용인원" onChange={(e) => setF({ ...f, visitors: e.target.value })} disabled={!canWrite} aria-label="총 이용인원" />
              <input className={cx(inp, f.cleaning === '확인 필요' && '!border-amber-400 !bg-amber-50')} value={f.cleaning} placeholder="청소 상태" onChange={(e) => setF({ ...f, cleaning: e.target.value })} disabled={!canWrite} aria-label="청소 상태" />
              <input className={cx(inp, f.condition === '확인 필요' && '!border-amber-400 !bg-amber-50')} value={f.condition} placeholder="시설 상태" onChange={(e) => setF({ ...f, condition: e.target.value })} disabled={!canWrite} aria-label="시설 상태" />
              {canWrite && <button type="button" onClick={() => set({ ...b, facilities: b.facilities.filter((_, j) => j !== k) })} aria-label="시설 빼기" className="justify-self-end text-ink-3"><Trash2 className="size-4" /></button>}</div>
            {f.lines.map((l, j) => { const setL = (nl: Line) => setF({ ...f, lines: f.lines.map((y, i) => i === j ? nl : y) }); return (
              <div key={j} className="grid grid-cols-2 items-center gap-1.5 border-l-2 border-line pl-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_6.5rem_auto_1rem]">
                <input className={inp} value={l.item} placeholder="점검 항목" onChange={(e) => setL({ ...l, item: e.target.value })} disabled={!canWrite} aria-label="점검 항목" />
                <input className={inp} value={l.status} placeholder="상태" onChange={(e) => setL({ ...l, status: e.target.value })} disabled={!canWrite} aria-label="상태" />
                <input className={inp} value={l.action} placeholder="조치(예정이면 날짜)" onChange={(e) => setL({ ...l, action: e.target.value })} disabled={!canWrite} aria-label="조치" />
                <StateSel v={l.state} on={(s) => setL({ ...l, state: s })} /><Ev refs={l.evidence} />
                {canWrite && <button type="button" onClick={() => setF({ ...f, lines: f.lines.filter((_, i) => i !== j) })} aria-label="빼기" className="text-ink-3"><Trash2 className="size-3.5" /></button>}</div>); })}
            {canWrite && <button type="button" className="inline-flex items-center gap-1 pl-2 text-xs text-brand-700" onClick={() => setF({ ...f, lines: [...f.lines, { item: '', status: '', action: '', state: '확인 필요', evidence: [] }] })}><Plus className="size-3.5" />점검 항목</button>}
          </div>);
      })}
      {canWrite && <button type="button" className="inline-flex items-center gap-1 text-xs text-brand-700" onClick={() => set({ ...b, facilities: [...b.facilities, { name: '', visitors: '', cleaning: '', condition: '', lines: [] }] })}><Plus className="size-3.5" />시설</button>}
      <h3 className="text-sm font-semibold">3. 특이사항 · 건의사항 · 민원</h3>
      {b.issues.map((x, k) => { const setI = (ni: typeof x) => set({ ...b, issues: b.issues.map((y, j) => j === k ? ni : y) }); return (
        <div key={k} className="space-y-1 rounded-input border border-line p-2" data-testid="branch-issue">
          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_6.5rem_auto_1rem]"><input className={cx(inp, 'font-semibold')} value={x.title} placeholder="제목" onChange={(e) => setI({ ...x, title: e.target.value })} disabled={!canWrite} aria-label="제목" />
            <StateSel v={x.state} on={(s) => setI({ ...x, state: s })} /><Ev refs={x.evidence} />
            {canWrite && <button type="button" onClick={() => set({ ...b, issues: b.issues.filter((_, j) => j !== k) })} aria-label="빼기" className="text-ink-3"><Trash2 className="size-4" /></button>}</div>
          <textarea className={cx(inputCls, 'min-h-[56px] text-[13px]')} value={x.details.join('\n')} onChange={(e) => setI({ ...x, details: e.target.value.split('\n') })} disabled={!canWrite} aria-label="세부(한 줄에 하나)" />
        </div>); })}
      {canWrite && <button type="button" className="inline-flex items-center gap-1 text-xs text-brand-700" onClick={() => set({ ...b, issues: [...b.issues, { title: '', details: [], state: '확인 필요', evidence: [] }] })}><Plus className="size-3.5" />특이사항</button>}
      <Field label="메모"><textarea className={cx(inputCls, 'min-h-[48px] text-[13px]')} value={b.notes} onChange={(e) => set({ ...b, notes: e.target.value })} disabled={!canWrite} /></Field>
      {canWrite && <div className="flex justify-end gap-2"><Button variant="secondary" onClick={save} disabled={busy || !dirty} data-testid="branch-save">저장</Button><Button onClick={submit} disabled={busy} data-testid="branch-submit">제출</Button></div>}
    </section>
  );
}

/** 제출한 보고서 — 읽기 화면 · PDF · (관리자·검토 담당) 제출 취소 */
function Submitted({ r, canReopen, onChange, onEvidence }: { r: any; canReopen: boolean; onChange: () => void; onEvidence: (refs: string[]) => void }) {
  const refs = useMemo(() => { const b = r.body as Body; return [...b.facilities.flatMap((f) => f.lines.flatMap((l) => l.evidence)), ...b.issues.flatMap((x) => x.evidence)]; }, [r]);
  const undo = async () => {
    if (!(await askConfirm('제출을 취소하고 초안으로 되돌릴까요? 기록이 남습니다.', { title: '제출 취소', ok: '제출 취소', danger: true }))) return;
    try { await api(`/api/branch-reports/${r.id}/submit`, { method: 'DELETE' }); toast.ok('초안으로 되돌렸습니다'); onChange(); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <section className="space-y-3 rounded-card border border-line bg-white p-4 shadow-card" data-testid="branch-submitted">
      <div className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">제출함</span>
        <span className="text-xs text-ink-3">{r.submitted_by_name ?? ''} · {r.submitted_at ? fmtDateTime(r.submitted_at) : ''}{r.purged_at ? ' · 근거 글은 30일이 지나 지웠습니다' : ''}</span>
        <span className="ml-auto flex gap-2">{refs.length > 0 && !r.purged_at && <Button size="sm" variant="ghost" onClick={() => onEvidence(Array.from(new Set(refs)).slice(0, 30))}>근거 보기</Button>}
          <a href={`/branch-print/${r.id}`} target="_blank" className="inline-flex h-8 items-center gap-1 rounded-input border border-line px-2.5 text-sm" data-testid="branch-pdf"><Printer className="size-4" />PDF</a>
          <a href={`/api/branch-reports/${r.id}/xlsx`} className="inline-flex h-8 items-center gap-1 rounded-input border border-line px-2.5 text-sm" data-testid="branch-xlsx"><FileDown className="size-4" />엑셀</a>
          {canReopen && <Button size="sm" variant="secondary" onClick={undo} data-testid="branch-unsubmit">제출 취소</Button>}</span></div>
      <ReportView unit={r.unit_name} day={r.report_day} start={r.period_start} end={r.period_end} body={r.body as Body} />
    </section>
  );
}

/** 월간: 그 달 제출된 주간보고로 [월간 초안 만들기] */
function MonthlyComposer({ siteId, month, weeks, hasDraft, onDone }: { siteId: string; month: string; weeks: number; hasDraft: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const make = async () => {
    if (hasDraft && !(await askConfirm('이 달 월간 초안을 새로 만들까요? 지금 고친 내용은 새 초안으로 바뀝니다.', { title: '월간 초안 다시 만들기', ok: '다시 만들기' }))) return;
    setBusy(true);
    try { const r = await api<any>('/api/branch-reports/monthly', { body: { siteId, month } }); toast.ok(`주간보고 ${r.weeks}건으로 월간 초안을 만들었습니다${r.fixed ? ` — 근거가 약한 ${r.fixed}곳은 '확인 필요'로 표시했습니다` : ''}`); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-white p-3 text-sm shadow-card" data-testid="branch-monthly-composer">
      <p className="min-w-[200px] flex-1 text-ink-2">{weeks ? `이 달 제출된 주간보고 ${weeks}건으로 만듭니다. 이용 인원·미완료는 주간보고 그대로 옮기고, 중요업무·진행사항·차월 목표만 AI 가 정리합니다.` : '이 달 제출된 주간보고가 없습니다 — 주간보고를 먼저 제출하세요.'}</p>
      <Button onClick={make} disabled={busy || !weeks} data-testid="branch-monthly-draft">{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{hasDraft ? '월간 초안 다시 만들기' : '월간 초안 만들기'}</Button>
    </section>
  );
}

/** 월간 고치기 — 양식 B 세 표 · 양식 C(전달·이번달 → 증감 자동) · 미완료 · 메모 */
function MonthlyEditor({ r, canWrite, onChange, onEvidence }: { r: any; canWrite: boolean; onChange: () => void; onEvidence: (refs: string[]) => void }) {
  const [b, setB] = useState<MonthlyBody>(r.body as MonthlyBody); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  const set = (nb: MonthlyBody) => { setB(nb); setDirty(true); };
  const need = b.important.filter((x) => x.check).length + b.progress.filter((x) => x.check).length;
  const save = async () => { setBusy(true); try { await api(`/api/branch-reports/${r.id}`, { method: 'PUT', body: b }); setDirty(false); toast.ok('저장했습니다'); onChange(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const submit = async () => {
    if (!(await askConfirm(`${r.unit_name} ${Number(r.period_start.slice(5, 7))}월 월간 보고서를 제출할까요?${need ? `\n\n근거가 약한 줄이 ${need}곳 남아 있습니다.` : ''}\n\n제출하면 잠기고, 고치려면 검토 담당·관리자의 [제출 취소]가 필요합니다.`, { title: '월간 보고서 제출', ok: '제출' }))) return;
    setBusy(true); try { if (dirty) await api(`/api/branch-reports/${r.id}`, { method: 'PUT', body: b }); await api(`/api/branch-reports/${r.id}/submit`, { body: {} }); toast.ok('제출했습니다'); onChange(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const inp = cx(inputCls, 'h-8 px-2 py-1 text-[13px]');
  const ta = cx(inputCls, 'min-h-[36px] px-2 py-1 text-[13px]');
  const warn = (on?: boolean) => on && '!border-amber-400 !bg-amber-50';
  const Ev = ({ refs }: { refs: string[] }) => refs.length ? <button type="button" onClick={() => onEvidence(refs)} className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-2 hover:bg-slate-200" data-testid="branch-ev">근거 {refs.length}</button> : <span className="shrink-0 text-[11px] text-amber-700">근거 없음</span>;
  const Del = ({ on }: { on: () => void }) => canWrite ? <button type="button" onClick={on} aria-label="빼기" className="text-ink-3"><Trash2 className="size-4" /></button> : null;
  const Add = ({ on, label }: { on: () => void; label: string }) => canWrite ? <button type="button" className="inline-flex items-center gap-1 text-xs text-brand-700" onClick={on}><Plus className="size-3.5" />{label}</button> : null;
  const calc = usageTotal(b.usage); const tot = b.usageTotal ?? { item: '전 시설 합계', prev: calc.prev, cur: calc.cur, diff: '', rate: '' }; const dt = delta(tot.prev, tot.cur);
  // #1106: C 는 하이링크 이용현황 파일에서 — 올리면 서버가 표를 읽어 채우고 원본을 첨부로 보관(못 읽어도 첨부)
  const [upBusy, setUpBusy] = useState(false);
  const uploadUsage = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 4_000_000) { toast.error('4MB 가 넘습니다'); return; }
    setUpBusy(true);
    try {
      if (dirty) await api(`/api/branch-reports/${r.id}`, { method: 'PUT', body: b }); // 고친 내용을 먼저 저장(올리면 화면을 다시 불러옴)
      const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000));
      const res = await api<any>(`/api/branch-reports/${r.id}/usage-file`, { body: { name: f.name, b64: btoa(bin) } });
      if (res.parsed) toast.ok(`하이링크 이용현황 ${res.parsed}줄을 읽었습니다${res.total ? ' (합계 줄 포함)' : ''}`); else toast.info('표를 읽지 못해 원본 파일을 첨부했습니다 — 값은 직접 넣거나 그대로 두세요');
      onChange();
    } catch (e: any) { toast.error(e.message); } finally { setUpBusy(false); }
  };
  // #1112: 하이링크 회원목록 엑셀 → 회원(이용권) 현황(서버가 집계만 저장, 이름·연락처·원본 저장 안 함)
  const [memBusy, setMemBusy] = useState(false);
  const uploadMembers = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 3_200_000) { toast.error('3MB 가 넘습니다'); return; }
    setMemBusy(true);
    try {
      if (dirty) await api(`/api/branch-reports/${r.id}`, { method: 'PUT', body: b });
      const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000));
      const res = await api<any>(`/api/branch-reports/${r.id}/member-file`, { body: { name: f.name, b64: btoa(bin) } });
      toast.ok(`회원목록을 집계했습니다 — 활성 이용권 ${res.active.toLocaleString('ko-KR')}건${res.excluded ? ` · 시험·직원 줄 ${res.excluded}건 제외` : ''}${res.prev ? '' : ' · 비교할 지난달 없음'}`);
      onChange();
    } catch (e: any) { toast.error(e.message); } finally { setMemBusy(false); }
  };
  const toggleExclude = async (on: boolean) => {
    const before = b; if (b.members) setB({ ...b, members: { ...b.members, exclude: on } }); // 바로 바뀌어 보이게(저장 표시는 건드리지 않음)
    setMemBusy(true);
    try { if (dirty) await api(`/api/branch-reports/${r.id}`, { method: 'PUT', body: before }); await api(`/api/branch-reports/${r.id}/member-file`, { method: 'PATCH', body: { exclude: on } }); onChange(); } catch (e: any) { setB(before); toast.error(e.message); } finally { setMemBusy(false); }
  };
  const removeUsage = async () => {
    if (!(await askConfirm('첨부한 하이링크 이용현황 파일을 뺄까요? 표에 채운 값은 그대로 둡니다.', { title: '첨부 빼기', ok: '빼기' }))) return;
    try { await api(`/api/branch-reports/${r.id}/usage-file`, { method: 'DELETE' }); toast.ok('첨부를 뺐습니다'); onChange(); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <section className="space-y-3 rounded-card border border-line bg-white p-3 shadow-card" data-testid="branch-monthly-editor">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b>{r.unit_name} {Number(r.period_start.slice(0, 4))}년 {Number(r.period_start.slice(5, 7))}월 월간 초안</b><span className="text-xs text-ink-3">고친 시각 {fmtDateTime(r.updated_at)}</span>
        {need > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800" data-testid="branch-monthly-need">근거 확인 {need}곳</span>}
        <span className="ml-auto flex gap-3"><a href={`/branch-print/${r.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-ink-2 underline" data-testid="branch-print-link"><Printer className="size-3.5" />미리 보기·PDF</a>
          <a href={`/api/branch-reports/${r.id}/xlsx`} className="inline-flex items-center gap-1 text-xs text-ink-2 underline" data-testid="branch-xlsx-link"><FileDown className="size-3.5" />엑셀</a></span>
      </div>
      <h3 className="text-sm font-semibold">■ 당월 중요업무 내역</h3>
      {b.important.map((x, k) => <div key={k} className="grid grid-cols-1 items-start gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_1rem]" data-testid="branch-monthly-important">
        <textarea className={cx(ta, warn(x.check))} value={x.work} placeholder="업무내용" onChange={(e) => set({ ...b, important: b.important.map((y, j) => j === k ? { ...y, work: e.target.value } : y) })} disabled={!canWrite} aria-label="업무내용" />
        <textarea className={cx(ta, warn(x.check))} value={x.result} placeholder="결과/산출물" onChange={(e) => set({ ...b, important: b.important.map((y, j) => j === k ? { ...y, result: e.target.value } : y) })} disabled={!canWrite} aria-label="결과/산출물" />
        <Ev refs={x.evidence} /><Del on={() => set({ ...b, important: b.important.filter((_, j) => j !== k) })} /></div>)}
      <Add label="중요업무" on={() => set({ ...b, important: [...b.important, { work: '', result: '', evidence: [], check: false }] })} />
      <h3 className="text-sm font-semibold">■ 업무 진행사항</h3>
      {b.progress.map((x, k) => { const setP = (p: Partial<typeof x>) => set({ ...b, progress: b.progress.map((y, j) => j === k ? { ...y, ...p } : y) }); return (
        <div key={k} className="grid grid-cols-2 items-start gap-1.5 rounded-input border border-line p-2 sm:grid-cols-[7rem_repeat(4,minmax(0,1fr))_auto_1rem]" data-testid="branch-monthly-progress">
          <input className={inp} value={x.week} onChange={(e) => setP({ week: e.target.value })} disabled={!canWrite} aria-label="주차" />
          <textarea className={cx(ta, warn(x.check))} value={x.task} placeholder="실천업무" onChange={(e) => setP({ task: e.target.value })} disabled={!canWrite} aria-label="실천업무" />
          <textarea className={cx(ta, warn(x.check))} value={x.focus} placeholder="중점 확인사항" onChange={(e) => setP({ focus: e.target.value })} disabled={!canWrite} aria-label="중점 확인사항" />
          <textarea className={cx(ta, warn(x.check))} value={x.result} placeholder="결과" onChange={(e) => setP({ result: e.target.value })} disabled={!canWrite} aria-label="결과" />
          <textarea className={ta} value={x.note} placeholder="비고" onChange={(e) => setP({ note: e.target.value })} disabled={!canWrite} aria-label="비고" />
          <Ev refs={x.evidence} /><Del on={() => set({ ...b, progress: b.progress.filter((_, j) => j !== k) })} /></div>); })}
      <Add label="주차" on={() => set({ ...b, progress: [...b.progress, { week: '', task: '', focus: '', result: '', note: '', evidence: [], check: false }] })} />
      <h3 className="text-sm font-semibold">■ 차월 업무목표 및 실천사항</h3>
      {b.next.map((x, k) => <div key={k} className="grid grid-cols-1 items-start gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1rem]">
        <textarea className={ta} value={x.goal} placeholder="업무목표" onChange={(e) => set({ ...b, next: b.next.map((y, j) => j === k ? { ...y, goal: e.target.value } : y) })} disabled={!canWrite} aria-label="업무목표" />
        <textarea className={ta} value={x.actions} placeholder="실천사항" onChange={(e) => set({ ...b, next: b.next.map((y, j) => j === k ? { ...y, actions: e.target.value } : y) })} disabled={!canWrite} aria-label="실천사항" />
        <Del on={() => set({ ...b, next: b.next.filter((_, j) => j !== k) })} /></div>)}
      <Add label="차월 목표" on={() => set({ ...b, next: [...b.next, { goal: '', actions: '' }] })} />
      <h3 className="text-sm font-semibold">■ 미완료(다음 달 확인) <span className="font-normal text-xs text-ink-3">— 주간보고에서 마지막 상태가 완료가 아닌 것</span></h3>
      {b.unfinished.length ? b.unfinished.map((x, k) => <div key={k} className="flex items-center gap-2 text-[13px]" data-testid="branch-monthly-unfinished">
        <span className="min-w-0 flex-1">{x.title}</span><span className={cx('shrink-0 text-xs', STATE_TONE[x.state])}>{x.state}</span><span className="shrink-0 text-xs text-ink-3">{x.since}~{x.lastWeek}</span>
        <Del on={() => set({ ...b, unfinished: b.unfinished.filter((_, j) => j !== k) })} /></div>) : <p className="text-xs text-ink-3">없음</p>}
      {b.resolved.length > 0 && <p className="text-xs text-ink-3" data-testid="branch-monthly-resolved">이 달 안에 완료로 바뀐 것: {b.resolved.map((x) => `${x.title}(${x.doneWeek})`).join(' · ')}</p>}
      <h3 className="text-sm font-semibold">시설별 이용 현황 <span className="font-normal text-xs text-ink-3">— 하이링크 이용현황(PDF·엑셀)을 올리면 표를 읽어 채웁니다(값은 원문 그대로)</span></h3>
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="branch-usage-file">
        {canWrite && <label className={cx('inline-flex cursor-pointer items-center gap-1.5 rounded-input border border-line px-2.5 py-1.5 hover:bg-slate-50', upBusy && 'opacity-60')}>
          {upBusy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}하이링크 이용현황 올리기
          <input type="file" className="hidden" accept=".pdf,.xlsx,.csv" onChange={(e) => { void uploadUsage(e.target.files?.[0]); e.target.value = ''; }} disabled={upBusy} data-testid="branch-usage-upload" /></label>}
        {b.usageFile ? <span className="text-xs text-ink-2" data-testid="branch-usage-file-name">첨부: <a className="underline" href={`/api/branch-reports/${r.id}/usage-file`}>{b.usageFile.name}</a> · {b.usageFile.parsed ? `${b.usageFile.rows}줄 읽음` : '표를 읽지 못함(원본 첨부)'}
          {canWrite && <button type="button" className="ml-2 text-ink-3 underline" onClick={removeUsage}>첨부 빼기</button>}</span>
          : <span className="text-xs text-amber-800">하이링크 이용현황을 올려 주세요</span>}
        {canWrite && (b.usageWeekly?.length ?? 0) > 0 && <button type="button" className="ml-auto text-xs text-ink-3 underline" onClick={() => set({ ...b, usage: b.usageWeekly!.map((x) => ({ ...x, diff: '', rate: '' })), usageTotal: null })} data-testid="branch-usage-weekly">주간 값으로 채우기(월말 기준)</button>}
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[420px] border-collapse text-[13px]" data-testid="branch-monthly-usage">
        <thead><tr className="text-left text-xs text-ink-3"><th className="py-1">시설</th><th>전달 인원</th><th>이번달 인원</th><th>증감</th><th>증감률</th><th /></tr></thead>
        <tbody>{b.usage.map((x, k) => { const d = delta(x.prev, x.cur); const setU = (p: Partial<typeof x>) => set({ ...b, usage: b.usage.map((y, j) => j === k ? { ...y, ...p } : y), ...('prev' in p || 'cur' in p ? { usageTotal: null } : {}) }); /* 값을 고치면 하이링크 합계 대신 계산한 합계 */ return (
          <tr key={k}><td className="py-0.5 pr-1"><input className={inp} value={x.item} onChange={(e) => setU({ item: e.target.value })} disabled={!canWrite} aria-label="시설" /></td>
            <td className="pr-1"><input className={cx(inp, 'w-24')} value={x.prev} onChange={(e) => setU({ prev: e.target.value, diff: '', rate: '' })} disabled={!canWrite} aria-label="전달 인원" /></td>
            <td className="pr-1"><input className={cx(inp, 'w-24')} value={x.cur} onChange={(e) => setU({ cur: e.target.value, diff: '', rate: '' })} disabled={!canWrite} aria-label="이번달 인원" /></td>
            <td className="whitespace-nowrap px-1">{x.diff || d.diff || '-'}</td><td className="whitespace-nowrap px-1">{x.rate || d.rate || '-'}</td><td><Del on={() => set({ ...b, usage: b.usage.filter((_, j) => j !== k), usageTotal: null })} /></td></tr>); })}
          {(b.usage.length > 0 || b.usageTotal) && <tr className="font-semibold"><td className="py-1">{tot.item || '전 시설 합계'}</td><td>{tot.prev || '-'}</td><td>{tot.cur || '-'}</td><td className="px-1">{tot.diff || dt.diff || '-'}</td><td className="px-1">{tot.rate || dt.rate || '-'}</td><td /></tr>}</tbody></table></div>
      <Add label="시설" on={() => set({ ...b, usage: [...b.usage, { item: '', prev: '', cur: '', diff: '', rate: '' }], usageTotal: null })} />
      <h3 className="text-sm font-semibold">회원(이용권) 현황 <span className="font-normal text-xs text-ink-3">— 하이링크 회원목록 엑셀을 올리면 묶음별·세대·부과 합계를 셉니다(이름·연락처는 읽지 않고, 파일은 보관하지 않음)</span></h3>
      <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="branch-member-file">
        {canWrite && <label className={cx('inline-flex cursor-pointer items-center gap-1.5 rounded-input border border-line px-2.5 py-1.5 hover:bg-slate-50', memBusy && 'opacity-60')}>
          {memBusy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}하이링크 회원목록 올리기
          <input type="file" className="hidden" accept=".xlsx" onChange={(e) => { void uploadMembers(e.target.files?.[0]); e.target.value = ''; }} disabled={memBusy} data-testid="branch-member-upload" /></label>}
        {b.members && <label className="inline-flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" checked={b.members.exclude} onChange={(e) => void toggleExclude(e.target.checked)} disabled={!canWrite || memBusy} data-testid="branch-member-exclude" />시험·직원 줄 제외({b.members.excluded}건 — 이용권명 &lsquo;테스트&rsquo;, 동 999·9999·111·빈칸)</label>}
      </div>
      {b.members ? <div className="text-[13px]"><MembersSection m={b.members} title={false} /></div> : <p className="text-xs text-ink-3">아직 올린 회원목록이 없습니다.</p>}
      <Field label="메모"><textarea className={cx(inputCls, 'min-h-[48px] text-[13px]')} value={b.notes} onChange={(e) => set({ ...b, notes: e.target.value })} disabled={!canWrite} /></Field>
      {canWrite && <div className="flex justify-end gap-2"><Button variant="secondary" onClick={save} disabled={busy || !dirty} data-testid="branch-monthly-save">저장</Button><Button onClick={submit} disabled={busy} data-testid="branch-monthly-submit">제출</Button></div>}
    </section>
  );
}

/** 제출한 월간 보고서 — 읽기 화면 · PDF · 엑셀 · (관리자·검토 담당) 제출 취소 */
function MonthlySubmitted({ r, canReopen, onChange, onEvidence }: { r: any; canReopen: boolean; onChange: () => void; onEvidence: (refs: string[]) => void }) {
  const refs = useMemo(() => { const b = r.body as MonthlyBody; return Array.from(new Set([...b.important.flatMap((x) => x.evidence), ...b.progress.flatMap((x) => x.evidence)])); }, [r]);
  const undo = async () => {
    if (!(await askConfirm('제출을 취소하고 초안으로 되돌릴까요? 기록이 남습니다.', { title: '제출 취소', ok: '제출 취소', danger: true }))) return;
    try { await api(`/api/branch-reports/${r.id}/submit`, { method: 'DELETE' }); toast.ok('초안으로 되돌렸습니다'); onChange(); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <section className="space-y-3 rounded-card border border-line bg-white p-4 shadow-card" data-testid="branch-monthly-submitted">
      <div className="flex flex-wrap items-center gap-2 text-sm"><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">제출함</span>
        <span className="text-xs text-ink-3">{r.submitted_by_name ?? ''} · {r.submitted_at ? fmtDateTime(r.submitted_at) : ''}</span>
        <span className="ml-auto flex gap-2">{refs.length > 0 && <Button size="sm" variant="ghost" onClick={() => onEvidence(refs.slice(0, 30))}>근거 보기</Button>}
          <a href={`/branch-print/${r.id}`} target="_blank" className="inline-flex h-8 items-center gap-1 rounded-input border border-line px-2.5 text-sm" data-testid="branch-pdf"><Printer className="size-4" />PDF</a>
          <a href={`/api/branch-reports/${r.id}/xlsx`} className="inline-flex h-8 items-center gap-1 rounded-input border border-line px-2.5 text-sm" data-testid="branch-xlsx"><FileDown className="size-4" />엑셀</a>
          {canReopen && <Button size="sm" variant="secondary" onClick={undo} data-testid="branch-unsubmit">제출 취소</Button>}</span></div>
      <MonthlyView unit={r.unit_name} start={r.period_start} end={r.period_end} author={r.submitted_by_name ?? r.created_by_name ?? ''} reportDay={r.submitted_at ? String(r.submitted_at).slice(0, 10) : ''} body={r.body as MonthlyBody} />
    </section>
  );
}

/** 보고 지점 목록(관리자): 이름 한 번에 붙여 넣기 · 이름·숨김·작성 담당(자기 지점만)·검토 담당(전체) — 다짐 조직 단위는 건드리지 않음 */
type SiteRow = { key: string; id?: string; name: string; hidden: boolean; writer: string; reviewer: string; reports: number };
function Setup({ onClose }: { onClose: () => void }) {
  const s = useApi<{ sites: any[]; users: { id: string; name: string; title: string | null }[] }>('/api/branch-reports/setup');
  const [rows, setRows] = useState<SiteRow[] | null>(null);
  const [names, setNames] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (s.data && !rows) setRows(s.data.sites.map((x) => ({ key: x.id, id: x.id, name: x.name, hidden: x.hidden, writer: x.writer_user_id ?? '', reviewer: x.reviewer_user_id ?? '', reports: x.reports }))); }, [s.data, rows]);
  const addNames = () => {
    const have = new Set((rows ?? []).map((r) => r.name.replace(/\s+/g, '')));
    const fresh = Array.from(new Set(names.split(/\n|·|,/).map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean))).filter((n) => !have.has(n.replace(/\s+/g, '')));
    setRows([...(rows ?? []), ...fresh.map((name, k) => ({ key: `n${Date.now()}${k}`, name, hidden: false, writer: '', reviewer: '', reports: 0 }))]); setNames('');
    toast.ok(fresh.length ? `${fresh.length}곳을 넣었습니다 — [저장]을 눌러야 반영됩니다` : '새로 넣을 이름이 없습니다(이미 있음)');
  };
  const set = (key: string, p: Partial<SiteRow>) => setRows((rows ?? []).map((r) => (r.key === key ? { ...r, ...p } : r)));
  const move = (k: number, d: number) => { if (!rows) return; const n = [...rows]; const j = k + d; if (j < 0 || j >= n.length) return; [n[k], n[j]] = [n[j], n[k]]; setRows(n); };
  const save = async () => {
    if (!rows) return; setBusy(true);
    try { await api('/api/branch-reports/setup', { method: 'PUT', body: { sites: rows.map((r) => ({ id: r.id, name: r.name, hidden: r.hidden, writerUserId: r.writer || null, reviewerUserId: r.reviewer || null })) } }); toast.ok('저장했습니다'); onClose(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const person = (v: string, on: (v: string) => void, label: string) => <select className={cx(inputCls, 'h-8 w-36 py-1 text-[13px]')} value={v} onChange={(e) => on(e.target.value)} aria-label={label}>
    <option value="">{label} 없음</option>{s.data!.users.map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? ` ${p.title}` : ''}</option>)}</select>;
  return (
    <Modal open onClose={onClose} title="보고 지점" wide>
      {!s.data || !rows ? <Loading /> : <div className="space-y-3 text-sm" data-testid="branch-setup">
        <p className="text-xs text-ink-3">조직 단위와 따로인 목록입니다. 작성 담당(지점 관리자)은 자기 지점만, 검토 담당은 모든 지점을 봅니다. 지점 관리자는 [사람 관리]에서 &lsquo;직원&rsquo;으로 초대한 뒤 여기서 작성 담당으로 고르세요.</p>
        <Field label="지점 이름 한 번에 넣기(한 줄에 하나)"><textarea className={cx(inputCls, 'min-h-[72px]')} value={names} onChange={(e) => setNames(e.target.value)} data-testid="branch-setup-names" /></Field>
        <div><Button size="sm" variant="secondary" onClick={addNames} disabled={!names.trim()} data-testid="branch-setup-add"><Plus />목록에 넣기</Button></div>
        {!rows.length ? <p className="text-xs text-ink-3">아직 지점이 없습니다.</p> : <ul className="max-h-[50vh] divide-y divide-line overflow-auto rounded-input border border-line">{rows.map((r, k) => (
          <li key={r.key} className="flex flex-wrap items-center gap-2 px-2 py-1.5" data-testid="branch-setup-site" data-name={r.name}>
            <span className="flex flex-col text-[10px] leading-none text-ink-3"><button type="button" onClick={() => move(k, -1)} aria-label="위로">▲</button><button type="button" onClick={() => move(k, 1)} aria-label="아래로">▼</button></span>
            <input className={cx(inputCls, 'h-8 min-w-[160px] flex-1 py-1 text-[13px]', r.hidden && 'text-ink-3')} value={r.name} maxLength={60} onChange={(e) => set(r.key, { name: e.target.value })} aria-label="지점 이름" />
            {person(r.writer, (v) => set(r.key, { writer: v }), '작성 담당')}
            {person(r.reviewer, (v) => set(r.key, { reviewer: v }), '검토 담당')}
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={r.hidden} onChange={(e) => set(r.key, { hidden: e.target.checked })} />숨김</label>
            {r.reports ? <span className="text-[11px] text-ink-3" title="보고서가 있는 지점은 지울 수 없습니다 — 숨김으로 두세요">보고서 {r.reports}</span>
              : <button type="button" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label="지점 빼기" className="text-ink-3"><Trash2 className="size-4" /></button>}
          </li>))}</ul>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>닫기</Button><Button onClick={save} disabled={busy || rows.some((r) => !r.name.trim())} data-testid="branch-setup-save">저장</Button></div>
      </div>}
    </Modal>
  );
}
