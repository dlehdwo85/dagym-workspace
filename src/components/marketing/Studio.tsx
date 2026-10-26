'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Copy } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { MediaPick } from './MediaPick';
import { ScoreChip, TimingTable, designUsed } from './QualityPanel';
import { MODE_HINT, ModeChip, ModeToggle, type Mode } from './ModeToggle';

/**
 * 대표 10/20 19:00 제작의뢰실: 의뢰 폼(브랜드·채널/종류·목적·핵심 메시지·참고·톤·수량·마감) → AI 30년차 마케터 프롬프트(영문 + 한글 요약 + 참고 사진 + 자막) → [수정]/[생성]
 * → 생성(Higgsfield 연동 전엔 제작 요청 카드로 로컬 도우미에) → 승인 대기. 월 운영 목표 주간 달력에서 오면(?brand=&message=&kind=) 의뢰가 미리 채워짐.
 */
const C = '#7C3AED';
/** #534 프롬프트 검사(필수 칸 8개): 점수 · 칸별 ✓/✗ · 처음 점수와 보강한 칸(AI 가 쓴 칸 또는 기본값) */
type PCheck = { score: number; before: number; items: { key: string; label: string; ok: boolean; note?: string }[]; fixed: string[]; by: 'ai' | 'default' | null };
const ITEM_SHORT: Record<string, string> = { scene: '장면', korean: '한국인·한국 배경', camera: '카메라', light: '빛·키트 색', composition: '구도', props: '소품', negative: '금지', refs: '참고 사진' };
function PromptCheckBox({ c }: { c: PCheck }) {
  const cls = c.score >= 88 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : c.score >= 63 ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-red-200 bg-red-50 text-red-800';
  return (
    <div className="mt-1.5 rounded-input border border-line bg-white p-2" data-testid="studio-prompt-check">
      <div className="flex flex-wrap items-center gap-1.5"><span className={cx('rounded-full border px-2 py-0.5 text-[11px] font-semibold', cls)} data-testid="studio-prompt-score">프롬프트 검사 {c.score}점</span>
        {c.fixed.length > 0 && <span className="text-[11px] text-ink-2" data-testid="studio-prompt-fixed">처음 {c.before}점 → 빠진 칸 {c.fixed.map((k) => ITEM_SHORT[k] ?? k).join('·')} {c.by === 'ai' ? 'AI 가 쓴 칸으로 보강' : '기본값으로 보강'}</span>}</div>
      <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">{c.items.map((i) => <li key={i.key} className={i.ok ? 'text-emerald-800' : 'text-red-700'} title={i.note ?? i.label} data-testid="studio-prompt-item" data-ok={i.ok || undefined}>{i.ok ? '✓' : '✗'} {i.label}{!i.ok && i.note ? ` — ${i.note}` : ''}</li>)}</ul>
    </div>
  );
}
/** 로컬 10/20 22:30 ⑤: 표시 단위가 달러면 장당·초당 USD × 수량(영상 15초) + 원 환산 */
function estLabel(m: { kind: string; credits: number; usd?: number | null }, quantity: number, v: { pricing?: string; usdKrw?: number }) {
  if (v.pricing === 'usd' && m.usd != null) { const usd = Math.round(m.usd * (m.kind === 'video' ? 15 : 1) * quantity * 1000) / 1000; return `약 $${usd} (≈${Math.round(usd * (v.usdKrw ?? 1400)).toLocaleString('ko-KR')}원)`; }
  return `${m.credits * quantity}크레딧`;
}
type Brief = { id: string; brand: string | null; brand_id: string | null; channel: string; kind: string; purpose: string; mode?: string | null; message: string; refs: any; tone: string | null; quantity: number; due_date: string | null; status: string; prompt: any; content_id: string | null; est_credits: number; result: any; error: string | null; created_by_name: string | null; created_at: string; content_status: string | null; open_requests: number ; progress?: Progress | null };
type View = { briefs: Brief[]; brands: { id: string; name: string; tone: string | null }[]; recent: { id: string; title: string; channel: string }[]; kinds: Record<string, { label: string; aspect: string; px: string; media: string }>; purposes: Record<string, string>; canGenerate: boolean; pricing?: 'credits' | 'usd'; usdKrw?: number; provider: 'higgsfield' | 'card'; models: { id: string; kind: string; name: string; credits: number }[] ; video?: { tts: { ready: boolean; provider: string | null }; captures: number; bgm: number } };
const STATUS: Record<string, [string, string]> = { queued: ['대기', 'bg-slate-100 text-ink-2'], prompting: ['프롬프트 작성 중', 'bg-sky-50 text-sky-800'], ready: ['프롬프트 준비', 'bg-violet-50 text-violet-800'], generating: ['생성 중', 'bg-amber-50 text-amber-800'], review: ['승인 대기', 'bg-orange-50 text-orange-800'], published: ['게시됨', 'bg-emerald-50 text-emerald-800'], rejected: ['반려', 'bg-red-50 text-red-800'], failed: ['실패', 'bg-red-50 text-red-800'] };
const labelOf = (b: Brief) => (b.content_status === 'published' ? STATUS.published : b.content_status === 'changes' && b.status === 'review' ? ['수정 요청', 'bg-slate-100 text-ink-2'] : STATUS[b.status] ?? [b.status, 'bg-slate-100 text-ink-2']);

type SceneP = { k: number; seconds: number; line: string; status: string; screen: boolean; regens: number; qa: { checked: boolean; ok: boolean; issues: string[] } | null };
type Progress = { stage: string; label: string; done: number; total: number; review: string[]; notes: string[]; audio: { narration: string | null; bgm: string | null } | null;
  variants: { n: number; mediaId: string | null; duration: number | null; error: string | null; renderError: string | null; scenes: SceneP[] }[] };
const SC: Record<string, string> = { completed: 'bg-emerald-50 text-emerald-800', queued: 'bg-slate-100 text-ink-2', in_progress: 'bg-amber-50 text-amber-800', pending: 'bg-slate-100 text-ink-2' };
/** #454 영상 진행: 단계 · 장면 칩(상태·검수) · 사람 검수 필요 · 알림(내레이션 키·배경음) · 완성 영상 */
function VideoProgress({ p }: { p: Progress }) {
  return (
    <div className="mt-2 space-y-1.5 rounded-input border border-violet-100 bg-violet-50/30 p-2 text-xs" data-testid="studio-video" data-stage={p.stage}>
      <div className="font-semibold text-violet-900" data-testid="studio-video-stage">{p.label}</div>
      {p.variants.map((v) => <div key={v.n} className="flex flex-wrap items-center gap-1">{p.variants.length > 1 && <span className="text-ink-3">{v.n + 1}편</span>}
        {v.scenes.map((s) => <span key={s.k} title={s.line} className={cx('rounded-full px-2 py-0.5', s.qa && !s.qa.ok ? 'bg-red-50 text-red-800' : SC[s.status] ?? 'bg-red-50 text-red-800')} data-testid="studio-scene" data-status={s.status}>
          장면 {s.k + 1} · {s.seconds}초{s.screen ? ' · 실제 화면' : ''}{s.regens ? ' · 다시 만듦' : ''}{s.qa ? (s.qa.ok ? ' · 검수 ✓' : ' · 검수 ✕') : ''}</span>)}
        {v.duration ? <span className="text-ink-3">완성 {v.duration.toFixed(1)}초</span> : null}{v.error ? <span className="text-red-700">{v.error}</span> : v.renderError ? <span className="text-amber-800">합성 다시 시도: {v.renderError}</span> : null}</div>)}
      {p.review.length > 0 && <div className="rounded-input bg-red-50 px-2 py-1 text-red-900" data-testid="studio-review"><b>사람 검수 필요</b> — {p.review.join(' · ')}</div>}
      {p.notes.length > 0 && <ul className="list-disc pl-4 text-ink-2" data-testid="studio-video-notes">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      {p.variants.some((v) => v.mediaId) && <div className="flex flex-wrap gap-2">{p.variants.filter((v) => v.mediaId).map((v) => <video key={v.n} src={`/api/library/${v.mediaId}/download?inline=1`} controls playsInline preload="metadata" className="max-h-72 rounded-input bg-black" data-testid="studio-video-file" />)}</div>}
    </div>
  );
}

export function Studio() {
  const sp = useSearchParams();
  const { data, error, reload } = useApi<View>('/api/marketing/studio');
  const [f, setF] = useState({ brandId: sp.get('brand') ?? '', kind: sp.get('kind') ?? 'feed', purpose: sp.get('purpose') ?? 'inquiry', mode: (sp.get('mode') === 'ad' ? 'ad' : 'content') as Mode, message: sp.get('message') ?? '', tone: '', quantity: 1, dueDate: sp.get('due') ?? '', links: '', contentIds: [] as string[], goalWeek: sp.get('week') ? Number(sp.get('week')) : undefined });
  const [media, setMedia] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data && !f.brandId && data.brands.length === 1) setF((x) => ({ ...x, brandId: data.brands[0].id })); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (f.message.trim().length < 2) return; setBusy(true);
    try {
      const r = await api<{ id: string; prompt: any }>('/api/marketing/studio', { body: { brandId: f.brandId || null, kind: f.kind, purpose: f.purpose, mode: f.mode, message: f.message.trim(), tone: f.tone || null, quantity: f.quantity, dueDate: f.dueDate || null, goalWeek: f.goalWeek,
        refs: { mediaIds: media.map((m) => m.id), contentIds: f.contentIds, links: f.links.split(/\s+/).filter((x) => /^https?:\/\//.test(x)).slice(0, 5) } } });
      toast.ok(r.prompt?.error ? '의뢰했습니다 — 프롬프트는 [다시 쓰기]로' : r.prompt?.source === 'ai' ? '의뢰했습니다 — AI 마케터가 프롬프트를 썼습니다' : '의뢰했습니다 — AI 없이 기본 프롬프트');
      setF({ ...f, message: '', links: '', contentIds: [] }); setMedia([]); reload();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={5} />;
  const spec = data.kinds[f.kind];
  const model = data.models.find((m) => m.kind === spec?.media);
  return (
    <div className="space-y-4" data-testid="mkt-studio">
      <p className="text-xs text-ink-2">의도를 적으면 AI 마케터가 <b>경력 30년 마케터·아트디렉터</b>로 생성 프롬프트(영문)·한글 의도 요약·참고 사진·자막을 씁니다. 확인한 뒤 [생성]을 누르면 {data.provider === 'higgsfield' ? 'Higgsfield 로 만들어 자료실에 저장하고' : '제작 요청 카드(프롬프트·참고 사진 포함)로 넘어가 만든 뒤'} 승인 대기에 올라갑니다. 크레딧은 월 한도 안에서.</p>
      <form onSubmit={submit} className="space-y-3 rounded-card border border-violet-200 bg-violet-50/30 p-4" data-testid="studio-form">
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="브랜드"><select className={inputCls} value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value, tone: '' })} aria-label="브랜드" data-testid="studio-brand"><option value="">(없음)</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="채널 · 종류"><select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} aria-label="종류" data-testid="studio-kind">{Object.entries(data.kinds).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.px})</option>)}</select></Field>
          <Field label="수량"><input className={inputCls} type="number" min={1} max={5} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })} aria-label="수량" /></Field>
          <Field label="마감(게시 예정일)"><input className={inputCls} type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} aria-label="마감" /></Field>
        </div>
        <Field label="목적"><div className="flex flex-wrap gap-1.5">{Object.entries(data.purposes).map(([k, l]) => <button key={k} type="button" onClick={() => setF({ ...f, purpose: k })} className={cx('rounded-full border px-3 py-1 text-xs', f.purpose === k ? 'border-transparent text-white' : 'border-line bg-white')} style={f.purpose === k ? { background: C } : undefined} aria-pressed={f.purpose === k} data-testid={`studio-purpose-${k}`}>{l}</button>)}</div></Field>
        {/* #499-1 용도: 콘텐츠형(참여)·광고형(전환) — AI 마케터가 쓰는 첫 줄·장면 구성과 훅 채점이 다름 */}
        <Field label="용도"><span className="flex flex-wrap items-center gap-2 text-xs"><ModeToggle value={f.mode} onChange={(m) => setF({ ...f, mode: m })} testId="studio-mode" /><span className="text-ink-3">{MODE_HINT[f.mode]}</span></span></Field>
        <Field label="핵심 메시지 1줄"><input className={inputCls} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} maxLength={300} placeholder="예: 가을 신규 회원 PT 10회 30% 할인 — 10월 말까지" required aria-label="핵심 메시지" data-testid="studio-message" /></Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="참고 사진(자료실)"><MediaPick value={media} onChange={setMedia} /></Field>
          <Field label="기존 게시물 참고"><select className={inputCls} multiple size={3} value={f.contentIds} onChange={(e) => setF({ ...f, contentIds: [...e.target.selectedOptions].map((o) => o.value).slice(0, 5) })} aria-label="기존 게시물">{data.recent.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></Field>
          <Field label="레퍼런스 링크(공백으로 구분)"><input className={inputCls} value={f.links} onChange={(e) => setF({ ...f, links: e.target.value })} placeholder="https://…" aria-label="레퍼런스 링크" /></Field>
          <Field label="톤(비우면 브랜드 키트)"><input className={inputCls} value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })} maxLength={200} placeholder={data.brands.find((b) => b.id === f.brandId)?.tone ?? '친절하고 담백하게'} aria-label="톤" /></Field>
        </div>
        {spec?.media === 'video' && data.provider === 'higgsfield' && data.video && <p className="rounded-input bg-white px-2 py-1.5 text-xs text-ink-2" data-testid="studio-video-ready">영상은 장면 3~5개(각 3~5초)를 따로 만들어 AI 가 검수(외국어 글자·외국인·깨진 화면)한 뒤 서버에서 합성합니다 — 한국어 자막·끝 화면{data.video.tts.ready ? ` · 내레이션 ${data.video.tts.provider}` : ' · 내레이션 키 필요(자막만)'} · 실제 화면 캡처 {data.video.captures}장(자료실 &apos;영상 화면 캡처&apos;) · 배경음 {data.video.bgm}곡(자료실 &apos;영상 배경음&apos;)</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2"><span>{spec ? `${spec.label} ${spec.aspect} · ${spec.px}` : ''}{model ? ` · 모델 ${model.name} · 예상 ${estLabel(model, f.quantity, data)}` : ''}</span><Button disabled={busy || f.message.trim().length < 2} data-testid="studio-submit">{busy ? 'AI 마케터가 쓰는 중…' : '의뢰하기'}</Button></div>
      </form>
      <ul className="space-y-2" data-testid="studio-list">{data.briefs.map((b) => <BriefCard key={b.id} b={b} view={data} onChange={reload} />)}{!data.briefs.length && <li className="text-sm text-ink-3">아직 의뢰가 없습니다</li>}</ul>
    </div>
  );
}

function BriefCard({ b, view, onChange }: { b: Brief; view: View; onChange: () => void }) {
  const [edit, setEdit] = useState(false); const [p, setP] = useState({ promptEn: b.prompt?.promptEn ?? '', negativeEn: b.prompt?.negativeEn ?? '', summaryKo: b.prompt?.summaryKo ?? '', caption: b.prompt?.caption ?? '', model: b.prompt?.model ?? '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => setP({ promptEn: b.prompt?.promptEn ?? '', negativeEn: b.prompt?.negativeEn ?? '', summaryKo: b.prompt?.summaryKo ?? '', caption: b.prompt?.caption ?? '', model: b.prompt?.model ?? '' }), [b]);
  async function act(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try { const r = await api<any>(`/api/marketing/studio/${b.id}`, { method: 'PATCH', body }); toast.ok(r?.prompt?.check && body.action === 'update' ? `${msg} · 프롬프트 검사 ${r.prompt.check.score}점${r.prompt.check.fixed?.length ? '(빠진 칸 보강)' : ''}` : r?.status === 'generating' && r.requestIds ? `제작 요청 카드 ${r.requestIds.length}건으로 넘겼습니다` : r?.status === 'generating' ? 'Higgsfield 에 제출했습니다 — 끝나면 승인 대기로 올라갑니다' : r?.status === 'review' ? '시안을 만들어 승인 대기에 올렸습니다' : r?.status === 'failed' ? `생성 실패: ${(r.errors ?? []).join(' / ')}` : msg); setEdit(false); onChange(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const [sl, sc] = labelOf(b); const spec = view.kinds[b.kind]; const pr = b.prompt;
  const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => toast.ok('복사했습니다')).catch(() => toast.error('복사 실패')); };
  return (
    <li className="rounded-card border border-line bg-white p-3 text-sm shadow-card" data-testid="studio-brief" data-status={b.status}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', sc)} data-testid="studio-status">{sl}</span>
        {b.brand && <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white">{b.brand}</span>}
        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-800">{spec?.label ?? b.kind} · {view.purposes[b.purpose] ?? b.purpose}</span>
        <ModeChip mode={b.mode} />
        <b className="min-w-0 flex-1 truncate">{b.message}</b>
        <span className="text-[11px] text-ink-3">{b.created_by_name ?? ''} · {fmtDateTime(b.created_at)}{b.quantity > 1 ? ` · ${b.quantity}장` : ''}{b.due_date ? ` · 마감 ${b.due_date}` : ''}{b.est_credits ? ` · 예상 ${view.pricing === 'usd' && view.models.find((m) => m.id === (b.prompt?.model ?? '')) ? estLabel(view.models.find((m) => m.id === b.prompt?.model)!, b.quantity, view) : `${b.est_credits}크레딧`}` : ''}</span>
      </div>
      {b.error && <p className="mt-1 text-xs text-red-700">{b.error}</p>}
      {b.progress && <VideoProgress p={b.progress} />}
      {pr && !edit && <div className="mt-2 grid gap-2 md:grid-cols-2 text-xs" data-testid="studio-prompt">
        <div className="rounded-input bg-slate-50 p-2"><div className="flex items-center justify-between font-semibold text-ink-2">생성 프롬프트(EN){pr.source === 'ai' ? <span className="font-normal text-ink-3">AI 마케터</span> : pr.source === 'user' ? <span className="font-normal text-ink-3">직접 고침</span> : <span className="font-normal text-ink-3">기본</span>}<button type="button" onClick={() => copy(pr.promptEn)} className="inline-flex items-center gap-0.5 text-violet-700" aria-label="프롬프트 복사"><Copy size={12} />복사</button></div>
          <p className="mt-1 whitespace-pre-wrap text-ink" data-testid="studio-prompt-en">{pr.promptEn}</p>{pr.negativeEn && <p className="mt-1 text-ink-3">피할 것: {pr.negativeEn}</p>}{pr.model && <p className="mt-1 text-ink-3">모델 {pr.model} · {pr.aspect}</p>}{designUsed(pr.design) && <p className="mt-1 text-violet-800" data-testid="studio-design-used">{designUsed(pr.design)}</p>}{pr.check && <PromptCheckBox c={pr.check as PCheck} />}</div>
        <div className="space-y-1.5"><div className="rounded-input bg-violet-50/50 p-2"><div className="font-semibold text-violet-800">한글 의도 요약</div><p className="mt-0.5 whitespace-pre-wrap">{pr.summaryKo || '—'}</p></div>
          <div className="rounded-input border border-line p-2"><div className="font-semibold text-ink-2">자막·카피</div><p className="mt-0.5 whitespace-pre-wrap">{pr.caption || '—'}</p>
            {pr.quality && <div className="mt-1 flex flex-wrap items-center gap-1.5" data-testid="studio-quality"><ScoreChip label="사람다움" score={pr.quality.human.score} pass={pr.quality.human.pass} />{pr.quality.hook && <ScoreChip label="훅" score={pr.quality.hook.score} pass={pr.quality.hook.pass} />}
              {(pr.quality.human.issues ?? []).length > 0 && <span className="text-ink-3">{pr.quality.human.issues.join(' · ')}</span>}{pr.quality.hook && !pr.quality.hook.pass && pr.quality.hook.fails?.length > 0 && <span className="text-amber-800">{pr.quality.hook.fails.join(' · ')}</span>}</div>}</div>
          {!!pr.refMediaIds?.length && <div className="flex gap-1.5">{pr.refMediaIds.map((m: string) => <img key={m} src={`/api/library/${m}/download?inline=1`} alt="" className="size-14 rounded-input object-cover" loading="lazy" />)}</div>}</div>
        {pr.timing && <div className="md:col-span-2"><TimingTable t={pr.timing} visuals={(pr.scenes ?? []).map((x: { visualEn: string }) => x.visualEn)} secs={(pr.scenes ?? []).map((x: { seconds?: number }) => x.seconds ?? 0)} /></div>}
      </div>}
      {edit && <div className="mt-2 space-y-2 text-xs" data-testid="studio-edit">
        <Field label="생성 프롬프트(EN)"><textarea className={inputCls} rows={5} value={p.promptEn} onChange={(e) => setP({ ...p, promptEn: e.target.value })} aria-label="프롬프트" data-testid="studio-edit-prompt" /></Field>
        <div className="grid gap-2 sm:grid-cols-2"><Field label="피할 것(EN)"><input className={inputCls} value={p.negativeEn} onChange={(e) => setP({ ...p, negativeEn: e.target.value })} aria-label="피할 것" /></Field>
          <Field label="모델"><select className={inputCls} value={p.model} onChange={(e) => setP({ ...p, model: e.target.value })} aria-label="모델"><option value="">자동</option>{view.models.filter((m) => m.kind === spec?.media).map((m) => <option key={m.id} value={m.id}>{m.name} · {m.credits}크레딧</option>)}</select></Field></div>
        <Field label="한글 의도 요약"><textarea className={inputCls} rows={2} value={p.summaryKo} onChange={(e) => setP({ ...p, summaryKo: e.target.value })} aria-label="요약" /></Field>
        <Field label="자막·카피"><textarea className={inputCls} rows={2} value={p.caption} onChange={(e) => setP({ ...p, caption: e.target.value })} aria-label="자막" /></Field>
        <div className="flex gap-1.5"><Button size="sm" onClick={() => act({ action: 'update', promptEn: p.promptEn, negativeEn: p.negativeEn, summaryKo: p.summaryKo, caption: p.caption, model: p.model || null }, '저장했습니다')} disabled={busy || p.promptEn.trim().length < 5} data-testid="studio-edit-save">저장</Button><Button size="sm" variant="secondary" onClick={() => setEdit(false)}>취소</Button></div>
      </div>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {['ready', 'failed'].includes(b.status) && !edit && <><Button size="sm" variant="secondary" onClick={() => setEdit(true)} data-testid="studio-edit-open">수정</Button><Button size="sm" variant="secondary" onClick={() => act({ action: 'prompt' }, '프롬프트를 다시 썼습니다')} disabled={busy}>AI 다시 쓰기</Button>
          {view.canGenerate && <Button size="sm" onClick={() => act({ action: 'generate' }, '생성했습니다')} disabled={busy} data-testid="studio-generate">{view.provider === 'higgsfield' ? '생성' : '제작 요청 카드로 보내기'}</Button>}</>}
        {b.status === 'queued' && <Button size="sm" variant="secondary" onClick={() => act({ action: 'prompt' }, '프롬프트를 썼습니다')} disabled={busy} data-testid="studio-prompt-retry">프롬프트 쓰기</Button>}
        {b.status === 'generating' && <span className="text-xs text-ink-2" data-testid="studio-generating">{b.progress ? <>{b.progress.label} <button type="button" className="underline" onClick={onChange}>상태 확인</button></> : (b as any).result?.provider === 'higgsfield' ? <>Higgsfield 생성 중 {((b as any).result.jobs ?? []).filter((j: any) => j.status === 'completed').length}/{((b as any).result.jobs ?? []).length} <button type="button" className="underline" onClick={onChange}>상태 확인</button></> : <>제작 요청 카드 {b.open_requests}건 — 로컬 도우미가 만들어 붙이면 승인 대기로 <Link href="/s/marketing/automation#requests" className="underline">카드 보기</Link></>}</span>}
        {b.content_id && ['review', 'published'].includes(b.status) && <Link href={`/s/marketing/approvals?c=${b.content_id}`} className="rounded-input border border-line px-2.5 py-1 text-xs" data-testid="studio-open-content">승인함에서 보기</Link>}
        {!['review', 'published'].includes(b.status) && <Button size="sm" variant="secondary" onClick={() => act({ action: 'cancel' }, '취소했습니다')} disabled={busy}>취소</Button>}
      </div>
    </li>
  );
}
