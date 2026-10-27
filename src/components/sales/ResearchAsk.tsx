'use client';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { api } from '@/components/client';
import { Button, Modal, cx, inputCls, toast } from '@/components/ui';

/**
 * 212차 #612 ③(대표 결정 10/25): 후속조사 업무 [완료] 때 곳마다 값을 적는 창 — 현 위탁사·계약만료일·관리사무소 번호·메모.
 * 비운 곳은 '확인 못함'(12주 뒤 다시 묶음에). [취소] = 완료하지 않음. 묶인 시설이 없거나 못 읽으면 묻지 않고 완료
 */
type Item = { id: number; srcId: string; name: string; region: string | null; households: number | null; missing: string[]; status: string; phone: string | null; operator: string | null;
  result: { operator?: string | null; contractEnd?: string | null; phone?: string | null; note?: string | null } };
type Data = { terms: { operator: string; office: string }; items: Item[] };
type Ask = 'ok' | 'skip' | null;

/** 쓰는 쪽: const rs = useResearchAsk(); if (await rs.ask(task) === null) return(완료 안 함) — 화면에 {rs.node} */
export function useResearchAsk() {
  const [state, setState] = useState<{ title: string; data: Data } | null>(null);
  const resolver = useRef<((v: Ask) => void) | null>(null);
  const ask = useCallback(async (t: { id: string; title: string; sales_ref?: { kind: string } | null }): Promise<Ask> => {
    if (t.sales_ref?.kind !== 'research') return 'skip';
    let data: Data;
    try { data = await api<Data>(`/api/sales/research?task=${t.id}`); } catch { return 'skip'; }
    if (!data.items?.length) return 'skip';
    return new Promise<Ask>((res) => { resolver.current = res; setState({ title: t.title, data }); });
  }, []);
  const finish = useCallback((v: Ask) => { resolver.current?.(v); resolver.current = null; setState(null); }, []);
  return { ask, node: state ? <ResearchDialog title={state.title} data={state.data} onDone={finish} /> : null };
}

function ResearchDialog({ title, data, onDone }: { title: string; data: Data; onDone: (v: Ask) => void }) {
  const T = data.terms;
  const [rows, setRows] = useState(() => data.items.map((x) => ({ id: x.id, operator: x.result.operator ?? '', contractEnd: x.result.contractEnd ?? '', phone: x.result.phone ?? '', note: x.result.note ?? '' })));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (i: number, k: 'operator' | 'contractEnd' | 'phone' | 'note', v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const filled = rows.filter((x) => x.operator.trim() || x.contractEnd || x.phone.trim()).length;
  async function save() {
    setBusy(true); setErr('');
    try {
      for (const x of rows) await api(`/api/sales/research/${x.id}`, { method: 'PATCH', body: { operator: x.operator.trim() || null, contractEnd: x.contractEnd || null, phone: x.phone.trim() || null, note: x.note.trim() || null } });
      toast.ok(`후속조사 ${rows.length}곳을 적었습니다 — 확인 ${filled}곳${rows.length - filled ? ` · 확인 못함 ${rows.length - filled}곳` : ''}`);
      onDone('ok');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={() => onDone(null)} title="조사한 값을 적고 완료" wide>
      <div className="space-y-3 text-sm" data-testid="research-ask">
        <p className="text-xs text-ink-2">‘{title}’을(를) 마칩니다. 곳마다 확인한 값을 적어 주세요 — 비워 둔 곳은 <b>확인 못함</b>으로 남고 12주 뒤 다시 조사 묶음에 들어옵니다.</p>
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
          {data.items.map((x, i) => (
            <li key={x.id} className="rounded-input border border-line p-2" data-testid="research-ask-row">
              <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs"><b className="text-sm text-ink">{x.name}</b>
                <span className="text-ink-3">{[x.region, x.households ? `${x.households}세대` : null, x.phone && `${T.office} ${x.phone}`].filter(Boolean).join(' · ')}</span>
                <Link href={`/s/sales/hub?tab=facilities&q=${encodeURIComponent(x.name)}`} target="_blank" className="ml-auto text-[11px] text-ink-3 underline">카드 보기</Link></div>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-[1fr_9.5rem_9.5rem]">
                <input className={cx(inputCls, 'h-8 text-xs')} value={rows[i].operator} onChange={(e) => set(i, 'operator', e.target.value)} maxLength={100} placeholder={x.operator ? `${T.operator}(지금 ${x.operator})` : T.operator} aria-label={T.operator} data-testid="research-ask-operator" />
                <input type="date" className={cx(inputCls, 'h-8 text-xs')} value={rows[i].contractEnd} onChange={(e) => set(i, 'contractEnd', e.target.value)} aria-label="계약만료일" title="계약만료일" data-testid="research-ask-end" />
                <input type="tel" className={cx(inputCls, 'h-8 text-xs')} value={rows[i].phone} onChange={(e) => set(i, 'phone', e.target.value)} maxLength={40} placeholder={`${T.office} 번호`} aria-label={`${T.office} 번호`} data-testid="research-ask-phone" />
              </div>
              <input className={cx(inputCls, 'mt-1.5 h-8 text-xs')} value={rows[i].note} onChange={(e) => set(i, 'note', e.target.value)} maxLength={500} placeholder="메모(선택) — 예: 직영 운영, 내년 3월 입찰 예정" aria-label="메모" data-testid="research-ask-note" />
            </li>))}
        </ul>
        {err && <p className="text-xs text-red-700" data-testid="research-ask-err">{err}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[11px] text-ink-3" data-testid="research-ask-count">확인 {filled}곳 · 확인 못함 {rows.length - filled}곳</span>
          <Button variant="secondary" onClick={() => onDone(null)} data-testid="research-ask-cancel">취소</Button>
          <Button onClick={save} disabled={busy} data-testid="research-ask-save">적고 완료</Button>
        </div>
      </div>
    </Modal>
  );
}
