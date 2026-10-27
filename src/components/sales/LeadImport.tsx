'use client';
import { useEffect, useState } from 'react';
import { api } from '@/components/client';
import { Button, Modal, cx, inputCls, toast } from '@/components/ui';

/**
 * 205차(#461 ⑦ 가져오기, SALES_LEADS_REVAMP 4·5절): CSV 가져오기 '미리보기 → 중복 표시 → 반영'.
 * 서버 미리보기가 줄마다 겹침을 찾는다 — 이미 있음(같은 이름) · 파일 안 겹침(앞 줄과 같은 이름) · 같은 연락처(이름은 달라도 같은 사업자번호·전화·메일) · 비슷한 이름(앞 4자).
 * 줄마다 [합치기 → 그 거래처(빈 칸만 채움, 다른 값은 바꾸지 않고 메모 한 줄)] · [새로 만들기] · [건너뛰기].
 * 기본값: 이미 있음 = 채울 게 있으면 합치기, 없으면 건너뛰기 · 파일 안 겹침 = 건너뛰기 · 나머지 = 새로.
 * 같은 연락처를 기본 합치기로 두지 않는 까닭: 본사 대표번호·사업자번호를 여러 곳이 같이 쓸 수 있어, 잘못 합치면 거래처 하나가 사라진다(잘못 만든 중복은 지우면 됨)
 */
export type ImportRows = { file: string; rows: Record<string, unknown>[]; skipped: string[] };
type Match = { id: string; name: string; status: string | null; region: string | null; owner: string | null; by: string[]; fill: string[]; diff: string[]; memo: boolean };
type Kind = 'same' | 'file' | 'contact' | 'similar';
type Plan = { kind: Kind | 'new'; matches?: Match[]; dupOf?: number };
type Done = { created: number; merged: number; skipped: string[]; failed: { name: string; message: string }[] };
const KIND: Record<Kind, [string, string]> = { same: ['이미 있음', 'bg-amber-100 text-amber-900'], file: ['파일 안 겹침', 'bg-slate-100 text-ink-2'], contact: ['같은 연락처', 'bg-amber-50 text-amber-800'], similar: ['비슷한 이름', 'bg-blue-50 text-blue-800'] };
const BY: Record<string, string> = { name: '이름', bizNo: '사업자번호', phone: '전화', email: '메일' };
const btnCls = 'inline-flex min-h-[32px] items-center rounded-input border border-line bg-white px-2.5 text-xs font-medium';
function firstAct(p: Plan) {
  if (p.kind === 'same') { const m = (p.matches ?? []).find((x) => x.fill.length || x.memo); return m ? `m:${m.id}` : 'skip'; }
  return p.kind === 'file' ? 'skip' : 'new';
}
const mergeNote = (m: Match) => [m.fill.length ? `채움: ${m.fill.join('·')}` : '', m.memo ? '메모 덧붙임' : ''].filter(Boolean).join(' · ') || '바뀌는 것 없음';

export function LeadImportDialog({ data, onClose, onDone }: { data: ImportRows; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<{ rows: Plan[]; counts: Record<string, number> } | null>(null);
  const [acts, setActs] = useState<string[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState<Done | null>(null);
  useEffect(() => {
    let live = true;
    api<{ rows: Plan[]; counts: Record<string, number> }>('/api/sales/leads/import/preview', { body: { rows: data.rows } })
      .then((p) => { if (live) { setPlan(p); setActs(p.rows.map(firstAct)); } })
      .catch((e: any) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [data]);
  const decide = plan ? plan.rows.map((p, n) => [p, n] as const).filter(([p]) => p.kind !== 'new') : [];
  const fresh = plan ? data.rows.filter((_, n) => plan.rows[n]?.kind === 'new') : [];
  const tally = { new: acts.filter((a) => a === 'new').length, merge: acts.filter((a) => a.startsWith('m:')).length, skip: acts.filter((a) => a === 'skip').length };
  const setAll = (how: 'merge' | 'new' | 'skip') => setActs((cur) => cur.map((a, n) => {
    const p = plan?.rows[n]; if (!p || p.kind === 'new') return a;
    if (how !== 'merge') return how;
    const m = p.matches?.[0]; return m ? `m:${m.id}` : a;
  }));
  async function go() {
    setBusy(true); setErr('');
    try {
      const rows = data.rows.map((r, n) => { const a = acts[n] ?? 'new'; return a.startsWith('m:') ? { ...r, action: 'merge', mergeId: a.slice(2) } : { ...r, action: a }; });
      const r = await api<Done>('/api/sales/leads/import', { body: { rows } });
      setDone(r); toast.ok(`새로 ${r.created}건 · 합침 ${r.merged}건`); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="CSV 가져오기" wide>
      <div className="space-y-2 text-sm" data-testid="leads-import">
        {done ? <>
          <p data-testid="leads-import-done">새로 <b>{done.created}건</b> · 합침 <b>{done.merged}건</b> · 건너뜀 {done.skipped.length}건{done.failed.length ? ` · 못 가져옴 ${done.failed.length}건` : ''}</p>
          {done.failed.length > 0 && <ul className="max-h-32 overflow-y-auto text-xs text-red-700" data-testid="leads-import-failed">{done.failed.slice(0, 50).map((f, i) => <li key={i}>{f.name} — {f.message}</li>)}</ul>}
          {done.skipped.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-ink-3">건너뛴 이름</summary><p className="mt-1">{done.skipped.join(', ')}</p></details>}
        </> : <>
          <p>{data.file} — <b>{data.rows.length}줄</b>{data.skipped.length ? ` (거래처명이 없는 ${data.skipped.length}줄은 뺌)` : ''}</p>
          {!plan && !err && <p className="text-ink-3" data-testid="leads-import-wait">이미 있는 거래처와 겹치는지 보는 중…</p>}
          {plan && <>
            <p className="flex flex-wrap gap-1.5 text-xs" data-testid="leads-import-counts">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800">새로 {plan.counts.new ?? 0}</span>
              {(Object.keys(KIND) as Kind[]).map((k) => plan.counts[k] ? <span key={k} className={cx('rounded-full px-2 py-0.5', KIND[k][1])}>{KIND[k][0]} {plan.counts[k]}</span> : null)}
            </p>
            {decide.length > 0 && <>
              <div className="flex flex-wrap items-center gap-1.5 text-xs"><span className="text-ink-3">겹치는 {decide.length}줄 한 번에</span>
                <button type="button" className={btnCls} onClick={() => setAll('merge')} data-testid="leads-import-all-merge">첫 후보와 합치기</button>
                <button type="button" className={btnCls} onClick={() => setAll('new')} data-testid="leads-import-all-new">모두 새로</button>
                <button type="button" className={btnCls} onClick={() => setAll('skip')} data-testid="leads-import-all-skip">모두 건너뛰기</button></div>
              <ul className="max-h-[45vh] space-y-1.5 overflow-y-auto rounded-input border border-line p-2" data-testid="leads-import-dups">
                {decide.map(([p, n]) => { const r = data.rows[n]; const k = p.kind as Kind; const sub = [r.region, r.phone].filter(Boolean).map(String).join(' · ');
                  return (
                    <li key={n} className="rounded-input border border-line bg-white p-2 text-xs" data-testid="leads-import-row" data-kind={k}>
                      <div className="flex flex-wrap items-center gap-1.5"><b className="text-sm">{String(r.name)}</b>{sub && <span className="text-ink-3">{sub}</span>}<span className={cx('rounded-full px-1.5', KIND[k][1])}>{KIND[k][0]}</span></div>
                      {k === 'file' ? <p className="mt-0.5 text-ink-3">파일 안에 같은 이름 줄이 먼저 있습니다</p>
                        : <ul className="mt-1 space-y-0.5">{(p.matches ?? []).map((m) => (
                          <li key={m.id}><span className="font-medium">{m.name}</span>{m.status && <span className="ml-1 text-ink-3">{m.status}</span>}{m.owner && <span className="ml-1 text-ink-3">· {m.owner}</span>}
                            {m.by.length > 0 && <span className="ml-1 text-amber-800">· 같은 {m.by.map((b) => BY[b] ?? b).join('·')}</span>}
                            <span className="ml-1 text-ink-2">· 합치면 {mergeNote(m)}</span>
                            {m.diff.length > 0 && <span className="block text-ink-3">다른 값(바꾸지 않고 메모에): {m.diff.join(' · ')}</span>}</li>))}</ul>}
                      <select className={cx(inputCls, 'mt-1 !w-auto')} value={acts[n] ?? 'new'} onChange={(e) => { const v = e.target.value; setActs((cur) => cur.map((a, i) => (i === n ? v : a))); }} aria-label={`${String(r.name)} 처리`} data-testid="leads-import-act">
                        {(p.matches ?? []).map((m) => <option key={m.id} value={`m:${m.id}`}>합치기 → {m.name}</option>)}
                        <option value="new">새로 만들기</option><option value="skip">건너뛰기</option>
                      </select>
                    </li>); })}
              </ul></>}
            {fresh.length > 0 && <details className="text-xs" data-testid="leads-import-new"><summary className="cursor-pointer text-ink-2">새로 만들 {fresh.length}줄</summary>
              <ul className="mt-1 max-h-32 overflow-y-auto">{fresh.slice(0, 50).map((r, i) => <li key={i}>{String(r.name)}{r.region ? ` · ${String(r.region)}` : ''}</li>)}{fresh.length > 50 && <li className="text-ink-3">… 외 {fresh.length - 50}줄</li>}</ul></details>}
          </>}
        </>}
        {err && <p className="text-xs text-red-700" role="alert" data-testid="leads-import-error">{err}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {done ? <Button onClick={onClose}>닫기</Button> : <><Button variant="secondary" onClick={onClose}>취소</Button>
            <Button onClick={go} disabled={!plan || busy} data-testid="leads-import-go">가져오기 — 새로 {tally.new} · 합치기 {tally.merge} · 건너뛰기 {tally.skip}</Button></>}
        </div>
      </div>
    </Modal>
  );
}
