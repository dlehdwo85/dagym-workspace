'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart3, Bot, Headset, Lightbulb, Palette, Rocket, Search, Wallet, type LucideIcon } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { ScoreChip } from './QualityPanel';

/**
 * #499-7 AI 마케팅팀: 운영실(제안 → 승인) 위에 역할 7개의 일정·켜짐·마지막 실행·기록·역할별 기억을 한 화면에.
 * 기획 담당 오늘 주제(브랜드마다 3안) → 대표 [채택](→ 디자인 담당이 바로 카드뉴스 초안·제작 의뢰)·[반려](사유 = 기억). 돈이 나가는 일은 지금 승인 규칙 그대로.
 */
type Role = 'planner' | 'designer' | 'researcher' | 'adsetter' | 'budget' | 'responder' | 'reporter';
type Rec = { id: string; status: string; title: string; detail?: string | null; link: string | null; created_at: string };
type Mem = { id: string; brand_id: string | null; brand_name: string | null; kind: 'adopt' | 'reject' | 'edit' | 'note'; text: string; reason: string | null; created_by_name: string | null; created_at: string };
type RoleView = { key: Role; name: string; schedule: string; job: string; owner: string; recipe: string[]; mode: 'toggle' | 'always' | 'request'; ai: boolean; note?: string; link: { href: string; label: string };
  enabled: boolean; isDefault: boolean; last: { at: string; status: string; summary: string } | null; next: string | null; stats: string[]; records: Rec[]; memory: Mem[]; memoryCount: number; canRun: boolean };
type Idea = { id: string; brand_id: string; brand_name: string; day: string; title: string; hook: string | null; format: 'carousel' | 'reels' | 'feed'; pattern: string | null; product: string | null; angle: string | null;
  basis: { kind: string; text: string }[]; score: number | null; pass: boolean; status: 'pending' | 'adopted' | 'rejected' | 'expired'; note: string | null; decided_by_name: string | null;
  result_status: 'working' | 'done' | 'draft' | 'error' | null; result_type: string | null; result_note: string | null; result_link: string | null };
type View = { roles: RoleView[]; ideas: Idea[]; today: string; brands: { id: string; name: string; planned: boolean }[]; formats: Record<string, string>; basis: Record<string, string>; canDecide: boolean; aiEnabled: boolean;
  guides: Record<string, string>; guideMax: number }; // 187차 ④ 디자인 지침 {common, <brandId>}

const C = '#7C3AED';
const ICON: Record<Role, LucideIcon> = { planner: Lightbulb, designer: Palette, researcher: Search, adsetter: Rocket, budget: Wallet, responder: Headset, reporter: BarChart3 };
const MEM_KIND: Record<Mem['kind'], [string, string]> = { adopt: ['채택', 'bg-emerald-50 text-emerald-800'], reject: ['반려', 'bg-red-50 text-red-700'], edit: ['수정 요청', 'bg-amber-50 text-amber-800'], note: ['대표 메모', 'bg-violet-50 text-violet-800'] };
const REC_DOT: Record<string, string> = { done: 'bg-emerald-500', working: 'bg-sky-500', skipped: 'bg-slate-300', error: 'bg-red-500' };
const REJECT_CHIPS = ['이미 한 주제', '우리 고객과 안 맞음', '시기가 아님'];
/** 받침에 맞는 조사(기획 담당을 · 광고 리서처를) */
const josa = (w: string, pair: '을를' | '이가') => { const c = w.trim().slice(-1).charCodeAt(0); return `${w}${c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? pair[0] : pair[1]}`; };

export function Team() {
  const { data, error, reload } = useApi<View>('/api/marketing/team');
  const [busy, setBusy] = useState<string | null>(null);
  const working = !!data?.ideas.some((x) => x.result_status === 'working');
  useEffect(() => { if (!working) return; const h = setInterval(() => reload(), 3000); return () => clearInterval(h); }, [working, reload]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  async function call(key: string, url: string, body: Record<string, unknown>, ok?: (r: any) => string) {
    setBusy(key);
    try { const r = await api<any>(url, { body }); if (ok) toast.ok(ok(r)); await reload(); return r; } catch (e: any) { toast.error(e.message); return null; } finally { setBusy(null); }
  }
  const team = (body: Record<string, unknown>, key: string, ok?: (r: any) => string) => call(key, '/api/marketing/team', body, ok);
  const planner = data?.roles.find((r) => r.key === 'planner');
  const today = data?.ideas.filter((x) => x.day === data.today || x.status === 'pending' || x.result_status === 'working') ?? [];
  const older = data?.ideas.filter((x) => !today.includes(x)) ?? [];
  const groups = [...new Set(today.map((x) => x.brand_id))].map((b) => ({ id: b, name: today.find((x) => x.brand_id === b)!.brand_name, items: today.filter((x) => x.brand_id === b) }));
  return (
    <div className="mx-auto max-w-6xl space-y-4" data-testid="team">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold" style={{ color: C }}><Bot className="size-5" />AI 마케팅팀</h1>
        <Link href="/s/marketing/ops" className="ml-auto text-xs text-ink-2 underline">운영 계획 →</Link>
      </div>
      <p className="text-xs text-ink-2">역할마다 일정·기록·기억을 따로 둡니다. AI 가 초안을 만들고, 결정은 대표가 합니다 — 광고 켜기·증액·영상 [생성]처럼 돈이 나가는 일은 지금처럼 승인 뒤에만. 가장 귀찮은 일부터 하나씩 켜세요.</p>
      {!data ? <Skeleton rows={6} /> : <>
        <section id="ideas" className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="team-ideas">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold"><Lightbulb className="mr-1 inline size-4 text-amber-500" />오늘 주제 <span className="font-normal text-ink-2">기획 담당 · 브랜드마다 3안 → 채택하면 디자인 담당이 바로 만듦</span></h2>
            <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', planner?.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-ink-3')} data-testid="team-planner-state">{planner?.enabled ? `켜짐 · ${planner.next}` : '꺼짐 — 매일 자동으로 내지 않음'}</span>
            {data.canDecide && <Button size="sm" className="ml-auto" disabled={!!busy || !data.aiEnabled} data-testid="team-ideas-run"
              onClick={() => team({ action: 'run', role: 'planner' }, 'run:planner', (r) => (r.created ? `오늘 주제 ${r.created}개를 받았습니다${r.left?.length ? ` — 남은 브랜드 ${r.left.join(', ')}는 잠시 뒤 다시` : ''}` : '새 주제를 받지 못했습니다 — 기록을 확인하세요'))}>
              {busy === 'run:planner' ? '받는 중…' : '오늘 주제 받기'}</Button>}
          </div>
          {!data.aiEnabled && <p className="mt-1 text-[11px] text-amber-800">AI 가 꺼져 있어 기획 담당이 주제를 낼 수 없습니다.</p>}
          {groups.length === 0 && <div className="mt-2 rounded-input border border-dashed border-line p-4 text-center text-xs text-ink-2" data-testid="team-ideas-empty">
            {planner?.enabled ? '아직 오늘 주제가 없습니다 — 07시 이후 점검 때 브랜드마다 하나씩 만듭니다' : '기획 담당이 꺼져 있습니다 — 아래 역할 카드에서 켜거나 [오늘 주제 받기]로 한 번 시험해 보세요'}</div>}
          {groups.map((g) => (
            <div key={g.id} className="mt-3" data-testid="team-idea-brand" data-brand={g.id}>
              <div className="flex items-center gap-2 text-xs"><b className="text-sm">{g.name}</b>
                {data.canDecide && <button type="button" className="text-[11px] text-ink-2 underline disabled:opacity-50" disabled={!!busy || !data.aiEnabled} data-testid="team-idea-rerun"
                  onClick={() => team({ action: 'run', role: 'planner', brandId: g.id }, `run:${g.id}`, (r) => `${g.name} 주제 ${r.created}개를 다시 받았습니다`)}>{busy === `run:${g.id}` ? '받는 중…' : '다시 받기'}</button>}</div>
              <div className="mt-1.5 grid gap-2 md:grid-cols-3">{g.items.map((x) => <IdeaCard key={x.id} x={x} data={data} busy={busy} call={call} />)}</div>
            </div>))}
          {older.length > 0 && <details className="mt-3 text-xs" data-testid="team-ideas-older"><summary className="cursor-pointer text-ink-2">지난 주제 {older.length}개</summary>
            <ul className="mt-1 space-y-0.5">{older.map((x) => <li key={x.id} className="text-ink-2">{x.day.slice(5)} · {x.brand_name} · «{x.title}» — {x.status === 'adopted' ? '채택' : x.status === 'rejected' ? `반려${x.note ? `(${x.note})` : ''}` : '지난 주제'}</li>)}</ul></details>}
        </section>
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="team-roles">
          {data.roles.map((r) => <RoleCard key={r.key} r={r} data={data} busy={busy} team={team} />)}
        </section>
      </>}
    </div>
  );
}

function IdeaCard({ x, data, busy, call }: { x: Idea; data: View; busy: string | null; call: (key: string, url: string, body: Record<string, unknown>, ok?: (r: any) => string) => Promise<any> }) {
  const [rej, setRej] = useState<string | null>(null);
  const url = `/api/marketing/team/ideas/${x.id}`;
  const done = x.status !== 'pending';
  return (
    <div className={cx('rounded-input border p-2.5 text-xs', x.status === 'adopted' ? 'border-emerald-300 bg-emerald-50/40' : x.status === 'rejected' || x.status === 'expired' ? 'border-line bg-slate-50 opacity-70' : 'border-line bg-white')}
      data-testid="team-idea" data-id={x.id} data-status={x.status} data-format={x.format}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-800">{data.formats[x.format] ?? x.format}</span>
        {x.score !== null && <ScoreChip label="첫 문장" score={x.score} pass={x.pass} />}
      </div>
      <p className="mt-1 text-sm font-semibold leading-snug" data-testid="team-idea-title">{x.title}</p>
      {x.hook && <p className="mt-0.5 text-ink-2">“{x.hook}”</p>}
      {(x.product || x.angle) && <p className="mt-0.5 text-[11px] text-ink-3">{[x.product, x.angle].filter(Boolean).join(' · ')}</p>}
      {x.basis.length > 0 && <ul className="mt-1 space-y-0.5" data-testid="team-idea-basis">{x.basis.map((b, k) => <li key={k} className="text-[11px]"><span className="mr-1 rounded bg-slate-100 px-1 text-ink-2">{data.basis[b.kind] ?? b.kind}</span>{b.text}</li>)}</ul>}
      {x.status === 'pending' && data.canDecide && (rej === null
        ? <div className="mt-2 flex gap-1.5">
            <Button size="sm" disabled={!!busy} data-testid="team-idea-adopt" onClick={() => call(`adopt:${x.id}`, url, { action: 'adopt' }, (r) => (r.designer === 'queued' ? '채택했습니다 — 디자인 담당이 만드는 중입니다' : '채택했습니다 — 디자인 담당이 꺼져 있어 만들지는 않았습니다'))}>채택</Button>
            <Button size="sm" variant="secondary" disabled={!!busy} data-testid="team-idea-reject" onClick={() => setRej('')}>반려</Button></div>
        : <div className="mt-2 space-y-1.5" data-testid="team-idea-reject-form">
            <div className="flex flex-wrap gap-1">{REJECT_CHIPS.map((c) => <button key={c} type="button" className={cx('rounded-full border px-2 py-0.5 text-[11px]', rej === c ? 'border-brand-500 bg-brand-50' : 'border-line')} onClick={() => setRej(c)}>{c}</button>)}</div>
            <input className={cx(inputCls, 'h-8 text-xs')} value={rej} maxLength={200} placeholder="반려 사유(다음 주제에 반영)" onChange={(e) => setRej(e.target.value)} data-testid="team-idea-reject-note" />
            <div className="flex gap-1.5"><Button size="sm" variant="danger" disabled={!!busy} data-testid="team-idea-reject-go" onClick={async () => { const r = await call(`reject:${x.id}`, url, { action: 'reject', note: rej.trim() || undefined }, () => '반려했습니다 — 사유는 기획 담당이 기억합니다'); if (r) setRej(null); }}>반려하기</Button>
              <Button size="sm" variant="ghost" onClick={() => setRej(null)}>취소</Button></div></div>)}
      {done && <p className="mt-2 text-[11px] text-ink-2">{x.status === 'adopted' ? '채택' : x.status === 'rejected' ? '반려' : '지난 주제'}{x.decided_by_name ? ` · ${x.decided_by_name}` : ''}{x.note ? ` — ${x.note}` : ''}</p>}
      {x.status === 'adopted' && <div className="mt-1 rounded bg-white/70 px-2 py-1 text-[11px]" data-testid="team-idea-result" data-status={x.result_status ?? 'none'}>
        <b>디자인 담당</b> · {x.result_status === 'working' ? '만드는 중…' : x.result_note ?? (data.roles.find((r) => r.key === 'designer')?.enabled ? '대기' : '꺼져 있음')}
        {x.result_link && x.result_status !== 'working' && <Link href={x.result_link} className="ml-1 font-medium underline" style={{ color: C }} data-testid="team-idea-open">열기</Link>}
        {data.canDecide && (x.result_status === null || x.result_status === 'error') && <button type="button" className="ml-1 font-medium underline disabled:opacity-50" disabled={!!busy} data-testid="team-idea-make"
          onClick={() => call(`make:${x.id}`, url, { action: 'make' }, () => '디자인 담당에게 맡겼습니다 — 만드는 중')}>{x.result_status === 'error' ? '다시 맡기기' : '디자인 담당에게 맡기기'}</button>}
      </div>}
    </div>
  );
}

const lineCount = (t?: string | null) => String(t ?? '').split('\n').map((l) => l.trim()).filter(Boolean).length;
/** 187차 ④(대표 '디자인 담당 기억 — 브랜드별+공통 · 긴 지침 칸'): 한 줄에 하나씩 적는 디자인 지침(회사 전체·브랜드별, 4,000자) —
 *  자동 제작 원고·수정본·약한 첫 줄 다시 쓰기·카드뉴스·제작의뢰실 프롬프트에 그대로 들어가고, 제작 메모에 '반영: 디자인 지침 n개'로 남음 */
function GuideBox({ data, busy, team }: { data: View; busy: string | null; team: (body: Record<string, unknown>, key: string, ok?: (r: any) => string) => Promise<any> }) {
  const [scope, setScope] = useState(''); // '' = 회사 전체
  const saved = data.guides[scope || 'common'] ?? '';
  const [text, setText] = useState(saved);
  useEffect(() => setText(data.guides[scope || 'common'] ?? ''), [scope, data.guides]);
  const name = (k: string) => (k === 'common' ? '회사 전체' : data.brands.find((b) => b.id === k)?.name ?? '브랜드');
  const have = Object.keys(data.guides).filter((k) => lineCount(data.guides[k]) > 0);
  return (
    <details className="mt-1 text-xs" data-testid="team-design-guide"><summary className="cursor-pointer text-ink-2">디자인 지침 {have.length ? have.map((k) => `${name(k)} ${lineCount(data.guides[k])}줄`).join(' · ') : '없음'}</summary>
      <p className="mt-1 text-[11px] text-ink-3">한 줄에 하나씩 적으면 자동 제작 원고·수정본·카드뉴스·제작의뢰실 프롬프트에 그대로 들어갑니다(브랜드 글 = 회사 전체 + 그 브랜드 지침). 제작 메모에 &apos;반영: 디자인 지침 n개&apos;로 남습니다.</p>
      {data.brands.length > 0 && <select className={cx(inputCls, 'mt-1.5 h-8 w-auto text-xs')} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="지침 범위" data-testid="team-guide-scope">
        <option value="">회사 전체{lineCount(data.guides.common) ? ` (${lineCount(data.guides.common)}줄)` : ''}</option>
        {data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}{lineCount(data.guides[b.id]) ? ` (${lineCount(data.guides[b.id])}줄)` : ''}</option>)}</select>}
      <textarea className={cx(inputCls, 'mt-1.5 text-xs')} rows={6} maxLength={data.guideMax} value={text} readOnly={!data.canDecide} onChange={(e) => setText(e.target.value)} aria-label="디자인 지침"
        placeholder={'예) 표지 첫 줄은 질문으로 시작\n브랜드 색은 포인트에만, 바탕은 사진 위주\n사람 얼굴은 정면 대신 손·뒷모습'} data-testid="team-guide-input" />
      <div className="mt-1 flex flex-wrap items-center gap-2"><span className="text-ink-3" data-testid="team-guide-count">{lineCount(text)}줄 · {text.length.toLocaleString('ko-KR')}/{data.guideMax.toLocaleString('ko-KR')}자</span>
        {data.canDecide && <Button size="sm" variant="secondary" className="ml-auto" disabled={!!busy || text.trim() === saved.trim()} data-testid="team-guide-save"
          onClick={() => team({ action: 'guide', brandId: scope || null, text }, 'guide', (r) => (r.chars ? `${name(scope || 'common')} 디자인 지침을 저장했습니다(${r.lines}줄)` : `${name(scope || 'common')} 디자인 지침을 비웠습니다`))}>
          {busy === 'guide' ? '저장 중…' : '지침 저장'}</Button>}</div>
    </details>
  );
}

function RoleCard({ r, data, busy, team }: { r: RoleView; data: View; busy: string | null; team: (body: Record<string, unknown>, key: string, ok?: (r: any) => string) => Promise<any> }) {
  const Icon = ICON[r.key];
  const [note, setNote] = useState(''); const [brand, setBrand] = useState('');
  const state = r.mode === 'toggle' ? (r.enabled ? '켜짐' : '꺼짐') : r.mode === 'always' ? '항상' : '요청 시';
  return (
    <div className={cx('flex flex-col rounded-card border bg-white p-3 shadow-card', r.enabled ? 'border-line' : 'border-dashed border-slate-300')} data-testid="team-role" data-role={r.key} data-on={r.enabled ? '1' : '0'}>
      <div className="flex items-start gap-2">
        <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-input', r.enabled ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-ink-3')}><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5"><b className="text-sm">{r.name}</b><span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-ink-2">{r.schedule}</span></div>
          <p className="mt-0.5 text-xs text-ink-2">{r.job}</p>
        </div>
        {r.mode === 'toggle' && data.canDecide
          ? <button type="button" role="switch" aria-checked={r.enabled} aria-label={`${r.name} ${r.enabled ? '끄기' : '켜기'}`} disabled={!!busy} data-testid="team-role-toggle"
              className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', r.enabled ? 'bg-violet-600' : 'bg-slate-300')}
              onClick={() => team({ action: 'toggle', role: r.key, enabled: !r.enabled }, `toggle:${r.key}`, () => `${josa(r.name, '을를')} ${r.enabled ? '껐습니다' : '켰습니다'}`)}>
              <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', r.enabled ? 'left-[22px]' : 'left-0.5')} /></button>
          : <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', r.enabled ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-ink-3')} data-testid="team-role-state">{state}</span>}
      </div>
      <p className="mt-1.5 text-[11px] text-ink-3">대표: {r.owner}{r.note ? ` · ${r.note}` : ''}{r.mode === 'toggle' && r.isDefault ? ` · 기본값(${r.enabled ? '켬' : '끔'})` : ''}</p>
      <div className="mt-2 space-y-0.5 text-[11px]">
        <p data-testid="team-role-last">{r.last ? <><span className={cx('mr-1 inline-block size-1.5 rounded-full align-middle', REC_DOT[r.last.status] ?? 'bg-slate-300')} />마지막 {fmtDateTime(r.last.at)} · {r.last.summary}</> : <span className="text-ink-3">아직 일한 기록 없음</span>}</p>
        <p className="text-ink-2" data-testid="team-role-next">다음: {r.next ?? '꺼져 있음'}</p>
        {r.stats.map((s, k) => <p key={k} className="text-ink-2" data-testid="team-role-stat">{s}</p>)}
      </div>
      {r.key === 'planner' && data.canDecide && data.brands.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]" data-testid="team-planner-brands"><span className="text-ink-3">주제 낼 브랜드</span>
        {data.brands.map((b) => <button key={b.id} type="button" aria-pressed={b.planned} disabled={!!busy} data-testid="team-planner-brand" data-id={b.id}
          className={cx('rounded-full border px-2 py-0.5', b.planned ? 'border-violet-400 bg-violet-50 text-violet-800' : 'border-line text-ink-3')}
          onClick={() => { const cur = data.brands.filter((x) => x.planned).map((x) => x.id); const next = b.planned ? cur.filter((x) => x !== b.id) : [...cur, b.id];
            team({ action: 'brands', brandIds: next.length === data.brands.length ? [] : next.length ? next : [b.id] }, `brands:${b.id}`); }}>{b.name}</button>)}</div>}
      <details className="mt-2 text-xs"><summary className="cursor-pointer text-ink-2">레시피 {r.recipe.length}단계</summary>
        <ol className="ml-4 mt-1 list-decimal space-y-0.5 text-[11px] text-ink-2">{r.recipe.map((s, k) => <li key={k}>{s}</li>)}</ol></details>
      <details className="mt-1 text-xs" data-testid="team-role-records"><summary className="cursor-pointer text-ink-2">기록 {r.records.length}</summary>
        {r.records.length === 0 ? <p className="mt-1 text-[11px] text-ink-3">아직 없습니다</p>
          : <ul className="mt-1 space-y-1">{r.records.map((l) => <li key={l.id} className="text-[11px]" data-testid="team-record" data-status={l.status}>
              <span className={cx('mr-1 inline-block size-1.5 rounded-full align-middle', REC_DOT[l.status] ?? 'bg-slate-300')} />
              {l.link ? <Link href={l.link} className="underline">{l.title}</Link> : l.title}<span className="ml-1 text-ink-3">{fmtDateTime(l.created_at)}</span>
              {l.detail && <span className="block text-red-700">{l.detail}</span>}</li>)}</ul>}</details>
      {r.ai && <details className="mt-1 text-xs" data-testid="team-role-memory"><summary className="cursor-pointer text-ink-2">기억 {r.memoryCount}</summary>
        {r.memory.length === 0 ? <p className="mt-1 text-[11px] text-ink-3">아직 없습니다 — 채택·반려·수정 요청·대표 메모가 쌓이면 이 역할의 AI 지시문에 들어갑니다</p>
          : <ul className="mt-1 space-y-1">{r.memory.map((m) => <li key={m.id} className="text-[11px]" data-testid="team-memory-item" data-kind={m.kind}>
              <span className={cx('mr-1 rounded px-1', MEM_KIND[m.kind][1])}>{MEM_KIND[m.kind][0]}</span>{m.brand_name && <span className="mr-1 text-ink-3">[{m.brand_name}]</span>}{m.text}{m.reason && <span className="text-ink-2"> — {m.reason}</span>}
              <span className="ml-1 text-ink-3">{m.created_by_name ?? ''} {fmtDateTime(m.created_at)}</span>
              {data.canDecide && <button type="button" className="ml-1 text-ink-3 underline" disabled={!!busy} data-testid="team-memory-forget" onClick={() => team({ action: 'forget', id: m.id }, `forget:${m.id}`, () => '기억에서 지웠습니다')}>지우기</button>}</li>)}</ul>}
        {data.canDecide && <div className="mt-1.5 flex flex-wrap gap-1">
          <input className={cx(inputCls, 'h-8 min-w-0 flex-1 text-xs')} value={note} maxLength={1000} placeholder={`${josa(r.name, '이가')} 기억할 것(예: '관리비' 대신 '운영비')`} onChange={(e) => setNote(e.target.value)} data-testid="team-memory-input" />
          {data.brands.length > 0 && <select className={cx(inputCls, 'h-8 w-auto text-xs')} value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="브랜드" data-testid="team-memory-brand">
            <option value="">회사 전체</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
          <Button size="sm" variant="secondary" disabled={!!busy || note.trim().length < 2} data-testid="team-memory-add"
            onClick={async () => { const ok = await team({ action: 'remember', role: r.key, text: note.trim(), brandId: brand || null }, `mem:${r.key}`, () => `${josa(r.name, '이가')} 기억합니다`); if (ok) setNote(''); }}>기억시키기</Button></div>}
      </details>}
      {r.key === 'designer' && <GuideBox data={data} busy={busy} team={team} />}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
        <Link href={r.link.href} className="text-xs font-medium underline" style={{ color: C }}>{r.link.label} →</Link>
        {r.canRun && data.canDecide && r.key !== 'planner' && <Button size="sm" variant="secondary" className="ml-auto" disabled={!!busy} data-testid="team-role-run"
          onClick={() => team({ action: 'run', role: r.key }, `run:${r.key}`, (x) => (r.key === 'researcher' ? (x.created ? `주간 분석(${x.week})을 만들었습니다 — 광고 ${x.n}개` : x.skipped === 'done' ? `이번 주(${x.week}) 분석은 이미 있습니다` : `지난 7일 새 광고가 ${x.n ?? 0}개라 건너뜁니다(3개부터)`) : `주간 운영 제안을 만들었습니다(${x.items ?? 0}건) — 승인함에서 확인`))}>
          {busy === `run:${r.key}` ? '하는 중…' : '지금 일하기'}</Button>}
      </div>
    </div>
  );
}
