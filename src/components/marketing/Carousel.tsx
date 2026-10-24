'use client';
import { useBackClose } from '@/components/backClose';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { MediaPick } from './MediaPick';
import { ScoreChip } from './QualityPanel';

/**
 * #499-5 카드뉴스 장별 생성기(자동 제작 › 카드뉴스): 제품·서비스 → [주제 후보 받기](A vs B · N가지 방법 · 유형별 추천 · 체크리스트)
 * → [장별 문구 만들기] → 장마다 고치기(사진·표·순서) + 서버가 그린 미리보기 → [이미지로 만들어 승인 요청](자료실 '마케팅/카드뉴스' + 인스타 승인 대기)
 */
const C = '#7C3AED';
type Pattern = 'vs' | 'howto' | 'types' | 'checklist';
type Template = 'box' | 'clean' | 'bold';
type Slide = { kind: 'cover' | 'body' | 'table' | 'cta'; title: string; body: string; rows: string[][]; imagePlan: string; imageId: string | null };
type Score = { score: number; pass: boolean; fails: string[]; notes?: string[] };
type Item = { id: string; brand_id: string | null; brand_name: string | null; product: string; topic: string; pattern: Pattern; input: { audience?: string; a?: string; b?: string; note?: string; changes?: string };
  slides: Slide[]; caption: string; keyword: string | null; template: Template; status: 'draft' | 'sent' | 'canceled'; source: 'ai' | 'template'; media_ids: string[]; content_id: string | null; content_status: string | null; content_version: number | null;
  rendered_at: string | null; created_by: string | null; created_by_name: string | null; created_at: string; updated_at: string; photos: Record<string, string>; check: { placeholders: number[]; banned: string[]; score: Score } };
type View = { items: Item[]; brands: { id: string; name: string; color: string | null; hasLogo: boolean }[]; patterns: Record<Pattern, string>; templates: Record<Template, string>; canDecide: boolean; userId: string; aiEnabled: boolean };
type Topic = { pattern: Pattern; topic: string; why: string; a: string; b: string; score: number };
const KIND: Record<Slide['kind'], string> = { cover: '표지', body: '본문', table: '표', cta: '마지막(CTA)' };
const STATUS: Record<string, [string, string]> = { draft: ['초안', 'bg-slate-100 text-ink-2'], sent: ['승인 요청함', 'bg-violet-50 text-violet-800'], canceled: ['취소', 'bg-slate-100 text-ink-3'] };
const CONTENT: Record<string, string> = { pending: '승인 대기', approved: '승인됨', changes: '수정 요청', hold: '보류', published: '게시됨' };
const PH = /\{\{[^}]*\}\}/;
const slideUrl = (it: Pick<Item, 'id' | 'updated_at'>, n: number) => `/api/marketing/carousels/${it.id}/slides/${n}?v=${encodeURIComponent(it.updated_at)}`;
const rowsText = (rows: string[][]) => rows.map((r) => r.join(' | ')).join('\n');
const parseRows = (t: string) => t.split('\n').map((l) => l.split('|').map((c) => c.trim()).slice(0, 3)).filter((r) => r.some(Boolean)).slice(0, 7);

export function CarouselStudio() {
  const { data, error, reload } = useApi<View>('/api/marketing/carousels');
  const [f, setF] = useState({ brandId: '', product: '', audience: '', a: '', b: '', note: '', keyword: '', topic: '', pattern: 'vs' as Pattern, template: 'box' as Template });
  const [topics, setTopics] = useState<{ list: Topic[]; source: string; aiError: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useBackClose(!!open, () => setOpen(null)); // #535: 휴대폰 뒤로가기 = 펼친 카드뉴스 편집만 닫힘
  useEffect(() => { if (data && !f.brandId && data.brands.length === 1) setF((x) => ({ ...x, brandId: data.brands[0].id })); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={5} />;
  const base = () => ({ brandId: f.brandId || null, product: f.product.trim(), audience: f.audience.trim() || undefined, a: f.a.trim() || undefined, b: f.b.trim() || undefined, note: f.note.trim() || undefined });
  async function getTopics() {
    if (f.product.trim().length < 2) { toast.error('제품·서비스를 적어 주세요'); return; }
    setBusy('topics');
    try { const r = await api<{ topics: Topic[]; source: string; aiError: string | null }>('/api/marketing/carousels/topics', { body: base() }); setTopics({ list: r.topics, source: r.source, aiError: r.aiError }); if (r.topics[0]) setF((x) => ({ ...x, topic: r.topics[0].topic, pattern: r.topics[0].pattern, a: x.a || r.topics[0].a, b: x.b || r.topics[0].b })); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault(); if (f.product.trim().length < 2 || f.topic.trim().length < 2) { toast.error('제품·서비스와 주제를 적어 주세요'); return; }
    setBusy('create');
    try {
      const r = await api<{ item: Item; aiError: string | null }>('/api/marketing/carousels', { body: { ...base(), topic: f.topic.trim(), pattern: f.pattern, keyword: f.keyword.trim() || undefined, template: f.template } });
      toast.ok(r.item.source === 'ai' ? `AI 마케터가 ${r.item.slides.length}장 문구를 썼습니다 — 고친 뒤 [이미지로 만들어 승인 요청]` : `AI 없이 빈 틀 ${r.item.slides.length}장을 만들었습니다 — {{ }} 를 채워 주세요`);
      setTopics(null); setF((x) => ({ ...x, topic: '', note: '' })); setOpen(r.item.id); await reload();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(null); }
  }
  const pick = (t: Topic) => setF((x) => ({ ...x, topic: t.topic, pattern: t.pattern, a: t.a || x.a, b: t.b || x.b }));
  const opened = data.items.find((x) => x.id === open) ?? null;
  return (
    <div className="space-y-4" data-testid="carousels">
      <p className="text-xs text-ink-2">제품·서비스를 적으면 AI 마케터가 주제 후보와 장별 문구·표·사진 계획을 쓰고, 우리 서버가 1080×1350 이미지로 그려 자료실(마케팅/카드뉴스)에 넣은 뒤 인스타 승인 요청을 올립니다. 외부 유료 생성은 쓰지 않습니다(AI 는 문구만 — 마케팅 AI 한도).</p>
      <form onSubmit={create} className="space-y-3 rounded-card border border-line bg-white p-4 shadow-card" data-testid="carousel-form">
        <h2 className="font-semibold">새 카드뉴스</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="브랜드"><select className={inputCls} value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })} data-testid="carousel-brand"><option value="">브랜드 없음</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="제품·서비스"><input className={inputCls} value={f.product} maxLength={120} onChange={(e) => setF({ ...f, product: e.target.value })} placeholder="예: 커뮤니티 위탁 운영" data-testid="carousel-product" /></Field>
          <Field label="대상(선택)"><input className={inputCls} value={f.audience} maxLength={60} onChange={(e) => setF({ ...f, audience: e.target.value })} placeholder="예: 입주를 앞둔 단지" data-testid="carousel-audience" /></Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="비교 A(선택)"><input className={inputCls} value={f.a} maxLength={30} onChange={(e) => setF({ ...f, a: e.target.value })} placeholder="A vs B 일 때" data-testid="carousel-a" /></Field>
          <Field label="비교 B(선택)"><input className={inputCls} value={f.b} maxLength={30} onChange={(e) => setF({ ...f, b: e.target.value })} data-testid="carousel-b" /></Field>
          <Field label="댓글 키워드(선택)"><input className={inputCls} value={f.keyword} maxLength={20} onChange={(e) => setF({ ...f, keyword: e.target.value })} placeholder="예: 비교표" data-testid="carousel-keyword" /></Field>
          <Field label="메모(선택)"><input className={inputCls} value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="강조할 점" data-testid="carousel-note" /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={getTopics} disabled={!!busy} data-testid="carousel-topics-btn">{busy === 'topics' ? '주제 찾는 중…' : '주제 후보 받기'}</Button>
          {!data.aiEnabled && <span className="text-xs text-ink-3">AI 가 꺼져 있어 기본 주제·빈 틀로 만듭니다</span>}
          {topics?.aiError && <span className="text-xs text-amber-800" data-testid="carousel-ai-error">AI 를 쓰지 못해 기본 주제로 — {topics.aiError}</span>}
        </div>
        {topics && <div className="grid gap-2 sm:grid-cols-2" data-testid="carousel-topics">{topics.list.map((t) => (
          <button key={t.pattern} type="button" onClick={() => pick(t)} className={cx('rounded-input border p-2.5 text-left text-sm transition-colors', f.topic === t.topic ? 'border-violet-400 bg-violet-50' : 'border-line hover:bg-slate-50')} data-testid="carousel-topic" data-pattern={t.pattern} aria-pressed={f.topic === t.topic}>
            <div className="flex items-center gap-1.5"><span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">{data.patterns[t.pattern]}</span><ScoreChip label="훅" score={t.score} pass={t.score >= 40} testId="carousel-topic-score" /></div>
            <div className="mt-1 font-semibold">{t.topic}</div>{t.why && <div className="mt-0.5 text-xs text-ink-2">{t.why}</div>}
          </button>))}</div>}
        <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
          <Field label="주제(표지 질문)"><input className={inputCls} value={f.topic} maxLength={80} onChange={(e) => setF({ ...f, topic: e.target.value })} placeholder="후보를 고르거나 직접 적어 주세요" data-testid="carousel-topic-input" /></Field>
          <Field label="유형"><select className={inputCls} value={f.pattern} onChange={(e) => setF({ ...f, pattern: e.target.value as Pattern })} data-testid="carousel-pattern">{(Object.keys(data.patterns) as Pattern[]).map((p) => <option key={p} value={p}>{data.patterns[p]}</option>)}</select></Field>
        </div>
        <TemplatePick value={f.template} onChange={(template) => setF({ ...f, template })} labels={data.templates} name="carousel-new-template" />
        <div className="flex justify-end"><Button type="submit" disabled={!!busy} data-testid="carousel-create">{busy === 'create' ? '장별 문구 쓰는 중…' : '장별 문구 만들기'}</Button></div>
      </form>

      <section className="space-y-2" data-testid="carousel-list">
        <h2 className="font-semibold">만든 카드뉴스</h2>
        {!data.items.length && <p className="rounded-card border border-dashed border-line p-4 text-sm text-ink-3" data-testid="carousel-empty">아직 없습니다 — 위에서 제품·서비스를 적고 [주제 후보 받기]부터 시작하세요.</p>}
        {data.items.map((it) => {
          const [l, cls] = STATUS[it.status] ?? [it.status, ''];
          return (
            <div key={it.id} className="rounded-card border border-line bg-white shadow-card" data-testid="carousel-item" data-status={it.status} data-id={it.id}>
              <div className="flex items-center gap-3 p-3">
                <img src={it.media_ids[0] ? `/api/library/${it.media_ids[0]}/download?inline=1` : slideUrl(it, 1)} alt="" loading="lazy" className="h-[70px] w-14 shrink-0 rounded bg-slate-100 object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{it.topic}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
                    <span className={cx('rounded-full px-2 py-0.5', cls)} data-testid="carousel-item-status">{l}</span>
                    {it.content_status && <span className="rounded-full bg-slate-100 px-2 py-0.5">{CONTENT[it.content_status] ?? it.content_status}{it.content_version && it.content_version > 1 ? ` v${it.content_version}` : ''}</span>}
                    <span>{data.patterns[it.pattern]} · {it.slides.length}장{it.brand_name ? ` · ${it.brand_name}` : ''} · {it.created_by_name ?? ''} {fmtDateTime(it.created_at)}</span>
                  </div>
                </div>
                {it.status !== 'canceled' && <Button size="sm" variant={open === it.id ? 'primary' : 'secondary'} onClick={() => setOpen(open === it.id ? null : it.id)} data-testid="carousel-open">{open === it.id ? '닫기' : '열기'}</Button>}
              </div>
              {opened?.id === it.id && <Editor key={it.id} it={opened} view={data} reload={reload} />}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function TemplatePick({ value, onChange, labels, name }: { value: Template; onChange: (t: Template) => void; labels: Record<Template, string>; name: string }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-3 text-sm" data-testid="carousel-template"><legend className="sr-only">틀</legend><span className="text-xs text-ink-2">틀</span>
      {(Object.keys(labels) as Template[]).map((t) => <label key={t} className="inline-flex items-center gap-1.5"><input type="radio" name={name} value={t} checked={value === t} onChange={() => onChange(t)} />{labels[t]}</label>)}
    </fieldset>
  );
}

type Draft = { topic: string; caption: string; keyword: string; template: Template; slides: (Slide & { rowsText: string })[] };
const toDraft = (it: Item): Draft => ({ topic: it.topic, caption: it.caption, keyword: it.keyword ?? '', template: it.template, slides: it.slides.map((s) => ({ ...s, rowsText: rowsText(s.rows) })) });
function Editor({ it, view, reload }: { it: Item; view: View; reload: () => Promise<void> }) {
  const [d, setD] = useState<Draft>(() => toDraft(it));
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  const [titles, setTitles] = useState<Record<string, string>>(it.photos);
  useEffect(() => { setD(toDraft(it)); setDirty(false); setTitles((x) => ({ ...x, ...it.photos })); }, [it.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = d.slides.length; const cur = Math.min(sel, n - 1);
  const set = (p: Partial<Draft>) => { setD((x) => ({ ...x, ...p })); setDirty(true); };
  const setSlide = (k: number, p: Partial<Draft['slides'][number]>) => set({ slides: d.slides.map((s, j) => (j === k ? { ...s, ...p } : s)) });
  const move = (k: number, dir: -1 | 1) => { const j = k + dir; if (j < 1 || j > n - 2) return; const s = [...d.slides]; [s[k], s[j]] = [s[j], s[k]]; set({ slides: s }); setSel(j); };
  const add = (kind: 'body' | 'table') => { if (n >= 10) return; const s = [...d.slides]; s.splice(n - 1, 0, { kind, title: kind === 'table' ? '한눈에 보기' : '새 장', body: '', rows: kind === 'table' ? [['항목', '내용'], ['', '']] : [], rowsText: kind === 'table' ? '항목 | 내용\n | ' : '', imagePlan: '', imageId: null }); set({ slides: s }); setSel(n - 1); };
  const del = (k: number) => { if (k === 0 || k === n - 1 || n <= 3) return; set({ slides: d.slides.filter((_, j) => j !== k) }); setSel(Math.max(0, k - 1)); };
  const payload = () => ({ action: 'save', topic: d.topic.trim(), caption: d.caption, keyword: d.keyword.trim(), template: d.template,
    slides: d.slides.map(({ rowsText: rt, ...s }) => ({ ...s, rows: s.kind === 'table' ? parseRows(rt) : [], imageId: s.kind === 'cover' || s.kind === 'body' ? s.imageId : null })) });
  async function save(quiet = false) {
    setBusy('save');
    try { await api(`/api/marketing/carousels/${it.id}`, { method: 'PATCH', body: payload() }); if (!quiet) toast.ok('저장했습니다 — 미리보기를 새로 그렸습니다'); await reload(); return true; }
    catch (e: any) { toast.error(e.message); return false; } finally { setBusy(null); }
  }
  async function rewrite() {
    if (note.trim().length < 2) { toast.error('무엇을 고칠지 적어 주세요'); return; }
    if (dirty && !(await save(true))) return;
    setBusy('rewrite');
    try { const r = await api<{ changes: string | null }>(`/api/marketing/carousels/${it.id}`, { method: 'PATCH', body: { action: 'rewrite', note: note.trim() } }); toast.ok(r.changes ? `AI 가 고쳤습니다 — ${r.changes}` : 'AI 가 고쳤습니다'); setNote(''); await reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function render() {
    if (dirty && !(await save(true))) return;
    setBusy('render');
    try {
      const r = await api<{ contentId: string; version: number; mediaIds: string[] }>(`/api/marketing/carousels/${it.id}/render`, { body: { scheduledAt: when ? new Date(when).toISOString() : null } });
      toast.ok(r.version > 1 ? `${r.mediaIds.length}장을 다시 그려 새 버전(v${r.version}) 재승인을 요청했습니다` : `${r.mediaIds.length}장을 그려 자료실(마케팅/카드뉴스)에 넣고 승인 요청을 올렸습니다`); await reload();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function cancel() {
    if (!confirm('이 카드뉴스 초안을 취소할까요?')) return;
    try { await api(`/api/marketing/carousels/${it.id}`, { method: 'PATCH', body: { action: 'cancel' } }); toast.ok('취소했습니다'); await reload(); } catch (e: any) { toast.error(e.message); }
  }
  const textOf = (s: Draft['slides'][number]) => [s.title, s.body, s.kind === 'table' ? s.rowsText : ''].join('\n');
  const holes = d.slides.map((s, k) => (PH.test(textOf(s)) ? k + 1 : 0)).filter(Boolean);
  const capHole = PH.test(d.caption);
  const blocked = holes.length > 0 || capHole || it.check.banned.length > 0;
  const canCancel = it.status === 'draft' && (it.created_by === view.userId || view.canDecide);
  return (
    <div className="space-y-3 border-t border-line p-3" data-testid="carousel-editor" data-id={it.id}>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ScoreChip label="표지 훅" score={it.check.score.score} pass={it.check.score.pass} testId="carousel-score" />
            {it.source === 'template' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">AI 없이 만든 빈 틀</span>}
            {it.input.changes && <span className="text-xs text-ink-2" data-testid="carousel-changes">최근 AI 수정: {it.input.changes}</span>}
          </div>
          {(it.check.score.fails.length > 0 || (it.check.score.notes?.length ?? 0) > 0) && <p className="text-xs text-amber-800">{[...it.check.score.fails, ...(it.check.score.notes ?? [])].join(' · ')}</p>}
          {(holes.length > 0 || capHole) && <p className="rounded-input bg-amber-50 px-2 py-1 text-xs text-amber-900" data-testid="carousel-placeholders">채울 곳 {'{{ }}'}: {[...holes.map((k) => `${k}장`), ...(capHole ? ['본문'] : [])].join(' · ')} — 채워야 이미지로 만들 수 있습니다</p>}
          {it.check.banned.length > 0 && <p className="rounded-input bg-red-50 px-2 py-1 text-xs text-red-800" data-testid="carousel-banned">금지어: {it.check.banned.join(', ')}</p>}
          <Field label="주제(표지 질문)"><input className={inputCls} value={d.topic} maxLength={80} onChange={(e) => set({ topic: e.target.value })} data-testid="carousel-edit-topic" /></Field>
          <ol className="space-y-2">{d.slides.map((s, k) => (
            <li key={k} className={cx('rounded-input border p-2.5', cur === k ? 'border-violet-300 bg-violet-50/40' : 'border-line')} onFocus={() => setSel(k)} onClick={() => setSel(k)} data-testid="carousel-slide" data-kind={s.kind}>
              <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-ink-2"><span>{k + 1}장 · {KIND[s.kind]}</span>
                {k > 0 && k < n - 1 && <span className="ml-auto flex gap-0.5">
                  <button type="button" className="rounded p-1 hover:bg-slate-100 disabled:opacity-30" disabled={k <= 1} onClick={() => move(k, -1)} aria-label={`${k + 1}장 위로`} data-testid="carousel-slide-up"><ArrowUp size={14} /></button>
                  <button type="button" className="rounded p-1 hover:bg-slate-100 disabled:opacity-30" disabled={k >= n - 2} onClick={() => move(k, 1)} aria-label={`${k + 1}장 아래로`} data-testid="carousel-slide-down"><ArrowDown size={14} /></button>
                  <button type="button" className="rounded p-1 text-red-700 hover:bg-red-50 disabled:opacity-30" disabled={n <= 3} onClick={() => del(k)} aria-label={`${k + 1}장 빼기`} data-testid="carousel-slide-del"><Trash2 size={14} /></button></span>}</div>
              <textarea className={cx(inputCls, 'font-semibold')} rows={2} maxLength={60} value={s.title} onChange={(e) => setSlide(k, { title: e.target.value })} aria-label={`${k + 1}장 제목`} data-testid="carousel-slide-title" />
              {s.kind === 'table'
                ? <textarea className={cx(inputCls, 'mt-1.5 font-mono text-xs')} rows={Math.max(3, s.rowsText.split('\n').length)} value={s.rowsText} onChange={(e) => setSlide(k, { rowsText: e.target.value })} aria-label={`${k + 1}장 표(줄마다 한 행, 칸은 | 로)`} placeholder="머리줄 | 칸2&#10;내용 | 내용" data-testid="carousel-slide-rows" />
                : <textarea className={cx(inputCls, 'mt-1.5')} rows={s.kind === 'cover' ? 1 : 3} maxLength={300} value={s.body} onChange={(e) => setSlide(k, { body: e.target.value })} aria-label={`${k + 1}장 본문`} placeholder={s.kind === 'cover' ? '부제 한 줄(선택)' : '줄마다 한 문장'} data-testid="carousel-slide-body" />}
              {s.kind === 'table' && <p className="mt-1 text-[11px] text-ink-3">줄마다 한 행, 칸은 | 로 나눕니다(첫 줄 = 머리줄, 최대 7줄 × 3칸)</p>}
              {(s.kind === 'cover' || s.kind === 'body') && <div className="mt-1.5 space-y-1">
                {s.imagePlan && <p className="text-[11px] text-ink-2">사진 계획: {s.imagePlan}</p>}
                <MediaPick label={s.imageId ? '사진 바꾸기' : '자료실 사진 넣기'} value={s.imageId ? [{ id: s.imageId, title: titles[s.imageId] ?? '사진' }] : []}
                  onChange={(v) => { const last = v.at(-1) ?? null; if (last) setTitles((x) => ({ ...x, [last.id]: last.title })); setSlide(k, { imageId: last?.id ?? null }); }} />
              </div>}
            </li>))}</ol>
          <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" disabled={n >= 10} onClick={() => add('body')} data-testid="carousel-add-body">+ 본문 장</Button><Button type="button" size="sm" variant="secondary" disabled={n >= 10} onClick={() => add('table')} data-testid="carousel-add-table">+ 표 장</Button><span className="self-center text-xs text-ink-3">{n}/10장(인스타 최대 10장)</span></div>
          <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
            <Field label={`인스타 본문 (${[...d.caption].length}/2200)`}><textarea className={inputCls} rows={5} maxLength={2200} value={d.caption} onChange={(e) => set({ caption: e.target.value })} data-testid="carousel-caption" /></Field>
            <div className="space-y-2"><Field label="댓글 키워드"><input className={inputCls} value={d.keyword} maxLength={20} onChange={(e) => set({ keyword: e.target.value })} data-testid="carousel-edit-keyword" /></Field>
              <TemplatePick value={d.template} onChange={(template) => set({ template })} labels={view.templates} name={`carousel-tpl-${it.id}`} /></div>
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-input bg-slate-50 p-2">
            <Field label="AI 로 고치기(수정 요청)" className="min-w-0 flex-1"><input className={inputCls} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="예: 표지를 더 짧게, 3장에 비용 이야기" data-testid="carousel-rewrite-note" /></Field>
            <Button type="button" size="sm" variant="secondary" disabled={!!busy || !view.aiEnabled} onClick={rewrite} data-testid="carousel-rewrite">{busy === 'rewrite' ? '고치는 중…' : 'AI 로 고치기'}</Button>
          </div>
        </div>
        <aside className="order-first space-y-2 lg:order-none lg:sticky lg:top-2 lg:self-start" data-testid="carousel-preview-box">
          <img src={slideUrl(it, Math.min(cur, it.slides.length - 1) + 1)} alt={`${cur + 1}장 미리보기`} className="aspect-[4/5] w-full max-w-[340px] rounded-input border border-line bg-slate-100 object-cover" data-testid="carousel-preview" />
          {dirty && <p className="text-xs text-amber-800" data-testid="carousel-dirty">고친 내용은 [저장]하면 그림에 반영됩니다</p>}
          <div className="flex gap-1.5 overflow-x-auto pb-1">{it.slides.map((_, k) => (
            <img key={`${k}-${it.updated_at}`} src={slideUrl(it, k + 1)} alt={`${k + 1}장`} loading="lazy" onClick={() => setSel(k)} className={cx('h-[70px] w-14 shrink-0 cursor-pointer rounded border bg-slate-100 object-cover', cur === k ? 'border-violet-500 ring-2 ring-violet-300' : 'border-line')} data-testid="carousel-thumb" />))}</div>
          <p className="text-[11px] text-ink-3">1080×1350 · 제목 굵게·본문 보통 · 가운데 {view.brands.find((b) => b.id === it.brand_id)?.hasLogo ? '로고' : '브랜드 이름'} · 마지막 장 검정 바탕 CTA</p>
        </aside>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button type="button" variant="secondary" disabled={!!busy || !dirty} onClick={() => save()} data-testid="carousel-save">{busy === 'save' ? '저장 중…' : '저장'}</Button>
        {canCancel && <Button type="button" variant="secondary" disabled={!!busy} onClick={cancel} data-testid="carousel-cancel">취소</Button>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {!it.content_id && <label className="flex items-center gap-1 whitespace-nowrap text-xs text-ink-2">게시 예정<input type="datetime-local" className={cx(inputCls, 'w-auto py-1')} value={when} onChange={(e) => setWhen(e.target.value)} data-testid="carousel-schedule" /></label>}
          {it.content_id && <Link href={`/s/marketing/approvals?c=${it.content_id}`} className="text-xs underline" style={{ color: C }} data-testid="carousel-content-link">승인함에서 보기 →</Link>}
          <Button type="button" disabled={!!busy || blocked} onClick={render} title={blocked ? '채울 곳·금지어를 먼저 고쳐 주세요' : undefined} data-testid="carousel-render">{busy === 'render' ? `${n}장 그리는 중…` : it.content_id ? '다시 그려 재승인 요청' : '이미지로 만들어 승인 요청'}</Button>
        </span>
      </div>
      {it.rendered_at && <p className="text-xs text-ink-3" data-testid="carousel-rendered">마지막으로 그린 때 {fmtDateTime(it.rendered_at)} · {it.media_ids.length}장 · 자료실 마케팅/카드뉴스</p>}
    </div>
  );
}
