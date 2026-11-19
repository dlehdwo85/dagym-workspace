'use client';
// 점검 2단계 — 점검하기 · 보완 확인 화면(휴대폰 폭 먼저). 자료는 /api/check/home · rounds · followups · external.
// 보완 확인은 업무의 검토 기능이 아니라 여기서: 담당자가 업무를 [완료]하면 '확인 대기' → [양호 확인] 또는 [다시 보완](같은 담당자에게 새 업무).
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Camera, Check, ChevronDown, ClipboardCheck, Loader2, Play, Plus, Search } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useMultiSite, useSession, useTerms } from '@/components/session';
import { Button, Empty, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, inputCls, toast } from '@/components/ui';
import { shrinkImage } from '@/components/shrink';

type Course = { id: string; name: string; orgUnitId: string | null };
type Followup = { id: string; state: 'requested' | 'waiting' | 'closed' | 'canceled'; roundNo: number; dueDate: string | null; note: string | null; closeNote: string | null; taskId: string | null; orgUnitName: string; itemTitle: string;
  passCriteria: string; memo: string | null; placeTypeName: string | null; assigneeName: string | null; photos: number; photoIds: string[]; checkPhotoIds: string[]; external: { id: string; target: string; replyDue: string | null; outcome: string | null; closed: boolean }[] };
type Home = { open: { id: string; org_unit_name: string; course_name: string | null; kind: string; done: number }[]; recent: { id: string; org_unit_name: string; course_name: string | null; kind: string; ended_at: string; checker_name: string | null; ok: number; fix: number }[];
  counts: { requested: number; waiting: number; closed: number }; improvements: { id: string; streak: number; task_id: string | null; item_title: string; org_unit_name: string; task_status: string | null }[];
  external: { id: string; target: string; replyDue: string | null; itemTitle: string; orgUnitName: string }[]; kinds: Record<string, string> };
const STATE: Record<string, [string, string]> = { requested: ['조치 중', 'bg-slate-100 text-ink-2'], waiting: ['확인 대기', 'bg-amber-100 text-amber-800'], closed: ['양호 확인', 'bg-green-100 text-green-800'], canceled: ['취소', 'bg-slate-100 text-ink-3'] };
const box = 'rounded-card border border-line bg-white shadow-card';
const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
const fileData = (file: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('사진을 읽지 못했습니다')); r.readAsDataURL(file); });

// ---------------- 점검 홈(점검하기 탭) ----------------
export function RunHome() {
  const sess = useSession(); const multi = useMultiSite(); const terms = useTerms(); const router = useRouter();
  const home = useApi<Home>('/api/check/home');
  const courses = useApi<{ courses: Course[] }>('/api/check/courses');
  const fus = useApi<{ followups: Followup[] }>('/api/check/followups?state=open');
  const units = sess.dir.orgUnits.filter((o) => o.active);
  const [unit, setUnit] = useState(units[0]?.id ?? ''); const [course, setCourse] = useState(''); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Followup | null>(null); const [ext, setExt] = useState<Home['external'][number] | null>(null);
  const usable = (courses.data?.courses ?? []).filter((c) => !c.orgUnitId || c.orgUnitId === unit);
  useEffect(() => { if (!usable.some((c) => c.id === course)) setCourse(usable[0]?.id ?? ''); }, [unit, courses.data]); // eslint-disable-line react-hooks/exhaustive-deps
  async function start(courseId: string | null) {
    if (!unit) return;
    setBusy(true);
    try { const r = await api<{ id: string }>('/api/check/rounds', { body: { orgUnitId: unit, courseId } }); router.push(`/check/round/${r.id}`); }
    catch (e: any) { toast.error(e.message); setBusy(false); }
  }
  const reload = () => { home.reload(); fus.reload(); };
  if (home.error) return <ErrorBox error={home.error} retry={home.reload} />;
  if (!home.data) return <Skeleton rows={6} />;
  const h = home.data;
  return (
    <div className="space-y-3 text-sm" data-testid="check-run">
      <section className={cx(box, 'p-3')} data-testid="check-start">
        <h2 className="font-semibold">점검하기</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
          {multi && units.length > 1 && <select className={cx(inputCls, 'h-10')} value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={terms.unit.branch} data-testid="check-start-unit">{units.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
          <select className={cx(inputCls, 'h-10')} value={course} onChange={(e) => setCourse(e.target.value)} aria-label="점검 코스" data-testid="check-start-course">
            {!usable.length && <option value="">코스가 없습니다</option>}
            {usable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Button className="h-10" disabled={busy || !course} onClick={() => start(course)} data-testid="check-start-go">{busy ? <Loader2 className="animate-spin" /> : <Play />}점검 시작</Button>
          <Button className="h-10" variant="secondary" disabled={busy || !unit} onClick={() => start(null)} data-testid="check-start-adhoc">수시 점검</Button>
        </div>
        <p className="mt-1.5 text-xs text-ink-3">코스 순서대로 항목을 보며 양호 · 보완 필요 · 해당 없음을 적습니다. 수시 점검은 코스 없이 본 것만 적습니다.</p>
        {!!h.open.length && (
          <ul className="mt-2 space-y-1 border-t border-line pt-2">
            {h.open.map((r) => <li key={r.id}><Link href={`/check/round/${r.id}`} className="flex items-center gap-2 rounded-input px-2 py-1.5 hover:bg-slate-50" data-testid="check-open-round">
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">이어서</span><span className="min-w-0 flex-1 truncate">{r.org_unit_name} · {r.course_name ?? h.kinds[r.kind] + ' 점검'}</span><span className="text-xs text-ink-3">{r.done}개 적음</span></Link></li>)}
          </ul>
        )}
      </section>
      <section className={box} data-testid="check-followups">
        <h2 className="flex items-center gap-2 border-b border-line px-3 py-2 font-semibold">보완 요청
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800" data-testid="check-count-waiting">확인 대기 {h.counts.waiting}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-2">조치 중 {h.counts.requested}</span></h2>
        {!fus.data ? <div className="p-3"><Skeleton rows={2} /></div> : !fus.data.followups.length ? <p className="p-3 text-ink-3">열린 보완 요청이 없습니다.</p> : (
          <ul className="divide-y divide-line">
            {fus.data.followups.map((f) => (
              <li key={f.id}><button type="button" onClick={() => setOpen(f)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-slate-50" data-testid="check-followup-row">
                <span className={cx('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', STATE[f.state][1])}>{STATE[f.state][0]}</span>
                <span className="min-w-0 flex-1"><span className="font-medium">{f.itemTitle}</span>{f.roundNo > 1 && <span className="ml-1 text-xs text-ink-3">{f.roundNo}차</span>}
                  <span className="mt-0.5 block text-xs text-ink-2">{f.orgUnitName}{f.placeTypeName ? ` · ${f.placeTypeName}` : ''} · {f.assigneeName ?? '담당 없음'}{f.dueDate ? ` · ${md(f.dueDate)}까지` : ''}</span></span>
              </button></li>
            ))}
          </ul>
        )}
      </section>
      {!!h.external.length && (
        <section className={box} data-testid="check-external">
          <h2 className="border-b border-line px-3 py-2 font-semibold">외부 연락 — 회신 기다리는 중</h2>
          <ul className="divide-y divide-line">{h.external.map((e) => (
            <li key={e.id} className="flex items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1"><span className="font-medium">{e.target}</span><span className="block text-xs text-ink-2">{e.itemTitle} · {e.orgUnitName}{e.replyDue ? ` · 회신 기한 ${md(e.replyDue)}` : ''}</span></span>
              <Button size="sm" variant="secondary" onClick={() => setExt(e)}>결과 적기</Button></li>))}</ul>
        </section>
      )}
      {!!h.improvements.length && (
        <section className={box} data-testid="check-improvements">
          <h2 className="border-b border-line px-3 py-2 font-semibold">개선 과제</h2>
          <ul className="divide-y divide-line">{h.improvements.map((m) => (
            <li key={m.id} className="flex items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1"><span className="font-medium">{m.item_title}</span><span className="block text-xs text-ink-2">{m.org_unit_name} · {m.streak}회 연속 보완 필요</span></span>
              {m.task_id && <Link href={`/tasks?task=${m.task_id}`} className="rounded-input border border-line px-2.5 py-1 text-xs font-medium hover:bg-slate-50">업무 열기</Link>}</li>))}</ul>
        </section>
      )}
      <section className={box} data-testid="check-recent">
        <h2 className="border-b border-line px-3 py-2 font-semibold">최근 점검</h2>
        {!h.recent.length ? <p className="p-3 text-ink-3">아직 끝낸 점검이 없습니다.</p> : (
          <ul className="divide-y divide-line">{h.recent.map((r) => (
            <li key={r.id}><Link href={`/check/round/${r.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50"><span className="min-w-0 flex-1 truncate">{r.org_unit_name} · {r.course_name ?? h.kinds[r.kind] + ' 점검'}</span>
              <span className="text-xs text-ink-2">양호 {r.ok} · 보완 {r.fix}</span><span className="text-xs text-ink-3">{md(String(r.ended_at).slice(0, 10))}</span></Link></li>))}</ul>
        )}
      </section>
      {open && <FollowupSheet f={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); reload(); }} />}
      {ext && <ExternalSheet e={ext} onClose={() => setExt(null)} onDone={() => { setExt(null); reload(); }} />}
    </div>
  );
}

function FollowupSheet({ f, onClose, onDone }: { f: Followup; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  async function decide(ok: boolean) {
    if (!ok && !note.trim()) { toast.error('무엇을 더 살펴보면 좋을지 한 줄 적어 주세요'); return; }
    setBusy(true);
    try { await api(`/api/check/followups/${f.id}`, { body: { ok, ...(note.trim() ? { note: note.trim() } : {}) } }); toast.ok(ok ? '양호로 확인했습니다' : '다시 살펴봐 달라고 요청했습니다 — 담당자에게 새 업무가 갔습니다'); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="보완 요청">
      <div className="space-y-3 text-sm" data-testid="check-followup">
        <div><p className="font-semibold">{f.itemTitle} <span className={cx('ml-1 rounded-full px-2 py-0.5 text-[11px] font-medium', STATE[f.state][1])}>{STATE[f.state][0]}</span></p>
          <p className="mt-0.5 text-xs text-ink-2">{f.orgUnitName}{f.placeTypeName ? ` · ${f.placeTypeName}` : ''} · {f.assigneeName ?? '담당 없음'}{f.dueDate ? ` · ${md(f.dueDate)}까지` : ''}{f.roundNo > 1 ? ` · ${f.roundNo}차` : ''}</p></div>
        <dl className="space-y-1 rounded-input bg-slate-50 p-2.5 text-xs">
          <div><dt className="inline font-medium">양호 기준: </dt><dd className="inline">{f.passCriteria || '-'}</dd></div>
          {f.memo && <div><dt className="inline font-medium">점검 때 본 것: </dt><dd className="inline">{f.memo}</dd></div>}
          {f.note && <div><dt className="inline font-medium">덧붙임: </dt><dd className="inline">{f.note}</dd></div>}
        </dl>
        {!!f.checkPhotoIds.length && <Photos label="점검 사진" srcs={f.checkPhotoIds.map((id) => `/api/check/photos/${id}`)} />}
        {f.photoIds.length ? <Photos label="조치 사진" srcs={f.photoIds.map((id) => `/api/attachments/${id}/download?inline=1`)} testid="check-fix-photo" /> : <p className="text-xs text-ink-3">아직 조치 사진이 없습니다.</p>}
        {f.taskId && <Link href={`/tasks?task=${f.taskId}`} className="inline-block text-xs font-medium text-brand-700 underline">보완 요청 업무 열기</Link>}
        {f.state === 'waiting' ? (
          <>
            <Field label="한마디(다시 보완이면 꼭 적어 주세요)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="예: 칸막이 아래쪽도 한 번 더 부탁드려요" data-testid="check-confirm-note" /></Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => decide(false)} data-testid="check-confirm-again">다시 보완</Button>
              <Button disabled={busy} onClick={() => decide(true)} data-testid="check-confirm-ok"><Check />양호 확인</Button>
            </div>
          </>
        ) : <p className="rounded-input border border-line p-2.5 text-xs text-ink-2">{f.state === 'requested' ? '담당자가 조치 사진을 올리고 업무를 완료하면 여기서 확인할 수 있습니다.' : f.closeNote || '확인이 끝났습니다.'}</p>}
      </div>
    </Modal>
  );
}
function Photos({ label, srcs, testid }: { label: string; srcs: string[]; testid?: string }) {
  return (
    <div><p className="mb-1 text-xs font-medium text-ink-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {srcs.map((s) => <a key={s} href={s} target="_blank" rel="noreferrer"><img src={s} alt={label} className="size-20 rounded-input border border-line object-cover" loading="lazy" data-testid={testid} /></a>)}
      </div></div>
  );
}
function ExternalSheet({ e, onClose, onDone }: { e: Home['external'][number]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(''); const [busy, setBusy] = useState(false);
  async function save(ev: React.FormEvent) { ev.preventDefault(); setBusy(true); try { await api(`/api/check/external/${e.id}`, { method: 'PATCH', body: { outcome: v.trim() } }); toast.ok('결과를 적었습니다'); onDone(); } catch (er: any) { toast.error(er.message); } finally { setBusy(false); } }
  return (
    <Modal open onClose={onClose} title="외부 연락 결과">
      <form onSubmit={save} className="space-y-3 text-sm">
        <p><b>{e.target}</b> · {e.itemTitle}</p>
        <Field label="회신·결과"><textarea className={inputCls} rows={3} value={v} onChange={(x) => setV(x.target.value)} maxLength={500} required placeholder="예: 다음 주 화요일 보수 예정" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>닫기</Button><Button type="submit" disabled={busy || !v.trim()}>저장</Button></div>
      </form>
    </Modal>
  );
}

// ---------------- 점검 1회 화면 ----------------
type RItem = { id: string; title: string; categoryName: string | null; method: string; methodNote: string | null; passCriteria: string; blindSpots: string[]; fixAction: { note?: string; dueDays?: number; external?: boolean };
  refPhotos: { id: string }[]; result: { id: string; verdict: 'ok' | 'fix' | 'na'; memo: string | null; photos: { id: string }[] } | null };
type Round = { round: { id: string; orgUnitId: string; orgUnitName: string; checkerId: string | null; checkerName: string | null; courseName: string | null; kind: string; kindLabel: string; endedAt: string | null };
  steps: { placeTypeId: string | null; name: string; items: RItem[] }[]; count: { ok: number; fix: number; na: number }; total: number; done: number; methods: Record<string, string>; verdicts: Record<string, string> };
const VBTN: Record<string, string> = { ok: 'border-green-600 bg-green-600 text-white', fix: 'border-amber-600 bg-amber-500 text-white', na: 'border-slate-500 bg-slate-500 text-white' };

export function RoundScreen({ id }: { id: string }) {
  const sess = useSession(); const router = useRouter();
  const { data, error, reload } = useApi<Round>(`/api/check/rounds/${id}`);
  const [finish, setFinish] = useState(false);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={8} />;
  const r = data.round; const mineOpen = !r.endedAt && r.checkerId === sess.user.id; const adhoc = r.kind === 'adhoc';
  return (
    <div className="mx-auto max-w-2xl pb-24" data-testid="check-round">
      <PageHeader title={`${r.orgUnitName} 점검`} sub={`${r.courseName ?? r.kindLabel + ' 점검'} · ${r.endedAt ? '끝낸 점검' : `${data.done}${adhoc ? '' : `/${data.total}`}개 적음`}${r.checkerName ? ` · ${r.checkerName}` : ''}`} icon={ClipboardCheck} />
      <div className="mb-3 flex gap-1.5 text-xs" data-testid="check-round-count">
        <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800">양호 {data.count.ok}</span><span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">보완 필요 {data.count.fix}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-ink-2">해당 없음 {data.count.na}</span>
      </div>
      {adhoc && mineOpen && <AdhocAdd roundId={id} onAdded={reload} />}
      <div className="space-y-3">
        {data.steps.map((s) => (
          <section key={s.placeTypeId ?? 'general'} className={box} data-testid="check-step">
            <h2 className="flex items-center justify-between border-b border-line bg-slate-50 px-3 py-2 text-sm font-semibold">{s.name}<span className="text-xs font-normal text-ink-3">{s.items.filter((i) => i.result).length}/{s.items.length}</span></h2>
            {!s.items.length ? <p className="p-3 text-sm text-ink-3">위에서 항목을 찾아 적어 주세요.</p> : <ul className="divide-y divide-line">{s.items.map((it) => <ItemCard key={it.id} roundId={id} placeTypeId={s.placeTypeId} it={it} data={data} editable={mineOpen} onSaved={reload} />)}</ul>}
          </section>
        ))}
      </div>
      {mineOpen && (
        <div className="fixed inset-x-0 bottom-[calc(var(--sab)+64px)] z-30 px-3 sm:bottom-4"><div className="mx-auto flex max-w-2xl justify-end">
          <Button className="h-11 px-5 shadow-pop" disabled={!data.done} onClick={() => setFinish(true)} data-testid="check-finish-open">점검 끝내기</Button></div></div>
      )}
      {finish && <FinishSheet data={data} onClose={() => setFinish(false)} onDone={() => router.push('/check?tab=run')} />}
    </div>
  );
}
function AdhocAdd({ roundId, onAdded }: { roundId: string; onAdded: () => void }) {
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const found = useApi<{ items: { id: string; title: string; categoryName: string | null; passCriteria: string }[] }>(dq ? `/api/check/rounds/${roundId}/items?q=${encodeURIComponent(dq)}` : null);
  async function add(itemId: string) { try { await api(`/api/check/rounds/${roundId}/results`, { method: 'PUT', body: { itemId, verdict: 'ok' } }); setQ(''); onAdded(); } catch (e: any) { toast.error(e.message); } }
  return (
    <div className={cx(box, 'mb-3 p-3')} data-testid="check-adhoc">
      <label className="relative block"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input className={cx(inputCls, 'h-10 pl-8')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="본 항목 찾기(예: 소화기)" aria-label="항목 찾기" data-testid="check-adhoc-search" /></label>
      {!!dq && <ul className="mt-2 divide-y divide-line rounded-input border border-line">{(found.data?.items ?? []).map((i) => (
        <li key={i.id}><button type="button" onClick={() => add(i.id)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-slate-50" data-testid="check-adhoc-item"><Plus className="size-4 shrink-0 text-brand-600" /><span className="min-w-0 flex-1"><span className="font-medium">{i.title}</span><span className="block truncate text-xs text-ink-2">{i.passCriteria}</span></span></button></li>))}
        {found.data && !found.data.items.length && <li className="px-2.5 py-2 text-sm text-ink-3">찾는 항목이 없습니다.</li>}</ul>}
    </div>
  );
}
function ItemCard({ roundId, placeTypeId, it, data, editable, onSaved }: { roundId: string; placeTypeId: string | null; it: RItem; data: Round; editable: boolean; onSaved: () => void }) {
  const [more, setMore] = useState(false); const [memo, setMemo] = useState(it.result?.memo ?? ''); const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setMemo(it.result?.memo ?? ''), [it.result?.memo]);
  async function save(verdict: 'ok' | 'fix' | 'na', m = memo) {
    setBusy(true);
    try { await api(`/api/check/rounds/${roundId}/results`, { method: 'PUT', body: { itemId: it.id, placeTypeId, verdict, memo: m.trim() || null } }); onSaved(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function addPhoto(files: FileList | null) {
    if (!files?.length || !it.result) return;
    setBusy(true);
    try { for (const raw of Array.from(files)) { const f = await shrinkImage(raw); await api(`/api/check/rounds/${roundId}/results/${it.result.id}/photos`, { body: { fileName: f.name || 'photo.jpg', mimeType: /^image\/(jpeg|png|webp)$/.test(f.type) ? f.type : 'image/jpeg', data: await fileData(f) } }); } onSaved(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  const v = it.result?.verdict;
  return (
    <li className="px-3 py-3" data-testid="check-round-item">
      <button type="button" onClick={() => setMore(!more)} className="flex w-full items-start gap-2 text-left" aria-expanded={more}>
        <span className="min-w-0 flex-1"><span className="font-medium">{it.title}</span><span className="mt-0.5 block text-sm text-ink-2">{it.passCriteria || '-'}</span></span>
        <ChevronDown className={cx('mt-1 size-4 shrink-0 text-ink-3 transition-transform', more && 'rotate-180')} />
      </button>
      {more && (
        <div className="mt-2 space-y-1.5 rounded-input bg-slate-50 p-2.5 text-xs text-ink-2" data-testid="check-round-guide">
          <p><b className="text-ink">확인 방법</b> {data.methods[it.method] ?? it.method}{it.methodNote ? ` — ${it.methodNote}` : ''}</p>
          {!!it.blindSpots.length && <p><b className="text-ink">놓치기 쉬운 곳</b> {it.blindSpots.join(' · ')}</p>}
          {it.fixAction?.note && <p><b className="text-ink">보완 시 조치</b> {it.fixAction.note}</p>}
          {!!it.refPhotos.length && <Photos label="기준 사진" srcs={it.refPhotos.map((p) => `/api/check/photos/${p.id}`)} />}
        </div>
      )}
      <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label={`${it.title} 판정`}>
        {(['ok', 'fix', 'na'] as const).map((k) => (
          <button key={k} type="button" disabled={!editable || busy} onClick={() => save(k)} aria-pressed={v === k} data-testid={`check-verdict-${k}`}
            className={cx('h-11 rounded-input border text-sm font-semibold disabled:opacity-60', v === k ? VBTN[k] : 'border-line bg-white text-ink-2 hover:bg-slate-50')}>{data.verdicts[k]}</button>
        ))}
      </div>
      {it.result && (
        <div className="mt-2 space-y-1.5">
          {editable ? <input className={cx(inputCls, 'h-9')} value={memo} onChange={(e) => setMemo(e.target.value)} onBlur={() => { if ((memo.trim() || null) !== (it.result?.memo ?? null)) save(it.result!.verdict); }} maxLength={1000}
            placeholder={v === 'fix' ? '본 것을 적어 주세요(예: 세면대 아래 물기)' : '메모(선택)'} aria-label={`${it.title} 메모`} data-testid="check-round-memo" />
            : it.result.memo && <p className="text-sm text-ink-2">{it.result.memo}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {it.result.photos.map((p) => <a key={p.id} href={`/api/check/photos/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/check/photos/${p.id}`} alt={`${it.title} 점검 사진`} className="size-14 rounded-input border border-line object-cover" loading="lazy" data-testid="check-round-photo" /></a>)}
            {editable && it.result.photos.length < 6 && (<><input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addPhoto(e.target.files)} data-testid="check-round-photo-input" />
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="inline-flex h-9 items-center gap-1 rounded-input border border-line px-2.5 text-xs font-medium text-ink-2 hover:bg-slate-50">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}사진</button></>)}
          </div>
        </div>
      )}
    </li>
  );
}

function FinishSheet({ data, onClose, onDone }: { data: Round; onClose: () => void; onDone: () => void }) {
  const sess = useSession();
  const fixes = useMemo(() => data.steps.flatMap((s) => s.items.filter((i) => i.result?.verdict === 'fix').map((i) => ({ ...i, place: s.placeTypeId ? s.name : null }))), [data]);
  const people = sess.dir.users.filter((u) => u.org_unit_ids.includes(data.round.orgUnitId) && !u.is_demo);
  const others = sess.dir.users.filter((u) => !u.org_unit_ids.includes(data.round.orgUnitId) && !u.is_demo);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const plus = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const [f, setF] = useState<Record<string, { assigneeId: string; dueDate: string; note: string; target: string; replyDue: string }>>(() => Object.fromEntries(fixes.map((x) => [x.result!.id,
    { assigneeId: '', dueDate: plus(Math.max(0, x.fixAction?.dueDays ?? 3)), note: '', target: x.fixAction?.external ? '건물 관리처' : '', replyDue: x.fixAction?.external ? plus(7) : '' }])));
  const [busy, setBusy] = useState(false);
  const set = (rid: string, k: string, v: string) => setF((s) => ({ ...s, [rid]: { ...s[rid], [k]: v } }));
  async function go() {
    setBusy(true);
    try {
      const followups = fixes.map((x) => { const v = f[x.result!.id]; return { resultId: x.result!.id, assigneeId: v.assigneeId || null, dueDate: v.dueDate || null, ...(v.note.trim() ? { note: v.note.trim() } : {}), ...(v.target.trim() ? { external: { target: v.target.trim(), replyDue: v.replyDue || null } } : {}) }; });
      const r = await api<{ followups: unknown[]; improvements: unknown[] }>(`/api/check/rounds/${data.round.id}/finish`, { body: { followups } });
      toast.ok(`점검을 끝냈습니다${r.followups.length ? ` — 보완 요청 ${r.followups.length}건을 보냈습니다` : ''}${r.improvements.length ? ` · 개선 과제 ${r.improvements.length}건` : ''}`); onDone();
    } catch (e: any) { toast.error(e.message); setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="점검 끝내기" wide>
      <div className="space-y-3 text-sm" data-testid="check-finish">
        <p>양호 <b>{data.count.ok}</b> · 보완 필요 <b>{data.count.fix}</b> · 해당 없음 <b>{data.count.na}</b>{data.total > data.done ? <span className="text-ink-3"> · 안 적은 항목 {data.total - data.done}개</span> : null}</p>
        {!fixes.length ? <p className="rounded-input bg-green-50 p-2.5 text-green-800">보완이 필요한 곳이 없습니다.</p> : (
          <>
            <p className="text-xs text-ink-2">보완 필요로 적은 항목마다 담당자에게 <b>보완 요청 업무</b>가 갑니다. 담당자가 조치 사진을 올리고 완료하면 점검 화면에서 확인합니다.</p>
            <ul className="space-y-2">
              {fixes.map((x) => { const v = f[x.result!.id]; return (
                <li key={x.result!.id} className="rounded-input border border-line p-2.5" data-testid="check-finish-row">
                  <p className="font-medium">{x.title}{x.place ? <span className="ml-1 text-xs font-normal text-ink-3">{x.place}</span> : null}</p>
                  {x.result!.memo && <p className="text-xs text-ink-2">{x.result!.memo}</p>}
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_9rem]">
                    <select className={cx(inputCls, 'h-9')} value={v.assigneeId} onChange={(e) => set(x.result!.id, 'assigneeId', e.target.value)} aria-label={`${x.title} 담당자`} data-testid="check-finish-assignee">
                      <option value="">담당자 고르기(비우면 담당 없음)</option>
                      {people.map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` · ${u.title}` : ''}</option>)}
                      {!!others.length && <optgroup label="다른 곳 사람">{others.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</optgroup>}
                    </select>
                    <input type="date" className={cx(inputCls, 'h-9')} value={v.dueDate} min={today} onChange={(e) => set(x.result!.id, 'dueDate', e.target.value)} aria-label={`${x.title} 기한`} />
                  </div>
                  <input className={cx(inputCls, 'mt-2 h-9')} value={v.note} onChange={(e) => set(x.result!.id, 'note', e.target.value)} maxLength={500} placeholder="덧붙일 말(선택)" aria-label={`${x.title} 덧붙임`} />
                  <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_9rem]">
                    <input className={cx(inputCls, 'h-9')} value={v.target} onChange={(e) => set(x.result!.id, 'target', e.target.value)} maxLength={100} placeholder="외부 연락이 필요하면 대상(예: 건물 관리처)" aria-label={`${x.title} 외부 연락 대상`} />
                    {v.target.trim() && <input type="date" className={cx(inputCls, 'h-9')} value={v.replyDue} onChange={(e) => set(x.result!.id, 'replyDue', e.target.value)} aria-label={`${x.title} 회신 기한`} />}
                  </div>
                </li>); })}
            </ul>
          </>
        )}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>더 점검하기</Button><Button disabled={busy} onClick={go} data-testid="check-finish-go">{busy && <Loader2 className="animate-spin" />}끝내기{fixes.length ? ` · 보완 요청 ${fixes.length}건 보내기` : ''}</Button></div>
      </div>
    </Modal>
  );
}
