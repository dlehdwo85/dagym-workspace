'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, cx, inputCls, toast } from '@/components/ui';

/** #235 ⓒ 사진 AI 설명 — 자료실 사진을 AI 가 한 번 보고 한 줄 설명·태그·글자 여부를 답니다(188차: 마케팅 공간만 → 자료실 전체 + 영상 장면 사진).
 *  시안 바탕(글자 없는 실사)·블로그 본문 사진 고르기·원고의 사진 설명에 쓰고, 판정이 틀리면 사진마다 고칩니다(자료실 태그 '글자없음'·'글자있음'·'쓰지않음').
 *  로컬 10/25: 글자 있음 = 바탕에서만 뺌(블로그 본문에는 씀) · 쓰지 않음 = 바탕·본문 모두 뺌 */
type VisionOk = { caption: string; scene: string; tags: string[]; kind: 'photo' | 'graphic' | 'screen' | 'illustration' | 'document'; text: 'none' | 'little' | 'much'; promo: boolean; seen: string; people: number; faces: boolean; quality: 'good' | 'ok' | 'poor' };
type Mark = 'none' | 'has' | 'skip';
type Item = { id: string; title: string; folder: string; tags: string[]; vision: VisionOk | { error: string; tries: number } | null; mark: Mark | null; cover: boolean; body: boolean; at: string; space: string; scene: boolean;
  /** 189차: AI 생성(실사 참고) 사진 · [AI로 다시 만들기] 상태 */ gen: boolean; regen: { status: string; fileId: string | null } | null };
type Videos = { total: number; done: number; failed: number; skipped: number; frames: number; pending: number };
type BrandCount = { id: string; name: string; src: 'brand' | 'screen' | 'any'; strict: boolean; photos: number; cover: number; captures: number };
type View = { /** 287차 600장 상한 없이 센 숫자 */ all?: { total: number; described: number; faces: number; noBoxes: number };
  /** 288차 브랜드별 쓸 수 있는 사진 */ brands?: { list: BrandCount[]; unnamed: number; strict: boolean } | null; total: number; described: number; pending: number; failed: number; cover: number; graphic: number; outside: number; scenes: number; videos: Videos; ai: boolean; perPhotoKrw: number; canEdit: boolean; items: Item[];
  /** 189차 [AI로 다시 만들기] — 운영사 생성 연동이 켜져 있으면 ready · 장당 마케팅 크레딧 */ regen: { ready: boolean; credits: number | null } | null; gens: number };
type SceneRun = { done?: number; failed?: number; skipped?: number; frames?: number; described?: number; left?: number; busy?: boolean; via?: string };
const SPACE: Record<string, string> = { work: '업무 공간', sales: '영업 공간' };
const KIND: Record<VisionOk['kind'], string> = { photo: '실사', graphic: '글자 그래픽', screen: '화면 캡처', illustration: '그림', document: '문서' };
const TEXT: Record<VisionOk['text'], string> = { none: '글자 없음', little: '글자 조금', much: '글자 많음' };
const MARKED: Record<Mark | 'auto', string> = { auto: 'AI 판정대로 씁니다', none: '글자 없는 사진으로 고쳤습니다 — 시안 바탕으로 씁니다', has: '글자 있는 사진으로 고쳤습니다 — 시안 바탕에는 쓰지 않고 블로그 본문에는 씁니다', skip: '쓰지 않는 사진으로 표시했습니다 — 바탕·본문 모두 뺍니다' };
const ok = (v: Item['vision']): v is VisionOk => !!v && 'caption' in v;
const chip = 'rounded px-1.5 py-px text-[11px]';
const REGEN: Record<string, string> = { generating: '다시 만드는 중', done: '다시 만듦', failed: '다시 만들지 못함' };

export function MktPhotos() {
  const { data, error, reload } = useApi<View>('/api/marketing/photos');
  const [busy, setBusy] = useState('');
  /** 설명 없는 사진 전부(한 번에 25초씩 이어서) · ids = 그 사진 다시 설명 */
  async function describe(ids?: string[], faces = false) {
    setBusy(faces ? 'faces' : ids?.[0] ?? 'all'); let done = 0; let failed = 0;
    try {
      for (let k = 0; k < (faces ? 40 : 20); k++) {
        const r = await api<{ done: number; failed: number; left: number; stopped: string | null }>('/api/marketing/photos/describe', { body: faces ? { faces: true } : ids ? { ids, redo: true } : {} });
        done += r.done; failed += r.failed;
        if (r.stopped) { toast.error(`멈췄습니다 — ${r.stopped}`); break; }
        if (ids || !r.left || !(r.done + r.failed)) break;
      }
      if (done || failed) toast.ok(`사진 ${done}장을 설명했습니다${failed ? ` · 설명 못 함 ${failed}장` : ''}`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(''); reload(); }
  }
  /** 188차 [영상 장면 뽑기]: 자료실 영상 → 장면 사진 2~3장(+ 바로 AI 설명). 운영은 영상 합성 서버가 이어서 뽑음(1~2분 뒤 새로고침) */
  async function scenes() {
    setBusy('scenes');
    try {
      const r = await api<SceneRun>('/api/marketing/photos/scenes', { body: {} });
      if (r.via) toast.ok('영상 장면을 뽑기 시작했습니다 — 1~2분 뒤 새로고침하면 장면 사진이 보입니다');
      else if (r.busy) toast.error('다른 장면 뽑기가 돌고 있습니다 — 잠시 뒤 다시');
      else toast.ok(`영상 ${r.done ?? 0}편에서 장면 ${r.frames ?? 0}장을 뽑았습니다${r.described ? ` · 설명 ${r.described}장` : ''}${r.failed ? ` · 못 뽑음 ${r.failed}편` : ''}${r.left ? ` · 남은 영상 ${r.left}편` : ''}`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(''); reload(); }
  }
  /** 189차 #621 [AI로 다시 만들기]: 이 사진(얼굴 안 보이는 것)을 참고로 깨끗한 실사풍 한 장 — 원본은 그대로, 새 사진은 «마케팅/AI 생성(실사 참고)» */
  async function regen(it: Item) {
    const cr = data?.regen?.credits;
    if (!window.confirm(`이 사진을 참고로 AI 가 밝고 선명한 실사풍 사진을 한 장 새로 만듭니다${cr ? `(마케팅 크레딧 ${cr})` : ''}. 원본은 그대로 둡니다. 만들까요?`)) return;
    setBusy(`regen:${it.id}`);
    try { await api(`/api/marketing/photos/${it.id}/regen`, { body: {} }); toast.ok('다시 만들기를 시작했습니다 — 몇 분 뒤 «마케팅/AI 생성(실사 참고)» 폴더에 새 사진이 생깁니다'); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(''); reload(); }
  }
  async function mark(id: string, text: Mark | 'auto') {
    try { await api(`/api/marketing/photos/${id}`, { method: 'PATCH', body: { text } }); toast.ok(MARKED[text]); reload(); }
    catch (e) { toast.error((e as Error).message); }
  }
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="auto-photos">
      <h2 className="text-sm font-semibold">사진 AI 설명 <span className="font-normal text-ink-3">— 자료실 사진(폴더·공간 무관)과 영상 장면을 AI 가 한 번 보고 한 줄 설명·태그·글자 여부를 답니다. 시안 표지·카드뉴스 장·블로그 본문 사진 고르기와 원고의 사진 설명에 씁니다. 기밀 자료·기밀 폴더·격리 팀 자료는 쓰지 않고, 마케팅 공간 밖 사진은 AI 가 실사·얼굴 없음으로 본 것만 씁니다.</span></h2>
      <p className="mt-2 text-sm" data-testid="photos-summary">자료실 사진 {data.total}장{data.outside ? `(마케팅 공간 밖 ${data.outside}장)` : ''}{data.scenes ? ` · 영상 장면 ${data.scenes}장` : ''}{data.gens ? ` · AI 생성(실사 참고) ${data.gens}장` : ''} · 설명 {data.described}장 · 아직 {data.pending}장{data.failed ? ` · 설명 못 함 ${data.failed}장` : ''} · 시안 바탕으로 쓸 수 있는 사진 {data.cover}장 · 블로그 본문에 쓸 수 있는 사진 {data.total - data.graphic}장 · 쓰지 않는 사진(글자 그래픽·쓰지 않음 표시·설명 전 공간 밖 사진) {data.graphic}장</p>
      {data.all && (data.all.total > data.total || data.all.faces > 0) && <p className="mt-1 text-xs text-ink-3" data-testid="photos-all">
        {data.all.total > data.total ? `위 숫자는 최근 ${data.total}장 기준 — 전체 사진 ${data.all.total}장(설명 ${data.all.described}장). ` : ''}
        {data.all.faces ? `얼굴이 보이는 사진 ${data.all.faces}장 — ${data.all.noBoxes ? `그중 ${data.all.noBoxes}장은 예전에 설명해 얼굴 위치를 몰라 자동 시안·블로그 본문에서 가리지 못합니다([얼굴 위치 다시 읽기]를 누르면 다시 설명해 가림).` : '자동 시안·블로그 본문에서 얼굴을 모자이크합니다.'}` : ''}</p>}
      {!!data.brands?.list.length && <p className="mt-1 text-sm" data-testid="photos-brands">브랜드별 쓸 수 있는 사진: {data.brands.list.map((b, k) => <span key={b.id}>{k ? ' · ' : ''}<b className="font-medium">{b.name}</b> {b.src === 'screen' ? `화면 캡처 ${b.captures}장(실사 안 씀)` : `실사 ${b.photos}장(시안 바탕 ${b.cover}장)${b.captures ? ` · 화면 캡처 ${b.captures}장` : ''}`}</span>)}
        {data.brands.strict && data.brands.unnamed > 0 && <span className="ml-1 text-xs text-ink-3">— 어느 브랜드 이름도 없는 실사 {data.brands.unnamed}장은 시안에 쓰지 않습니다. 아래 «브랜드 이름 없는 사진 정리»에서 브랜드를 지정하거나 태그에 브랜드 이름을 달아 주세요(브랜드 키트 «시안에 쓸 사진»에서 바꿀 수 있음).</span>}</p>}
      {!!data.brands?.strict && data.brands.unnamed > 0 && <UnnamedPhotos count={data.brands.unnamed} onDone={reload} />}
      <p className="mt-1 text-sm" data-testid="photos-videos">자료실 영상 {data.videos.total}편 · 장면 뽑음 {data.videos.done}편(장면 사진 {data.videos.frames}장) · 아직 {data.videos.pending}편{data.videos.failed ? ` · 못 뽑음 ${data.videos.failed}편` : ''}{data.videos.skipped ? ` · AI·합성 영상 건너뜀 ${data.videos.skipped}편` : ''}
        <span className="ml-1 text-xs text-ink-3">— 영상마다 2초·가운데·끝 무렵 장면 2~3장을 사진으로 뽑아 «마케팅/영상 장면» 폴더에 둡니다(정기 실행이 이어서 뽑음).</span></p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {data.canEdit && <Button size="sm" onClick={() => describe()} disabled={!!busy || !data.ai || !(data.pending + data.failed)} data-testid="photos-describe">{busy === 'all' ? '설명하는 중…' : `설명 없는 사진 설명하기${data.pending + data.failed ? ` (${data.pending + data.failed}장)` : ''}`}</Button>}
        {data.canEdit && !!data.all?.noBoxes && <Button size="sm" variant="secondary" onClick={() => describe(undefined, true)} disabled={!!busy || !data.ai} data-testid="photos-faces">{busy === 'faces' ? '얼굴 위치 읽는 중…' : `얼굴 위치 다시 읽기 (${data.all.noBoxes}장 · 약 ${Math.max(1, Math.ceil(data.all.noBoxes * data.perPhotoKrw)).toLocaleString()}원)`}</Button>}
        {data.canEdit && <Button size="sm" variant="secondary" onClick={scenes} disabled={!!busy || !data.videos.pending} data-testid="photos-scenes">{busy === 'scenes' ? '장면 뽑는 중…' : `영상 장면 뽑기${data.videos.pending ? ` (${data.videos.pending}편)` : ''}`}</Button>}
        <span className="text-xs text-ink-3">{data.ai ? `사진 1장 약 ${data.perPhotoKrw < 1 ? '1원 미만' : `${data.perPhotoKrw}원`}(빠른 모델) · 새로 올린 마케팅 사진은 올리자마자, 남은 사진(다른 공간·영상 장면 포함)은 정기 실행마다 6장씩 설명합니다.` : 'AI 가 꺼져 있어 설명하지 않습니다.'}</span>
      </div>
      {!data.total && <p className="mt-2 text-xs text-ink-3">자료실에 사진이 없습니다 — 매장·현장 실사나 영상을 올리면 시안과 블로그에 씁니다.</p>}
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
                  {it.scene && <span className={cx(chip, 'bg-sky-50 text-sky-800')} data-testid="photo-scene">영상 장면</span>}
                  {it.gen && <span className={cx(chip, 'bg-amber-50 text-amber-800')} title="같은 브랜드 실사를 참고로 AI 가 만든 사진 — 실사가 모자랄 때만 쓰고, 사진 기록에 '생성'으로 남습니다" data-testid="photo-gen">AI 생성</span>}
                  {it.regen && REGEN[it.regen.status] && (it.regen.status === 'done' && it.regen.fileId
                    ? <a href={`/api/library/${it.regen.fileId}/download?inline=1`} target="_blank" rel="noopener" className={cx(chip, 'bg-emerald-50 text-emerald-800 underline')} data-testid="photo-regen-state">다시 만든 사진 보기</a>
                    : <span className={cx(chip, it.regen.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-violet-50 text-violet-700')} data-testid="photo-regen-state">{REGEN[it.regen.status]}</span>)}
                  {it.space !== 'marketing' && <span className={cx(chip, 'bg-slate-100 text-ink-2')} title="마케팅 공간 밖 사진 — AI 가 실사·홍보물 아님·얼굴 없음으로 본 것만 씁니다" data-testid="photo-space">{SPACE[it.space] ?? it.space}</span>}
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
                {data.canEdit && data.regen?.ready && !it.gen && ok(v) && !v.faces && it.regen?.status !== 'generating' && (
                  <button type="button" className={cx('mt-1 text-[11px] underline disabled:opacity-50', v.quality === 'poor' ? 'font-medium text-violet-800' : 'text-ink-3')} disabled={!!busy} onClick={() => regen(it)} data-testid="photo-regen">
                    {busy === `regen:${it.id}` ? '요청하는 중…' : `AI로 다시 만들기${data.regen.credits ? ` · 크레딧 ${data.regen.credits}` : ''}`}</button>)}
              </li>);
          })}</ul>
        </details>)}
    </section>
  );
}

type Unnamed = { brands: { id: string; name: string; suggested: number }[]; total: number; offset: number; canEdit: boolean;
  items: { id: string; title: string; folder: string; at: string; space: string; caption: string; suggest: { brandId: string; name: string; score: number; why: string[] } | null }[] };
/** 290차(로컬 10/31 14:50: 바디랩 쓸 사진 0장 · 이름 없는 실사 166장): 어느 브랜드 이름도 없는 실사를 보고 사람이 브랜드를 지정(태그) — 추천은 같이 올린 사진·같은 카톡 묶음·같은 폴더·브랜드 소개 낱말로만(자동 지정 안 함) */
function UnnamedPhotos({ count, onDone }: { count: number; onDone: () => void }) {
  const [open, setOpen] = useState(false); const [offset, setOffset] = useState(0);
  const { data, error, reload } = useApi<Unnamed>(open ? `/api/marketing/photos/unnamed?offset=${offset}` : null);
  const [pick, setPick] = useState<Set<string>>(new Set()); const [brand, setBrand] = useState(''); const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPick((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  async function assign(skip: boolean) {
    if (!pick.size || (!skip && !brand)) return;
    setBusy(true);
    try {
      const r = await api<{ updated: number; tag: string }>('/api/marketing/photos/assign', { body: { ids: [...pick], ...(skip ? { skip: true } : { brandId: brand }) } });
      toast.ok(skip ? `사진 ${r.updated}장을 쓰지 않음으로 표시했습니다` : `사진 ${r.updated}장에 '${r.tag}' 태그를 달았습니다 — 이제 ${r.tag} 시안에 씁니다`);
      setPick(new Set()); reload(); onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <details className="mt-2 rounded-input border border-line p-2" data-testid="photos-unnamed" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-xs font-medium">브랜드 이름 없는 사진 정리({count}장) — 추천을 보고 사람이 브랜드를 지정합니다(자동 지정 안 함)</summary>
      {error && <ErrorBox error={error} />}
      {data && (
        <div className="mt-2 grid gap-2">
          <p className="text-xs text-ink-3">추천 = 같이 올린 사진·같은 카톡 묶음 파일·같은 폴더에 브랜드 사진이 있거나, 사진 설명에 브랜드 키트 소개 낱말이 있을 때만. 지정하면 사진에 브랜드 이름 태그를 답니다(폴더는 그대로).
            {data.brands.filter((b) => b.suggested).map((b) => ` ${b.name} 추천 ${b.suggested}장`).join(' ·')}</p>
          {data.canEdit && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="photos-unnamed-bar">
              <span>{pick.size}장 고름</span>
              {data.brands.filter((b) => b.suggested).map((b) => <Button key={b.id} size="sm" variant="secondary" onClick={() => { setBrand(b.id); setPick(new Set(data.items.filter((x) => x.suggest?.brandId === b.id).map((x) => x.id))); }} data-testid={`photos-unnamed-pick-${b.name}`}>이 쪽의 «{b.name}» 추천 모두 고르기</Button>)}
              <select className={cx(inputCls, 'h-8 w-auto py-0 text-xs')} value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="지정할 브랜드" data-testid="photos-unnamed-brand">
                <option value="">브랜드 고르기</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <Button size="sm" onClick={() => assign(false)} disabled={busy || !pick.size || !brand} data-testid="photos-unnamed-assign">고른 {pick.size}장을 브랜드로 지정</Button>
              <Button size="sm" variant="secondary" onClick={() => assign(true)} disabled={busy || !pick.size} data-testid="photos-unnamed-skip">쓰지 않음으로</Button>
            </div>
          )}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{data.items.map((it) => (
            <li key={it.id} className={cx('rounded border p-1.5 text-xs', pick.has(it.id) ? 'border-brand-600 bg-brand-50' : 'border-line')} data-testid="photos-unnamed-item">
              <label className="block cursor-pointer">
                {data.canEdit && <input type="checkbox" className="mr-1 align-middle" checked={pick.has(it.id)} onChange={() => toggle(it.id)} aria-label={`${it.title} 고르기`} />}
                <img src={`/api/library/${it.id}/download?inline=1`} alt={it.caption || it.title} loading="lazy" className="mt-1 aspect-[4/3] w-full rounded bg-slate-100 object-cover" />
              </label>
              <p className="mt-1 line-clamp-2">{it.caption || it.title}</p>
              <p className="truncate text-ink-3" title={`${it.folder} · ${it.title}`}>{it.folder || '(폴더 없음)'} · {it.at.slice(0, 10)}</p>
              {it.suggest ? <p className="mt-0.5 rounded bg-amber-50 px-1 py-0.5 text-amber-900" data-testid="photos-unnamed-suggest">추천 {it.suggest.name} — {it.suggest.why.join(' · ')}</p> : <p className="mt-0.5 text-ink-3">추천 없음</p>}
            </li>))}</ul>
          {data.total > data.items.length && (
            <div className="flex items-center gap-2 text-xs">
              <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - 48)); setPick(new Set()); }}>앞 48장</Button>
              <span>{offset + 1}~{offset + data.items.length} / {data.total}장</span>
              <Button size="sm" variant="secondary" disabled={offset + data.items.length >= data.total} onClick={() => { setOffset(offset + 48); setPick(new Set()); }}>다음 48장</Button>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
