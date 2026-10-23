'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

/**
 * #499-4 상황 매트릭스 소재 생성기: 운영실 '광고 컨셉' 상자(만들기·최근 매트릭스) + 승인함 '광고 컨셉' 탭(같은 카드).
 * 구매자 역할 × 상황(고통·제안) → AI 컨셉 8~12개 → 대표가 1~4개 채택 → 컨셉마다 광고형 제작 의뢰. 반려 사유 → AI 고친 안. 채택한 컨셉 → [새 각도].
 */
export type Concept = { id: string; role: string; situation: string; pain: string; offer: string; hook: string; headline: string; primary: string; angle: string; format: 'video' | 'image';
  score: { score: number; pass: boolean; fails: string[]; notes: string[] } | null; decision: 'adopted' | 'rejected' | null };
type Situation = { name: string; pain: string; offer: string };
export type ConceptSet = { id: string; brand_id: string | null; brand: string | null; product: string; input: { roles: string[]; situations: Situation[]; note?: string; variantOf?: { hook: string } }; concepts: Concept[];
  status: 'pending' | 'decided' | 'rejected'; source: 'ai' | 'template'; version: number; revision_note: string | null; decision_note: string | null; created_by: string | null; created_by_name: string | null;
  decided_by_name: string | null; decided_at: string | null; created_at: string; briefs: { conceptId: string; briefId: string; status: string }[] };
type View = { sets: ConceptSet[]; brands: { id: string; name: string }[]; canDecide: boolean; userId: string; maxRevisions: number; aiEnabled: boolean };
const C = '#7C3AED';
const SET_STATUS: Record<string, [string, string]> = { pending: ['채택 대기', 'bg-orange-50 text-orange-800'], decided: ['채택함', 'bg-emerald-50 text-emerald-800'], rejected: ['반려', 'bg-slate-100 text-ink-2'] };
const FORMAT: Record<string, string> = { video: '15초 세로 영상', image: '이미지 4:5' };
const MAX_PICK = 4;

/** 운영실 상자: [새 상황 매트릭스] + 최근 매트릭스(채택 대기 먼저) */
export function ConceptBox() {
  const { data, error, reload } = useApi<View>('/api/marketing/concepts');
  const [form, setForm] = useState(false);
  return (
    <section id="concepts" className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="concepts">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">광고 컨셉 <span className="font-normal text-ink-2">상황 매트릭스</span></h2>
        <Button size="sm" className="ml-auto" onClick={() => setForm(true)} disabled={!data} data-testid="concept-new">새 상황 매트릭스</Button></div>
      <p className="mt-1 text-xs text-ink-2">구매자 역할 × 상황(고통·제안)을 적으면 AI 마케터가 광고 컨셉 8~12개를 냅니다 → 대표가 1~4개 채택 → 컨셉마다 광고형 제작 의뢰. 채택·반려 기록은 같은 브랜드 다음 컨셉의 재료가 됩니다.</p>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Skeleton rows={2} /> : data.sets.length ? (
        <div className="mt-2 space-y-3">{data.sets.slice(0, 6).map((s) => <ConceptSetCard key={s.id} s={s} canDecide={data.canDecide} userId={data.userId} maxRevisions={data.maxRevisions} onChange={reload} />)}</div>
      ) : <p className="mt-2 rounded-input border border-dashed border-line p-4 text-center text-xs text-ink-3" data-testid="concept-empty">아직 만든 매트릭스가 없습니다 — [새 상황 매트릭스]</p>}
      {form && data && <MatrixForm brands={data.brands} aiEnabled={data.aiEnabled} onClose={() => setForm(false)} onDone={() => { setForm(false); reload(); }} />}
    </section>
  );
}

function MatrixForm({ brands, aiEnabled, onClose, onDone }: { brands: View['brands']; aiEnabled: boolean; onClose: () => void; onDone: () => void }) {
  const [brandId, setBrandId] = useState(brands.length === 1 ? brands[0].id : '');
  const [product, setProduct] = useState('');
  const [roles, setRoles] = useState<string[]>([]); const [role, setRole] = useState('');
  const [sits, setSits] = useState<Situation[]>([{ name: '', pain: '', offer: '' }]);
  const [note, setNote] = useState(''); const [count, setCount] = useState(10);
  const [busy, setBusy] = useState('');
  const addRole = () => { const r = role.trim(); if (r && roles.length < 6 && !roles.includes(r)) setRoles([...roles, r.slice(0, 30)]); setRole(''); };
  const setSit = (k: number, p: Partial<Situation>) => setSits(sits.map((s, j) => (j === k ? { ...s, ...p } : s)));
  const filled = sits.filter((s) => s.name.trim());
  async function suggest() {
    setBusy('suggest');
    try {
      const r = await api<{ product: string; roles: string[]; situations: Situation[]; source: string }>('/api/marketing/concepts/suggest', { body: { brandId: brandId || null } });
      if (!product.trim() && r.product) setProduct(r.product);
      if (!roles.length && r.roles.length) setRoles(r.roles.slice(0, 6));
      if (!filled.length && r.situations.length) setSits(r.situations.slice(0, 6));
      toast.ok(r.source === 'ai' ? 'AI 가 초안을 채웠습니다 — 고친 뒤 [컨셉 만들기]' : 'AI 없이 브랜드 정보로 일부만 채웠습니다');
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  async function create() {
    setBusy('create');
    try {
      const r = await api<{ set: ConceptSet }>('/api/marketing/concepts', { body: { brandId: brandId || null, product: product.trim(), roles, situations: filled.map((s) => ({ name: s.name.trim(), pain: s.pain.trim(), offer: s.offer.trim() })), ...(note.trim() ? { note: note.trim() } : {}), count } });
      toast.ok(`${r.set.source === 'ai' ? 'AI 마케터가' : 'AI 없이 기본 조합으로'} 컨셉 ${r.set.concepts.length}개를 만들었습니다 — 1~4개를 채택해 주세요`); onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  return (
    <Modal open onClose={onClose} title="새 상황 매트릭스" wide>
      <div className="space-y-3 text-sm" data-testid="concept-form">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="브랜드"><select className={inputCls} value={brandId} onChange={(e) => setBrandId(e.target.value)} data-testid="concept-brand"><option value="">브랜드 없음(회사 전체)</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Button variant="secondary" onClick={suggest} disabled={busy !== '' || !aiEnabled} title={aiEnabled ? '' : 'AI 연결 전'} data-testid="concept-suggest">{busy === 'suggest' ? '채우는 중…' : 'AI로 채우기'}</Button>
        </div>
        <Field label="제품·서비스(한 줄)"><input className={inputCls} value={product} maxLength={120} onChange={(e) => setProduct(e.target.value)} placeholder="예: 아파트 커뮤니티 위탁 운영" data-testid="concept-product" /></Field>
        <div><span className="mb-1 block text-xs font-medium text-ink-2">구매자 역할(최대 6) — 결정권자·실무자·영향자</span>
          <div className="flex flex-wrap items-center gap-1.5">{roles.map((r) => <span key={r} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-800" data-testid="concept-role">{r}
            <button type="button" className="text-violet-500 hover:text-violet-900" onClick={() => setRoles(roles.filter((x) => x !== r))} aria-label={`${r} 빼기`}>×</button></span>)}
            {roles.length < 6 && <span className="flex items-center gap-1"><span className="w-44"><input className={cx(inputCls, 'h-8 py-1 text-xs')} value={role} maxLength={30} onChange={(e) => setRole(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addRole(); } }} placeholder="예: 관리사무소장" data-testid="concept-role-input" /></span>
              <Button size="sm" variant="secondary" onClick={addRole} disabled={!role.trim()} data-testid="concept-role-add">추가</Button></span>}</div></div>
        <div><span className="mb-1 block text-xs font-medium text-ink-2">상황(최대 6) — 그 상황의 고통과 비용이 들지 않는 제안</span>
          <div className="space-y-1.5">{sits.map((s, k) => (
            <div key={k} className="grid gap-1.5 rounded-input border border-line p-1.5 sm:grid-cols-[1fr_1.4fr_1fr_auto]" data-testid="concept-sit">
              <input className={cx(inputCls, 'h-8 py-1 text-xs')} value={s.name} maxLength={40} onChange={(e) => setSit(k, { name: e.target.value })} placeholder="상황 예: 신축 입주 3~6개월 전" aria-label={`상황 ${k + 1}`} data-testid="concept-sit-name" />
              <input className={cx(inputCls, 'h-8 py-1 text-xs')} value={s.pain} maxLength={120} onChange={(e) => setSit(k, { pain: e.target.value })} placeholder="고통 예: 운영사·인력이 아직 미정" aria-label={`고통 ${k + 1}`} data-testid="concept-sit-pain" />
              <input className={cx(inputCls, 'h-8 py-1 text-xs')} value={s.offer} maxLength={80} onChange={(e) => setSit(k, { offer: e.target.value })} placeholder="제안 예: 입주 준비 체크리스트" aria-label={`제안 ${k + 1}`} data-testid="concept-sit-offer" />
              <Button size="sm" variant="secondary" onClick={() => setSits(sits.length > 1 ? sits.filter((_, j) => j !== k) : [{ name: '', pain: '', offer: '' }])} aria-label={`상황 ${k + 1} 빼기`}>빼기</Button>
            </div>))}</div>
          {sits.length < 6 && <button type="button" className="mt-1 text-xs underline" style={{ color: C }} onClick={() => setSits([...sits, { name: '', pain: '', offer: '' }])} data-testid="concept-sit-add">+ 상황 추가</button>}</div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Field label="메모(선택)"><input className={inputCls} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="예: 이번 달은 재계약 단지 위주" data-testid="concept-note" /></Field>
          <Field label="컨셉 수"><select className={inputCls} value={count} onChange={(e) => setCount(Number(e.target.value))} data-testid="concept-count">{[8, 10, 12].map((n) => <option key={n} value={n}>{n}개</option>)}</select></Field>
        </div>
        <p className="text-[11px] text-ink-3">숫자·실적·가격은 회사·브랜드 정보에 있는 것만 씁니다 — 없으면 {'{{ }}'}로 비워 두니 채택 뒤 제작의뢰실에서 채워 주세요. 만들기는 AI 요청 1회입니다.</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>닫기</Button>
          <Button onClick={create} disabled={busy !== '' || product.trim().length < 2 || !roles.length || !filled.length} data-testid="concept-create">{busy === 'create' ? 'AI 가 컨셉을 만드는 중…(20초 안팎)' : '컨셉 만들기'}</Button></div>
      </div>
    </Modal>
  );
}

/** 매트릭스 카드(운영실·승인함 공용): 역할 × 상황 칸별 컨셉 수 · 컨셉(광고형 첫 줄 점수) · 채택 1~4개 / 반려(사유 → AI 고친 안) / 취소 · 채택 뒤 제작 의뢰 상태·[새 각도] */
export function ConceptSetCard({ s, canDecide, userId, maxRevisions, onChange }: { s: ConceptSet; canDecide: boolean; userId: string; maxRevisions: number; onChange: () => void }) {
  const [pick, setPick] = useState<string[]>([]); const [note, setNote] = useState(''); const [reject, setReject] = useState(false); const [busy, setBusy] = useState('');
  const [sl, sc] = SET_STATUS[s.status] ?? [s.status, ''];
  const pending = s.status === 'pending';
  const roles = [...new Set([...(s.input?.roles ?? []), ...s.concepts.map((c) => c.role)])];
  const sits = [...new Set([...(s.input?.situations ?? []).map((x) => x.name), ...s.concepts.map((c) => c.situation)])];
  const brief = (id: string) => s.briefs.find((b) => b.conceptId === id);
  async function act(body: Record<string, unknown>, ok: (r: any) => string, key: string) {
    setBusy(key);
    try { const r = await api<any>(`/api/marketing/concepts/${s.id}`, { method: 'PATCH', body }); toast.ok(ok(r)); setPick([]); setReject(false); onChange(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  async function variant(c: Concept) {
    setBusy(`v-${c.id}`);
    try { const r = await api<{ set: ConceptSet }>(`/api/marketing/concepts/${s.id}/variant`, { body: { conceptId: c.id } }); toast.ok(`'${c.role}·${c.situation}' 새 각도 ${r.set.concepts.length}개 — 채택 대기`); onChange(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  }
  const toggle = (id: string) => setPick(pick.includes(id) ? pick.filter((x) => x !== id) : pick.length < MAX_PICK ? [...pick, id] : pick);
  return (
    <article className="rounded-card border border-line bg-white p-3" data-testid="concept-set" data-status={s.status} data-version={s.version}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-800">{s.brand ?? '회사 전체'}</span>
        <span className={cx('rounded-full px-2 py-0.5 font-semibold', sc)} data-testid="concept-set-status">{sl}</span>
        {s.version > 1 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">v{s.version}</span>}
        {s.input?.variantOf && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-800" data-testid="concept-variant-of">새 각도 · «{s.input.variantOf.hook}»</span>}
        <span className="text-ink-3">{s.source === 'ai' ? 'AI 마케터' : '기본 조합(AI 없이)'} · {s.created_by_name ?? ''} · {fmtDateTime(s.created_at)}</span>
      </div>
      <h3 className="mt-1 text-sm font-bold" data-testid="concept-set-product">{s.product}</h3>
      {s.revision_note && <p className="mt-1 rounded-input border border-amber-200 bg-amber-50/50 px-2.5 py-1.5 text-[11px] text-ink-2" data-testid="concept-revision"><b className="text-amber-800">반려 사유 → 반영한 점</b> {s.revision_note}</p>}
      {/* 역할 × 상황 칸마다 컨셉 수(채택한 칸은 진하게) — 비어 있는 칸이 다음 매트릭스 후보 */}
      <div className="mt-2 overflow-x-auto"><table className="min-w-full border-collapse text-[11px]" data-testid="concept-grid">
        <thead><tr><th className="border border-line bg-slate-50 px-1.5 py-1 text-left font-medium text-ink-2">상황 \ 역할</th>{roles.map((r) => <th key={r} className="whitespace-nowrap border border-line bg-slate-50 px-1.5 py-1 font-medium">{r}</th>)}</tr></thead>
        <tbody>{sits.map((x) => (<tr key={x}><th className="whitespace-nowrap border border-line px-1.5 py-1 text-left font-medium">{x}</th>{roles.map((r) => { const cs = s.concepts.filter((c) => c.role === r && c.situation === x); const ad = cs.filter((c) => c.decision === 'adopted').length;
          return <td key={r} className={cx('border border-line px-1.5 py-1 text-center', ad ? 'bg-emerald-100 font-semibold text-emerald-900' : cs.length ? 'bg-violet-50 text-violet-900' : 'text-ink-3')} data-testid="concept-cell">{cs.length ? `${cs.length}${ad ? ` · 채택 ${ad}` : ''}` : '·'}</td>; })}</tr>))}</tbody></table></div>
      <ul className="mt-2 space-y-1.5">{s.concepts.map((c) => { const b = brief(c.id); const on = pick.includes(c.id); return (
        <li key={c.id} className={cx('rounded-input border p-2 text-xs', c.decision === 'adopted' ? 'border-emerald-300 bg-emerald-50/40' : on ? 'border-violet-400 bg-violet-50/50' : 'border-line', c.decision === 'rejected' && 'opacity-60')} data-testid="concept-item" data-id={c.id} data-decision={c.decision ?? ''}>
          <div className="flex items-start gap-2">
            {pending && canDecide && <input type="checkbox" className="mt-1" checked={on} disabled={!on && pick.length >= MAX_PICK} onChange={() => toggle(c.id)} aria-label={`${c.hook} 채택`} data-testid="concept-pick" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1 text-[11px]"><span className="rounded bg-slate-100 px-1.5 py-0.5">{c.role}</span><span className="rounded bg-slate-100 px-1.5 py-0.5">{c.situation}</span><span className="text-ink-3">{FORMAT[c.format]}</span>
                {c.score && <span className={cx('rounded-full px-1.5 py-0.5 font-semibold', c.score.pass ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')} title={[...c.score.fails, ...c.score.notes].join(' · ')} data-testid="concept-score">광고형 {c.score.score}점</span>}
                {c.decision === 'adopted' && <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 font-semibold text-white">채택</span>}</div>
              <p className="mt-1 break-words text-sm font-semibold" data-testid="concept-hook">{c.hook}</p>
              <p className="mt-0.5 text-ink-2">{c.pain}{c.pain && c.offer ? ' → ' : ''}<b className="text-ink">{c.offer}</b></p>
              {c.angle && <p className="mt-0.5 text-ink-3">{c.angle}</p>}
              {c.score && !c.score.pass && (c.score.fails.length > 0 || c.score.notes.length > 0) && <p className="mt-0.5 text-[11px] text-amber-800">{[...c.score.fails, ...c.score.notes].join(' · ')}</p>}
              {(c.headline || c.primary) && <details className="mt-1"><summary className="cursor-pointer text-[11px] text-ink-2">제목·본문</summary><p className="mt-1 font-medium">{c.headline}</p><p className="whitespace-pre-line text-ink-2">{c.primary}</p></details>}
              {c.decision === 'adopted' && <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">{b && <Link href="/s/marketing/automation?tab=studio" className="underline" data-testid="concept-brief">제작 의뢰 · {b.status} →</Link>}
                <Button size="sm" variant="secondary" disabled={busy !== ''} onClick={() => variant(c)} data-testid="concept-variant">{busy === `v-${c.id}` ? '만드는 중…' : '새 각도'}</Button></div>}
            </div>
          </div>
        </li>); })}</ul>
      {s.decision_note && <p className="mt-2 text-[11px] text-ink-2">결정 메모: {s.decision_note}</p>}
      {!pending && s.decided_by_name && <p className="mt-1 text-[11px] text-ink-3" data-testid="concept-decided">{s.decided_by_name} · {s.decided_at ? fmtDateTime(s.decided_at) : ''}{s.briefs.length ? ` · 채택 ${s.briefs.length}개 → 제작 의뢰 ${s.briefs.length}건` : ''}</p>}
      {pending && <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {canDecide && !reject && <><span className="text-xs text-ink-2" data-testid="concept-picked">선택 {pick.length}/{MAX_PICK}</span>
          <span className="min-w-40 flex-1"><input className={cx(inputCls, 'h-8 py-1 text-xs')} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="채택 메모(선택) — 다음 컨셉의 재료" aria-label="채택 메모" data-testid="concept-note-decide" /></span>
          <Button size="sm" disabled={busy !== '' || !pick.length} onClick={() => act({ action: 'adopt', conceptIds: pick, ...(note.trim() ? { note: note.trim() } : {}) }, (r) => `${r.briefs.length}개 채택 — 제작 의뢰 ${r.briefs.length}건(프롬프트는 곧 준비됩니다)`, 'adopt')} data-testid="concept-adopt">{busy === 'adopt' ? '채택하는 중…' : '채택하고 제작 의뢰'}</Button>
          <Button size="sm" variant="secondary" disabled={busy !== ''} onClick={() => setReject(true)} data-testid="concept-reject">반려</Button></>}
        {canDecide && reject && <><span className="min-w-40 flex-1"><input className={cx(inputCls, 'h-8 py-1 text-xs')} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={s.version < maxRevisions ? '반려 사유 — AI 가 반영해 다시 만듭니다' : '반려 사유'} aria-label="반려 사유" data-testid="concept-reject-note" /></span>
          <Button size="sm" disabled={busy !== '' || !note.trim()} onClick={() => act({ action: 'reject', note: note.trim() }, (r) => (r.revised ? `반려했습니다 — AI 가 사유를 반영한 v${r.revised.version} 를 다시 올렸습니다` : '반려했습니다'), 'reject')} data-testid="concept-reject-go">{busy === 'reject' ? (s.version < maxRevisions ? 'AI 가 고치는 중…' : '반려하는 중…') : '반려 확정'}</Button>
          <Button size="sm" variant="secondary" onClick={() => setReject(false)}>취소</Button></>}
        {(s.created_by === userId || canDecide) && !reject && <Button size="sm" variant="secondary" className={canDecide ? '' : 'ml-auto'} disabled={busy !== ''} onClick={() => confirm('이 매트릭스를 취소할까요? 컨셉은 기록으로 남지 않습니다.') && act({ action: 'cancel' }, () => '취소했습니다', 'cancel')} data-testid="concept-cancel">매트릭스 취소</Button>}
        {!canDecide && <span className="text-[11px] text-ink-3">채택은 대표·관리자가 합니다</span>}
      </div>}
    </article>
  );
}
