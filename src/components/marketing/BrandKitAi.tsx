'use client';
import { useState } from 'react';
import { api } from '@/components/client';
import { Button, cx, inputCls, toast } from '@/components/ui';
import type { Facts } from './BrandFacts';
import type { Feed, FeedCatalog } from './BrandFeedKit';

/** 190차(대표 #689 '브랜드 키트를 AI 마케터가 자동 제작하는 버튼'): 브랜드 키트 [AI로 채우기] — 초안을 받아 칸마다 고르고 고쳐 [고른 칸 저장].
 *  이미 적힌 칸은 기본으로 그대로 둠(체크 해제) · 금지어·주제 풀은 지금 목록 뒤에 더함 · 사실 칸은 서버가 재료에서 찾은 값만 보냄(못 찾은 것은 '뺀 것'에 표시) ·
 *  표지 머리말은 후보만 — 고르지 않으면 지금처럼 AI 가 글마다 다르게(결정 15-26) */
type VoiceD = { topics: string; audience: string; offer: string; phrases: string[]; avoid: string[]; formality: 'polite' | 'casual' | 'mixed'; emoji: 'none' | 'few' | 'many'; emojis: string[]; examples: string[] };
type FactKey = 'phone' | 'link' | 'website' | 'address' | 'hours' | 'prices' | 'numbers' | 'keywords' | 'aliases';
type Draft = { intro: string; products: string; tone: string; bannedWords: string[]; voice: VoiceD; facts: Partial<Record<FactKey, string | string[]>>; topics: string[];
  feed: { style: string | null; templates: string[] }; color: { hex: string | null; from: 'current' | 'logo' | 'ai' | null }; kickers: string[] };
type Res = { draft: Draft; dropped: string[]; sources: { company: boolean; profiles: number; posts: number; docs: { id: string; title: string }[]; photos: number; logo: boolean } };
export type KitBrand = { id: string; name: string; tone: string | null; intro: string | null; products: string | null; banned_words: string[]; voice?: Record<string, unknown> | null;
  facts?: Facts | null; topic_pool?: string[] | null; feed?: Feed | null; draw?: { color: string | null; from: string | null } | null };

const FACTS: [FactKey, string, number][] = [['phone', '대표 전화', 40], ['link', '상담·예약 링크', 200], ['website', '누리집', 200], ['address', '주소', 200], ['hours', '운영 시간', 200],
  ['prices', '요금·혜택', 500], ['numbers', '써도 되는 숫자·근거', 1000], ['keywords', '블로그 검색 키워드', 200], ['aliases', '이 브랜드의 다른 이름', 200]];
const LISTS: FactKey[] = ['keywords', 'aliases'];
const FORMAL = { polite: '존댓말', casual: '반말', mixed: '존댓말 + 짧은 반말' } as const;
const EMO = { none: '이모지 안 씀', few: '이모지 1~2개', many: '이모지 자유롭게' } as const;
const COLOR_FROM = { current: '지금 정한 색 그대로', logo: '로고에서 뽑은 색', ai: 'AI 제안 — 로고·브랜드 색이 없어서' } as const;
const DRAW_FROM: Record<string, string> = { feed: '피드 틀 바탕', video: '영상 끝 화면', brand: '브랜드 색', company: '회사 기본 색' };
const csv = (a: unknown) => (Array.isArray(a) ? a.join(', ') : String(a ?? ''));
const fromCsv = (s: string) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];
const lines = (s: string) => [...new Set(s.split('\n').map((x) => x.trim()).filter(Boolean))];
const short = (s: string) => (s.length > 120 ? `${s.slice(0, 120)}…` : s);

export function BrandKitAi({ brand, catalog, onSaved }: { brand: KitBrand; catalog?: FeedCatalog | null; onSaved: () => Promise<void> | void }) {
  const [res, setRes] = useState<Res | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [kicker, setKicker] = useState('');
  const [busy, setBusy] = useState<'' | 'draft' | 'save'>('');
  const v0 = brand.voice ?? {}; const f0 = (brand.facts ?? {}) as Record<string, unknown>; const feed0 = brand.feed ?? {};
  const hasVoice = !!(v0.topics || v0.audience || v0.offer || (Array.isArray(v0.phrases) && v0.phrases.length));
  const tLabel = (id: string) => catalog?.templates.find((x) => x.id === id)?.label ?? id;

  async function draft() {
    setBusy('draft');
    try {
      const r = await api<Res>(`/api/marketing/auto/brands/${brand.id}/kit-draft`, { body: {} });
      const x = r.draft;
      const p: Record<string, boolean> = { intro: !!x.intro && !brand.intro, products: !!x.products && !brand.products, tone: !!x.tone && !brand.tone, banned: x.bannedWords.length > 0,
        voice: !hasVoice && !!(x.voice.audience || x.voice.topics || x.voice.offer), topics: x.topics.length > 0, feed: !!x.feed.style && !(feed0.templates ?? []).length,
        color: !!x.color.hex && x.color.from !== 'current' };
      for (const [k] of FACTS) p[`fact:${k}`] = !!csv(x.facts[k]).trim() && !csv(f0[k]).trim();
      setRes(r); setD(x); setPick(p); setKicker('');
      toast.ok('AI 초안을 만들었습니다 — 칸마다 확인하고 [고른 칸 저장]을 누르세요');
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(''); }
  }
  async function save() {
    if (!d) return;
    const on = (k: string) => !!pick[k];
    const body: Record<string, unknown> = {}; const fields: string[] = [];
    if (on('intro')) { body.intro = d.intro; fields.push('intro'); }
    if (on('products')) { body.products = d.products; fields.push('products'); }
    if (on('tone')) { body.tone = d.tone || null; fields.push('tone'); }
    if (on('banned')) { body.bannedWords = [...new Set([...brand.banned_words, ...d.bannedWords])].slice(0, 50); fields.push('bannedWords'); }
    if (on('voice')) { body.voice = { ...d.voice, examples: Array.isArray(v0.examples) ? v0.examples : d.voice.examples }; fields.push('voice'); }
    const fk = FACTS.filter(([k]) => on(`fact:${k}`));
    if (fk.length) { body.facts = { ...f0, ...Object.fromEntries(fk.map(([k]) => [k, LISTS.includes(k) ? fromCsv(csv(d.facts[k])) : csv(d.facts[k]).trim()])) }; fields.push(...fk.map(([k]) => `facts.${k}`)); }
    if (on('topics')) { body.topicPool = [...new Set([...(brand.topic_pool ?? []), ...d.topics])].slice(0, 40); fields.push('topicPool'); }
    if (on('feed') || on('color') || kicker) {
      const pal = Object.fromEntries(Object.entries(feed0.palette ?? {}).filter(([, x]) => !!x));
      body.feed = { style: on('feed') ? d.feed.style : feed0.style ?? null, templates: on('feed') ? d.feed.templates : feed0.templates ?? [],
        palette: { ...pal, ...(on('color') && d.color.hex ? { bg: d.color.hex } : {}) }, header: feed0.header || null, contact: feed0.contact || null, kicker: kicker || feed0.kicker || null };
      if (on('feed')) fields.push('feed'); if (on('color')) fields.push('color'); if (kicker) fields.push('kicker');
    }
    if (!fields.length) { toast.error('저장할 칸을 하나 이상 골라 주세요'); return; }
    setBusy('save');
    try {
      await api(`/api/marketing/auto/brands/${brand.id}`, { method: 'PATCH', body: { ...body, aiFill: fields.slice(0, 24) } });
      toast.ok(`${brand.name} 브랜드 키트 ${fields.length}칸을 저장했습니다 — 다음 원고부터 씁니다`);
      setRes(null); setD(null); await onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(''); }
  }

  const sm = cx(inputCls, 'h-8 py-0 text-xs'); const ta = cx(inputCls, 'min-h-16 text-xs');
  const count = Object.values(pick).filter(Boolean).length + (kicker ? 1 : 0);
  const row = (k: string, label: string, cur: string, body: React.ReactNode, note?: string) => (
    <div key={k} className={cx('grid gap-1 rounded-input border px-2 py-1.5 sm:grid-cols-[10rem_1fr]', pick[k] ? 'border-violet-300 bg-violet-50/40' : 'border-line')} data-testid={`kit-ai-row-${k}`}>
      <label className="flex cursor-pointer items-start gap-1.5 font-medium text-ink"><input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-violet-600" checked={!!pick[k]} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} data-testid={`kit-ai-pick-${k}`} />{label}</label>
      <div className="min-w-0 space-y-1">{body}
        <p className="break-words text-ink-3">지금: {cur.trim() ? short(cur) : '비어 있음'}</p>
        {note && <p className="text-amber-800">{note}</p>}</div>
    </div>);

  if (!d || !res) return (
    <div className="flex flex-wrap items-center gap-2 text-xs sm:col-span-4 sm:pl-[8.5rem]" data-testid={`brand-kit-ai-${brand.name}`}>
      <Button type="button" size="sm" variant="secondary" onClick={draft} disabled={!!busy} data-testid="brand-kit-ai">{busy === 'draft' ? 'AI 가 키트 초안을 만드는 중…' : 'AI로 채우기'}</Button>
      <span className="text-ink-3">회사 소개·이 브랜드 글·자료실 자료를 근거로 소개·상품·말투·금지어·사실 카드·주제·틀·색·머리말 후보를 한 번에 초안으로 — 확인한 칸만 저장합니다(AI 요청 1회).</span>
    </div>);

  const s = res.sources;
  const src = [s.company && '회사 소개', s.profiles > 0 && `회사 정보 ${s.profiles}곳`, `이 브랜드 승인·게시 글 ${s.posts}개`,
    s.docs.length > 0 && `자료실 문서 ${s.docs.length}개(${s.docs.map((x) => x.title).join(', ')})`, s.photos > 0 && `사진 설명 ${s.photos}장`, s.logo && '로고'].filter(Boolean).join(' · ');
  const vv = d.voice; const setV = (patch: Partial<VoiceD>) => setD({ ...d, voice: { ...vv, ...patch } });
  return (
    <div className="grid gap-2 rounded-input border border-violet-200 bg-white p-3 text-xs sm:col-span-4 sm:ml-[8.5rem]" data-testid="brand-kit-ai-panel">
      <p className="font-medium text-ink">{brand.name} — AI 키트 초안 <span className="font-normal text-ink-3">· 근거: {src}</span></p>
      {res.dropped.length > 0 && <div className="rounded-input bg-amber-50 px-2 py-1.5 text-amber-900" data-testid="kit-ai-dropped"><p className="font-medium">재료에서 확인하지 못해 뺀 것</p>
        <ul className="list-disc pl-4">{res.dropped.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      {row('intro', '브랜드 소개', brand.intro ?? '', <textarea className={ta} value={d.intro} maxLength={1000} onChange={(e) => setD({ ...d, intro: e.target.value })} aria-label="브랜드 소개 초안" data-testid="kit-ai-intro" />)}
      {row('products', '주력 상품·서비스', brand.products ?? '', <textarea className={ta} value={d.products} maxLength={1000} onChange={(e) => setD({ ...d, products: e.target.value })} aria-label="주력 상품 초안" data-testid="kit-ai-products" />)}
      {row('tone', '말투 한 줄', brand.tone ?? '', <input className={sm} value={d.tone} maxLength={200} onChange={(e) => setD({ ...d, tone: e.target.value })} aria-label="말투 초안" data-testid="kit-ai-tone" />)}
      {row('banned', '금지어', brand.banned_words.join(', '), <input className={sm} value={d.bannedWords.join(', ')} onChange={(e) => setD({ ...d, bannedWords: fromCsv(e.target.value) })} aria-label="금지어 초안(쉼표)" data-testid="kit-ai-banned" />,
        '저장하면 지금 금지어 뒤에 더합니다 — 과장·최상급·보장 표현은 근거가 없으면 원고와 올리기 전 검사가 막습니다')}
      {row('voice', '말투 프로필', hasVoice ? [v0.audience && `고객 ${v0.audience}`, v0.offer && `파는 것 ${v0.offer}`].filter(Boolean).join(' · ') || '있음' : '', (
        <div className="grid gap-1 sm:grid-cols-2">
          <input className={sm} value={vv.audience} maxLength={300} onChange={(e) => setV({ audience: e.target.value })} placeholder="고객" aria-label="고객" data-testid="kit-ai-voice-audience" />
          <input className={sm} value={vv.offer} maxLength={300} onChange={(e) => setV({ offer: e.target.value })} placeholder="파는 것" aria-label="파는 것" />
          <input className={sm} value={vv.topics} maxLength={300} onChange={(e) => setV({ topics: e.target.value })} placeholder="주로 다루는 주제" aria-label="주로 다루는 주제" />
          <input className={sm} value={vv.phrases.join(', ')} onChange={(e) => setV({ phrases: fromCsv(e.target.value).slice(0, 20) })} placeholder="자주 쓰는 말(쉼표)" aria-label="자주 쓰는 말" />
          <input className={sm} value={vv.avoid.join(', ')} onChange={(e) => setV({ avoid: fromCsv(e.target.value).slice(0, 30) })} placeholder="쓰지 않을 표현(쉼표)" aria-label="쓰지 않을 표현" />
          <span className="flex gap-1">
            <select className={cx(sm, 'w-auto')} value={vv.formality} onChange={(e) => setV({ formality: e.target.value as VoiceD['formality'] })} aria-label="존댓말">{Object.entries(FORMAL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select className={cx(sm, 'w-auto')} value={vv.emoji} onChange={(e) => setV({ emoji: e.target.value as VoiceD['emoji'] })} aria-label="이모지">{Object.entries(EMO).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </span>
        </div>), hasVoice ? '저장하면 지금 말투 프로필을 이 초안으로 바꿉니다(잘 된 글 예시는 그대로)' : undefined)}
      {FACTS.filter(([k]) => csv(d.facts[k]).trim() || csv(f0[k]).trim()).map(([k, label, max]) => row(`fact:${k}`, `사실 카드 · ${label}`, csv(f0[k]),
        <input className={sm} value={csv(d.facts[k])} maxLength={max} onChange={(e) => setD({ ...d, facts: { ...d.facts, [k]: LISTS.includes(k) ? fromCsv(e.target.value) : e.target.value } })} aria-label={`${label} 초안`} data-testid={`kit-ai-fact-${k}`} />))}
      {row('topics', `주제 풀 — 새 주제 ${d.topics.length}개`, (brand.topic_pool ?? []).length ? `${(brand.topic_pool ?? []).length}개` : '',
        <textarea className={cx(ta, 'min-h-28')} value={d.topics.join('\n')} onChange={(e) => setD({ ...d, topics: lines(e.target.value).slice(0, 40) })} aria-label="새 주제(한 줄에 하나)" data-testid="kit-ai-topics" />,
        '저장하면 지금 주제 풀 뒤에 더합니다(모두 40개까지)')}
      {row('feed', '피드 틀 성격', (feed0.templates ?? []).length ? (feed0.templates ?? []).map(tLabel).join(', ') : '', (
        <div className="space-y-1">
          <select className={cx(sm, 'w-auto min-w-60')} value={d.feed.style ?? ''} aria-label="피드 틀 성격" data-testid="kit-ai-style"
            onChange={(e) => { const st = catalog?.styles.find((x) => x.id === e.target.value); setD({ ...d, feed: { style: e.target.value || null, templates: st ? [...st.templates] : [] } }); }}>
            <option value="">고르지 않음</option>{(catalog?.styles ?? []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
          <p className="text-ink-2">쓸 틀: {d.feed.templates.length ? d.feed.templates.map(tLabel).join(' · ') : '없음'}</p>
        </div>), '저장하면 이 브랜드의 정기 자동 시안은 초안 보관 없이 이 틀로 그려 승인함으로 갑니다 — 틀은 아래 \'피드 틀\'에서 하나씩 켜고 끌 수 있어요')}
      {d.color.hex && row('color', '바탕 색', brand.draw?.color ? `${brand.draw.color}${brand.draw.from ? ` (${DRAW_FROM[brand.draw.from] ?? brand.draw.from})` : ''}` : '', (
        <span className="flex flex-wrap items-center gap-2">
          <input type="color" className="h-8 w-10 cursor-pointer rounded border border-line" value={d.color.hex} onChange={(e) => setD({ ...d, color: { ...d.color, hex: e.target.value.toUpperCase() } })} aria-label="바탕 색 초안" data-testid="kit-ai-color" />
          <b className="text-ink">{d.color.hex}</b><span className="text-ink-3">{d.color.from ? COLOR_FROM[d.color.from] : ''}</span>
        </span>), '시안 그림·제작 지시문·카드뉴스가 모두 이 색을 바탕으로 씁니다')}
      {d.kickers.length > 0 && <div className="rounded-input border border-line px-2 py-1.5" data-testid="kit-ai-kickers">
        <p className="font-medium text-ink">표지 머리말 후보 <span className="font-normal text-ink-3">— 고르지 않으면 지금처럼 AI 가 글마다 다르게 붙입니다. 하나를 고르면 모든 표지에 고정됩니다.</span></p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <button type="button" className={cx('rounded-full border px-2.5 py-1', !kicker ? 'border-violet-400 bg-violet-50 text-violet-900' : 'border-line')} aria-pressed={!kicker} onClick={() => setKicker('')} data-testid="kit-ai-kicker-none">고정하지 않음(AI 가 글마다)</button>
          {d.kickers.map((k) => <button key={k} type="button" className={cx('rounded-full border px-2.5 py-1', kicker === k ? 'border-violet-400 bg-violet-50 text-violet-900' : 'border-line')} aria-pressed={kicker === k} onClick={() => setKicker(k)} data-testid="kit-ai-kicker">{k}</button>)}
        </div></div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={!!busy || !count} data-testid="kit-ai-save">{busy === 'save' ? '저장 중…' : `고른 칸 저장 (${count}칸)`}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setD(null); setRes(null); }} disabled={!!busy} data-testid="kit-ai-close">닫기</Button>
        <Button type="button" size="sm" variant="ghost" onClick={draft} disabled={!!busy} data-testid="kit-ai-again">{busy === 'draft' ? '다시 만드는 중…' : '다시 만들기'}</Button>
        <span className="text-ink-3">체크한 칸만 저장합니다. 이미 적힌 칸은 처음에 체크하지 않았어요.</span>
      </div>
    </div>);
}
