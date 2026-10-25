'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, cx, inputCls, toast } from '@/components/ui';

/** #235 ⓒ 사진 AI 설명 — 자료실 마케팅 사진을 AI 가 한 번 보고 한 줄 설명·태그·글자 여부를 답니다.
 *  시안 바탕(글자 없는 실사)·블로그 본문 사진 고르기·원고의 사진 설명에 쓰고, 판정이 틀리면 사진마다 고칩니다(자료실 태그 '글자없음'·'글자있음'·'쓰지않음').
 *  로컬 10/25: 글자 있음 = 바탕에서만 뺌(블로그 본문에는 씀) · 쓰지 않음 = 바탕·본문 모두 뺌 */
type VisionOk = { caption: string; scene: string; tags: string[]; kind: 'photo' | 'graphic' | 'screen' | 'illustration' | 'document'; text: 'none' | 'little' | 'much'; promo: boolean; seen: string; people: number; faces: boolean; quality: 'good' | 'ok' | 'poor' };
type Mark = 'none' | 'has' | 'skip';
type Item = { id: string; title: string; folder: string; tags: string[]; vision: VisionOk | { error: string; tries: number } | null; mark: Mark | null; cover: boolean; body: boolean; at: string };
type View = { total: number; described: number; pending: number; failed: number; cover: number; graphic: number; ai: boolean; perPhotoKrw: number; canEdit: boolean; items: Item[] };
const KIND: Record<VisionOk['kind'], string> = { photo: '실사', graphic: '글자 그래픽', screen: '화면 캡처', illustration: '그림', document: '문서' };
const TEXT: Record<VisionOk['text'], string> = { none: '글자 없음', little: '글자 조금', much: '글자 많음' };
const MARKED: Record<Mark | 'auto', string> = { auto: 'AI 판정대로 씁니다', none: '글자 없는 사진으로 고쳤습니다 — 시안 바탕으로 씁니다', has: '글자 있는 사진으로 고쳤습니다 — 시안 바탕에는 쓰지 않고 블로그 본문에는 씁니다', skip: '쓰지 않는 사진으로 표시했습니다 — 바탕·본문 모두 뺍니다' };
const ok = (v: Item['vision']): v is VisionOk => !!v && 'caption' in v;
const chip = 'rounded px-1.5 py-px text-[11px]';

export function MktPhotos() {
  const { data, error, reload } = useApi<View>('/api/marketing/photos');
  const [busy, setBusy] = useState('');
  /** 설명 없는 사진 전부(한 번에 25초씩 이어서) · ids = 그 사진 다시 설명 */
  async function describe(ids?: string[]) {
    setBusy(ids?.[0] ?? 'all'); let done = 0; let failed = 0;
    try {
      for (let k = 0; k < 20; k++) {
        const r = await api<{ done: number; failed: number; left: number; stopped: string | null }>('/api/marketing/photos/describe', { body: ids ? { ids, redo: true } : {} });
        done += r.done; failed += r.failed;
        if (r.stopped) { toast.error(`멈췄습니다 — ${r.stopped}`); break; }
        if (ids || !r.left || !(r.done + r.failed)) break;
      }
      if (done || failed) toast.ok(`사진 ${done}장을 설명했습니다${failed ? ` · 설명 못 함 ${failed}장` : ''}`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(''); reload(); }
  }
  async function mark(id: string, text: Mark | 'auto') {
    try { await api(`/api/marketing/photos/${id}`, { method: 'PATCH', body: { text } }); toast.ok(MARKED[text]); reload(); }
    catch (e) { toast.error((e as Error).message); }
  }
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="auto-photos">
      <h2 className="text-sm font-semibold">사진 AI 설명 <span className="font-normal text-ink-3">— 자료실 마케팅 사진을 AI 가 한 번 보고 한 줄 설명·태그·글자 여부를 답니다. 시안 바탕(글자 없는 실사)·블로그 본문 사진 고르기와 원고의 사진 설명에 씁니다.</span></h2>
      <p className="mt-2 text-sm" data-testid="photos-summary">마케팅 사진 {data.total}장 · 설명 {data.described}장 · 아직 {data.pending}장{data.failed ? ` · 설명 못 함 ${data.failed}장` : ''} · 시안 바탕으로 쓸 수 있는 사진 {data.cover}장 · 블로그 본문에 쓸 수 있는 사진 {data.total - data.graphic}장 · 쓰지 않는 사진(글자 그래픽·쓰지 않음 표시) {data.graphic}장</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {data.canEdit && <Button size="sm" onClick={() => describe()} disabled={!!busy || !data.ai || !(data.pending + data.failed)} data-testid="photos-describe">{busy === 'all' ? '설명하는 중…' : `설명 없는 사진 설명하기${data.pending + data.failed ? ` (${data.pending + data.failed}장)` : ''}`}</Button>}
        <span className="text-xs text-ink-3">{data.ai ? `사진 1장 약 ${data.perPhotoKrw < 1 ? '1원 미만' : `${data.perPhotoKrw}원`}(빠른 모델) · 새로 올린 마케팅 사진은 올리자마자, 남은 사진은 정기 실행마다 6장씩 설명합니다.` : 'AI 가 꺼져 있어 설명하지 않습니다.'}</span>
      </div>
      {!data.total && <p className="mt-2 text-xs text-ink-3">자료실(마케팅 공간)에 사진이 없습니다 — 매장·현장 실사를 올리면 시안과 블로그에 씁니다.</p>}
      {!!data.items.length && (
        <details className="mt-2 rounded-input border border-line p-2" data-testid="photos-list">
          <summary className="cursor-pointer text-xs font-medium">사진별 설명·판정 보기(최근 {data.items.length}장) — 틀리면 사진마다 고칠 수 있습니다</summary>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{data.items.map((it) => {
            const v = it.vision;
            return (
              <li key={it.id} className="min-w-0 rounded-input border border-line p-1.5 text-xs" data-testid="photo-item" data-cover={it.cover ? '1' : '0'} data-body={it.body ? '1' : '0'}>
                <img src={`/api/library/${it.id}/download?inline=1`} alt={ok(v) ? v.caption : it.title} loading="lazy" className="aspect-[4/3] w-full rounded bg-slate-100 object-cover" />
                <div className="mt-1 break-words font-medium" title={ok(v) ? v.scene : undefined} data-testid="photo-caption">{ok(v) ? v.caption : it.title}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {!v && <span className={cx(chip, 'bg-slate-100 text-ink-3')}>설명 아직</span>}
                  {v && !ok(v) && <span className={cx(chip, 'bg-amber-100 text-amber-800')} title={v.error}>설명 못 함</span>}
                  {ok(v) && <><span className={cx(chip, 'bg-slate-100 text-ink-2')}>{KIND[v.kind]}</span><span className={cx(chip, 'bg-slate-100 text-ink-2')}>{TEXT[v.text]}</span>
                    {v.promo && <span className={cx(chip, 'bg-red-50 text-red-700')}>홍보물</span>}{v.faces && <span className={cx(chip, 'bg-amber-50 text-amber-800')} title="얼굴을 알아볼 수 있는 사람이 있어 시안 바탕으로는 자동으로 쓰지 않습니다">얼굴 보임</span>}
                    {v.quality === 'poor' && <span className={cx(chip, 'bg-amber-50 text-amber-800')}>흐림·어두움</span>}</>}
                  {it.cover ? <span className={cx(chip, 'bg-emerald-50 text-emerald-700')} data-testid="photo-cover">시안 바탕 가능</span>
                    : !it.body ? <span className={cx(chip, 'bg-red-50 text-red-700')} data-testid="photo-skip">쓰지 않음</span> : <span className={cx(chip, 'bg-violet-50 text-violet-700')}>블로그 본문 가능</span>}
                </div>
                {ok(v) && !!v.tags.length && <div className="mt-1 break-words text-ink-3">{v.tags.map((t) => `#${t}`).join(' ')}</div>}
                {data.canEdit && (
                  <div className="mt-1 flex items-center gap-1">
                    <span className="min-w-0 flex-1"><select className={cx(inputCls, 'h-7 py-0 text-[11px]')} value={it.mark ?? 'auto'} onChange={(e) => mark(it.id, e.target.value as Mark | 'auto')} aria-label={`${it.title} 글자 판정`} data-testid="photo-mark">
                      <option value="auto">AI 판정대로</option><option value="none">글자 없음 — 바탕으로 씀</option><option value="has">글자 있음 — 바탕에만 안 씀</option><option value="skip">쓰지 않음 — 바탕·본문 모두</option></select></span>
                    <button type="button" className="shrink-0 text-ink-3 underline disabled:opacity-50" disabled={!!busy || !data.ai} onClick={() => describe([it.id])} data-testid="photo-redo">{busy === it.id ? '…' : '다시'}</button>
                  </div>)}
              </li>);
          })}</ul>
        </details>)}
    </section>
  );
}
