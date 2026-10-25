'use client';
import { useState } from 'react';
import { api } from '@/components/client';
import { Button, cx, inputCls, toast } from '@/components/ui';

/** #426 ⑤ 브랜드 말투 프로필 — 모든 원고·자막(자동 제작·제작의뢰실·다듬기)이 읽음. [잘 된 글로 말투 만들기] = 최근 승인·게시 글로 AI 초안 → 보고 [저장] */
export type Voice = { topics: string; audience: string; phrases: string[]; avoid: string[]; formality: 'polite' | 'casual' | 'mixed'; emoji: 'none' | 'few' | 'many'; offer: string; examples: string[] };
const EMPTY: Voice = { topics: '', audience: '', phrases: [], avoid: [], formality: 'polite', emoji: 'few', offer: '', examples: [] };
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const filled = (v: Voice) => !!(v.topics || v.audience || v.offer || v.phrases.length || v.avoid.length || v.examples.length);

export function BrandVoice({ brand, onSaved }: { brand: { id: string; name: string; voice?: Partial<Voice> | null }; onSaved: () => void }) {
  const init = { ...EMPTY, ...(brand.voice ?? {}) } as Voice;
  const [v, setV] = useState<Voice>(init);
  const [phrases, setPhrases] = useState(init.phrases.join(', ')); const [avoid, setAvoid] = useState(init.avoid.join(', '));
  const [from, setFrom] = useState<string[] | null>(null); const [busy, setBusy] = useState(false);
  async function draft() {
    setBusy(true);
    try {
      const r = await api<{ draft: Voice; sources: { title: string }[] }>(`/api/marketing/auto/brands/${brand.id}/voice-draft`, { body: {} });
      setV(r.draft); setPhrases(r.draft.phrases.join(', ')); setAvoid(r.draft.avoid.join(', ')); setFrom(r.sources.map((x) => x.title));
      toast.ok('최근 글로 초안을 채웠습니다 — 확인하고 [저장]을 누르세요');
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true);
    try {
      await api(`/api/marketing/auto/brands/${brand.id}`, { method: 'PATCH', body: { voice: { ...v, phrases: list(phrases), avoid: list(avoid), examples: v.examples.map((x) => x.trim()).filter(Boolean).slice(0, 5) } } });
      toast.ok('말투 프로필을 저장했습니다 — 다음 원고부터 씁니다'); setFrom(null); onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  const ex = v.examples.length < 5 ? [...v.examples, ''] : v.examples;
  const small = cx(inputCls, 'h-8 py-0 text-xs');
  return (
    <details className="rounded-input border border-line p-2 text-xs sm:col-span-4 sm:ml-[8.5rem]" data-testid={`brand-voice-${brand.name}`}>
      <summary className="cursor-pointer font-medium">말투 프로필 <span className="font-normal text-ink-3">{filled(init) ? `· ${[init.audience, init.formality === 'casual' ? '반말' : init.formality === 'mixed' ? '존댓말+반말' : '존댓말'].filter(Boolean).join(' · ')}` : '(비어 있음 — 잘 된 글로 만들 수 있어요)'}</span></summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <input className={small} value={v.topics} onChange={(e) => setV({ ...v, topics: e.target.value })} maxLength={300} placeholder="주로 다루는 주제" aria-label="주제" data-testid="voice-topics" />
        <input className={small} value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value })} maxLength={300} placeholder="타겟(누구에게)" aria-label="타겟" data-testid="voice-audience" />
        <input className={small} value={v.offer} onChange={(e) => setV({ ...v, offer: e.target.value })} maxLength={300} placeholder="파는 것" aria-label="파는 것" data-testid="voice-offer" />
        <input className={small} value={phrases} onChange={(e) => setPhrases(e.target.value)} placeholder="자주 쓰는 말(쉼표)" aria-label="자주 쓰는 말" data-testid="voice-phrases" />
        <input className={small} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="절대 안 쓰는 표현(쉼표) — 금지어처럼 검사" aria-label="절대 안 쓰는 표현" data-testid="voice-avoid" />
        <div className="flex gap-2">
          <select className={small} value={v.formality} onChange={(e) => setV({ ...v, formality: e.target.value as Voice['formality'] })} aria-label="존댓말/반말" data-testid="voice-formality"><option value="polite">존댓말</option><option value="casual">반말</option><option value="mixed">존댓말+반말</option></select>
          <select className={small} value={v.emoji} onChange={(e) => setV({ ...v, emoji: e.target.value as Voice['emoji'] })} aria-label="이모지" data-testid="voice-emoji"><option value="none">이모지 안 씀</option><option value="few">이모지 1~2개</option><option value="many">이모지 자유</option></select>
        </div>
      </div>
      <div className="mt-2 space-y-1"><div className="text-ink-3">말투 예시 글(최대 5개 — 말투·리듬만 참고하고 내용·숫자는 베끼지 않습니다. 형식별 구성 예시는 위 &lsquo;잘 된 예시 글&rsquo;)</div>
        {ex.map((x, k) => <textarea key={k} className={cx(inputCls, 'min-h-14 text-xs')} value={x} maxLength={1500} placeholder={`예시 글 ${k + 1}`} aria-label={`예시 글 ${k + 1}`} data-testid="voice-example"
          onChange={(e) => { const next = [...ex]; next[k] = e.target.value; setV({ ...v, examples: next.filter((y, i) => y || i < next.length - 1) }); }} />)}
      </div>
      {from && <p className="mt-1 text-violet-800" data-testid="voice-draft-note">AI 초안 — 최근 글 {from.length}개({from.slice(0, 3).join(', ')}{from.length > 3 ? ' 등' : ''})에서 뽑았습니다. 확인하고 저장하면 다음 원고부터 씁니다.</p>}
      <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={draft} disabled={busy} data-testid="voice-draft">잘 된 글로 말투 만들기</Button><Button size="sm" onClick={save} disabled={busy} data-testid="voice-save">저장</Button></div>
    </details>
  );
}
