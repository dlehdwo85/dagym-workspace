'use client';
import { useState } from 'react';
import { api } from '@/components/client';
import { Button, cx, inputCls, toast } from '@/components/ui';

export type Feed = { style?: string | null; templates?: string[]; palette?: { bg?: string | null; bg2?: string | null; accent?: string | null; text?: string | null } | null; header?: string | null; contact?: string | null; kicker?: string | null };
export type FeedCatalog = { templates: { id: string; label: string; desc: string; need: string | null }[]; styles: { id: string; label: string; templates: string[] }[] };
type Draw = { color: string | null; from: 'feed' | 'video' | 'brand' | 'company' | null };
type Shot = { template: string; label: string; desc: string; note: string | null; src: string };
const FROM: Record<string, string> = { feed: '피드 틀 바탕(이 칸)', video: '영상 끝 화면 배경색', brand: '브랜드 색', company: '회사 정보(디자인 설정)의 기본 브랜드 색' };
const PALETTE = [['bg', '바탕'], ['bg2', '보조'], ['accent', '포인트'], ['text', '글자']] as const;

/** #544(대표 10/24 '브랜드별 레퍼런스와 비교해 개선'): 브랜드 키트 '피드 틀' — 서버가 그리는 자동 시안의 틀(3~4종 돌려 씀)·색·머리줄·아래 연락처 줄.
 *  틀을 하나 이상 고르고 저장하면 이 브랜드의 정기 자동 시안은 초안 보관 없이 승인함으로 감. 바탕 색은 시안 그림·제작 프롬프트·카드뉴스가 모두 먼저 읽는 한 곳 */
export function BrandFeedKit({ brand, catalog, onSaved }: { brand: { id: string; name: string; feed?: Feed | null; draw?: Draw | null }; catalog: FeedCatalog; onSaved: () => void }) {
  const init = brand.feed ?? {};
  const [f, setF] = useState<Feed>({ style: init.style ?? null, templates: init.templates ?? [], palette: { ...(init.palette ?? {}) }, header: init.header ?? '', contact: init.contact ?? '', kicker: init.kicker ?? '' });
  const [shots, setShots] = useState<Shot[] | null>(null); const [busy, setBusy] = useState<'' | 'preview' | 'save'>('');
  const pal = f.palette ?? {}; const chosen = new Set(f.templates ?? []);
  const draw = brand.draw ?? { color: null, from: null };
  const eff = (k: string) => (pal as Record<string, string | null | undefined>)[k] ?? (k === 'bg' ? draw.color ?? '#1E293B' : k === 'text' ? '#FFFFFF' : k === 'accent' ? '#F5C451' : '#334155');
  const pickStyle = (id: string) => { const st = catalog.styles.find((x) => x.id === id); setF({ ...f, style: id || null, templates: st ? st.templates : f.templates }); setShots(null); };
  const toggle = (id: string) => { const n = new Set(chosen); if (n.has(id)) n.delete(id); else n.add(id); setF({ ...f, templates: catalog.templates.map((t) => t.id).filter((x) => n.has(x)) }); setShots(null); };
  const setPal = (k: string, v: string | null) => { setF({ ...f, palette: { ...pal, [k]: v } }); setShots(null); };
  const payload = () => ({ style: f.style || null, templates: f.templates ?? [], palette: Object.fromEntries(Object.entries(pal).filter(([, v]) => !!v)), header: f.header || null, contact: f.contact || null, kicker: f.kicker || null });
  async function preview() {
    setBusy('preview');
    try { const r = await api<{ images: Shot[] }>(`/api/marketing/auto/brands/${brand.id}/feed-preview`, { body: { feed: payload(), all: !(f.templates ?? []).length } }); setShots(r.images); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  async function save() {
    setBusy('save');
    try { await api(`/api/marketing/auto/brands/${brand.id}`, { method: 'PATCH', body: { feed: payload() } });
      toast.ok((f.templates ?? []).length ? `피드 틀 ${(f.templates ?? []).length}종을 저장했습니다 — 이제 ${brand.name} 자동 시안은 이 틀로 그려 승인함으로 갑니다` : '피드 틀을 비웠습니다 — 자동 시안은 다시 초안 보관(회사 설정이 켜져 있으면)'); onSaved(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  const sm = cx(inputCls, 'h-8 py-0 text-xs');
  return (
    <details className="text-xs sm:col-span-4 sm:pl-[8.5rem]" data-testid={`brand-feed-${brand.name}`}>
      <summary className="cursor-pointer py-1 font-medium text-ink" data-testid="brand-feed-summary">피드 틀(서버가 그리는 시안) — {(init.templates ?? []).length ? `${(init.templates ?? []).length}종 사용 중` : '아직 안 정함 · 정기 자동 시안은 초안 보관'}</summary>
      <div className="mt-2 grid gap-3 rounded-input border border-line p-3">
        <p className="flex flex-wrap items-center gap-1.5 text-ink-2" data-testid="brand-feed-draw">지금 시안 그림·제작 프롬프트가 쓰는 바탕 색
          <span className="inline-block size-4 rounded border border-line" style={{ background: draw.color ?? '#1E293B' }} aria-hidden /><b className="text-ink">{draw.color ?? '정하지 않음(진한 남색)'}</b>{draw.from && <span className="text-ink-3">— {FROM[draw.from]}</span>}</p>
        <label className="flex flex-wrap items-center gap-2">브랜드 성격
          <select className={cx(sm, 'w-auto min-w-64')} value={f.style ?? ''} onChange={(e) => pickStyle(e.target.value)} data-testid="brand-feed-style">
            <option value="">직접 고르기</option>{catalog.styles.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <span className="text-ink-3">고르면 그 성격의 틀이 켜집니다 — 아래에서 하나씩 켜고 끌 수 있어요</span></label>
        <fieldset className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="brand-feed-templates"><legend className="mb-1 text-ink-2">쓸 틀(돌려 씀 — 최근 3개 게시물과 같은 틀·같은 사진은 빼고)</legend>
          {catalog.templates.map((t) => <label key={t.id} className={cx('flex cursor-pointer items-start gap-2 rounded-input border px-2 py-1.5', chosen.has(t.id) ? 'border-violet-300 bg-violet-50/50' : 'border-line')}>
            <input type="checkbox" className="mt-0.5 size-4 accent-violet-600" checked={chosen.has(t.id)} onChange={() => toggle(t.id)} data-testid={`brand-feed-t-${t.id}`} />
            <span className="min-w-0"><b className="font-medium text-ink">{t.label}</b><span className="block text-ink-3">{t.desc}{t.need ? ` · ${t.need}` : ''}</span></span></label>)}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3" data-testid="brand-feed-palette">{PALETTE.map(([k, label]) => <label key={k} className="flex items-center gap-1">{label}
          <input type="color" className="h-8 w-10 cursor-pointer rounded border border-line" value={eff(k)} onChange={(e) => setPal(k, e.target.value.toUpperCase())} aria-label={`${brand.name} 피드 틀 ${label} 색`} data-testid={`brand-feed-${k}`} />
          {(pal as Record<string, string | null | undefined>)[k] ? <button type="button" className="text-ink-3 underline" onClick={() => setPal(k, null)}>자동</button> : <span className="text-ink-3">자동</span>}</label>)}</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className={sm} value={f.header ?? ''} maxLength={40} onChange={(e) => setF({ ...f, header: e.target.value })} placeholder="머리줄(왼쪽 위, 비우면 브랜드 이름)" aria-label={`${brand.name} 피드 머리줄`} data-testid="brand-feed-header" />
          <input className={sm} value={f.contact ?? ''} maxLength={80} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="아래 연락처 줄(예: 상담 전화 · 누리집 주소)" aria-label={`${brand.name} 피드 연락처 줄`} data-testid="brand-feed-contact" />
          <input className={sm} value={f.kicker ?? ''} maxLength={16} onChange={(e) => setF({ ...f, kicker: e.target.value })} placeholder="시리즈 머리말(예: 운영 기록)" aria-label={`${brand.name} 피드 머리말`} data-testid="brand-feed-kicker" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={preview} disabled={!!busy} data-testid="brand-feed-preview">{busy === 'preview' ? '그리는 중…' : (f.templates ?? []).length ? '고른 틀 미리보기' : '틀 12종 모두 미리보기'}</Button>
          <Button type="button" size="sm" onClick={save} disabled={!!busy} data-testid="brand-feed-save">{busy === 'save' ? '저장 중…' : '피드 틀 저장'}</Button>
          <span className="text-ink-3">틀을 하나 이상 고르고 저장하면 이 브랜드의 정기 자동 시안은 초안 보관 없이 이 틀로 그려 승인함으로 갑니다.</span>
        </div>
        {shots && <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="brand-feed-shots">{shots.map((s) => <li key={s.template} className="min-w-0" data-testid="brand-feed-shot">
          <img src={s.src} alt={`${s.label} 미리보기`} className="aspect-[4/5] w-full rounded-input border border-line object-cover" />
          <p className="mt-1 font-medium text-ink">{s.label}</p>{s.note && <p className="text-[11px] text-amber-800">{s.note}</p>}</li>)}</ul>}
      </div>
    </details>
  );
}
