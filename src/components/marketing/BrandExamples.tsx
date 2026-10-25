'use client';
import { useState } from 'react';
import { api } from '@/components/client';
import { Button, cx, inputCls, toast } from '@/components/ui';

/** #235 ⓔ 잘 된 예시 글(브랜드별·형식별 3개까지) — 같은 형식 원고가 구성·첫 줄 여는 방식·문단 길이·마무리를 참고(문장·숫자는 베끼지 않고, 그대로 쓰면 올리기 전 검사가 막음).
 *  여기서 붙여 넣거나, 승인·게시한 글 상세에서 [좋은 예시로 저장] */
export type Example = { kind: 'feed' | 'blog' | 'video' | 'story'; text: string; note?: string; contentId?: string; at?: string };
const KINDS: [Example['kind'], string][] = [['feed', '피드·페이스북·스레드'], ['blog', '블로그'], ['video', '릴스·쇼츠'], ['story', '스토리']];
const PER = 3;

export function BrandExamples({ brand, onSaved }: { brand: { id: string; name: string; examples?: Example[] | null }; onSaved: () => void }) {
  const list = brand.examples ?? [];
  const [kind, setKind] = useState<Example['kind']>('feed'); const [text, setText] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  async function save(next: Example[], msg: string) {
    setBusy(true);
    try { await api(`/api/marketing/auto/brands/${brand.id}`, { method: 'PATCH', body: { examples: next } }); toast.ok(msg); onSaved(); return true; }
    catch (e) { toast.error((e as Error).message); return false; } finally { setBusy(false); }
  }
  async function add() {
    const label = KINDS.find(([k]) => k === kind)![1];
    if (list.filter((e) => e.kind === kind).length >= PER) { toast.error(`${label} 예시는 ${PER}개까지입니다 — 하나를 빼고 넣어 주세요`); return; }
    if (await save([...list, { kind, text: text.trim(), ...(note.trim() ? { note: note.trim() } : {}) }], '예시 글을 넣었습니다 — 다음 원고부터 참고합니다')) { setText(''); setNote(''); }
  }
  return (
    <details className="rounded-input border border-line p-2 text-xs sm:col-span-4 sm:ml-[8.5rem]" data-testid={`brand-examples-${brand.name}`}>
      <summary className="cursor-pointer font-medium">잘 된 예시 글 <span className="font-normal text-ink-3">· {KINDS.map(([k, l]) => `${l} ${list.filter((e) => e.kind === k).length}`).join(' · ')}</span></summary>
      <p className="mt-1 text-ink-3">같은 형식 원고가 이 글의 구성·첫 줄 여는 방식·문단 길이·마무리를 참고합니다(형식마다 {PER}개). 문장을 그대로 옮기면 올리기 전 검사가 막습니다. 승인·게시한 글 상세의 [좋은 예시로 저장]으로도 넣을 수 있습니다.</p>
      {KINDS.map(([k, l]) => {
        const items = list.filter((e) => e.kind === k);
        return items.length ? (
          <div key={k} className="mt-2"><div className="font-medium text-ink-2">{l}</div>
            <ul className="mt-0.5 space-y-1">{items.map((e, n) => (
              <li key={n} className="flex items-start gap-2 rounded bg-slate-50 px-2 py-1" data-testid="brand-example">
                <span className="min-w-0 flex-1"><span className="line-clamp-2 whitespace-pre-wrap">{e.text}</span>
                  {e.note && <span className="block text-ink-3">좋은 점: {e.note}</span>}{e.contentId && <span className="block text-ink-3">승인·게시한 글에서 저장</span>}</span>
                <button type="button" className="shrink-0 text-ink-3 underline" disabled={busy} onClick={() => save(list.filter((x) => x !== e), '예시에서 뺐습니다')} data-testid="brand-example-remove">빼기</button>
              </li>))}</ul>
          </div>) : null;
      })}
      <div className="mt-2 grid gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          {/* inputCls 는 w-full 이라 폭은 감싼 칸으로 */}
          <span className="w-48 shrink-0"><select className={cx(inputCls, 'h-8 py-0 text-xs')} value={kind} onChange={(e) => setKind(e.target.value as Example['kind'])} aria-label="예시 형식" data-testid="brand-example-kind">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></span>
          <span className="min-w-40 flex-1"><input className={cx(inputCls, 'h-8 py-0 text-xs')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="좋은 점(선택) — 예: 첫 줄이 장면으로 시작" aria-label="좋은 점" data-testid="brand-example-note" /></span>
        </div>
        <textarea className={cx(inputCls, 'min-h-20 text-xs')} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="잘 된 글을 붙여 넣기(20자 이상) — 문장은 베끼지 않고 구성만 참고합니다" aria-label="예시 글" data-testid="brand-example-text" />
        <div><Button size="sm" onClick={add} disabled={busy || text.trim().length < 20} data-testid="brand-example-add">예시 넣기</Button></div>
      </div>
    </details>
  );
}
