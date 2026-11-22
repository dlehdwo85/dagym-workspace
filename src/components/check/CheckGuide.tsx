'use client';
// 점검 1단계 — 점검 가이드 화면(휴대폰 폭 먼저). 글은 src/lib/check/copy.ts, 자료는 /api/check/*.
// 권한(메뉴 권한 '점검 가이드'): 없음 = 직원 공유 양호 기준만 · 보기 = 가이드 읽기 · 편집 = 항목·분야·공간·템플릿
import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ClipboardCheck, Copy, Loader2, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useMultiSite, useSession, useTerms } from '@/components/session';
import { Button, Empty, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, inputCls, toast } from '@/components/ui';
import { shrinkImage } from '@/components/shrink';
import { DropZone } from '@/components/upload';
import { CHECK_COPY as C, sharedText } from '@/lib/check/copy';
import { RunHome } from './CheckRun';
import { CheckReport } from './CheckReport';

type Cat = { id: string; parent_id: string | null; name: string; sort: number; active: boolean; items: number };
type PT = { id: string; name: string; sort: number; active: boolean };
type Fix = { note?: string; dueDays?: number; external?: boolean };
type Item = { id: string; title: string; category_id: string | null; category_name: string | null; place_type_ids: string[]; unit_scope: 'all' | 'some'; org_unit_ids: string[]; method: string; method_note: string | null;
  pass_criteria: string; blind_spots: string[]; fix_action: Fix; cycle: string | null; basis_note: string | null; share_staff: boolean; version: number; active: boolean; photos: number };
type Photo = { id: string; fileName: string | null };
type Shared = { id: string; title: string; category_name: string | null; method: string; pass_criteria: string; blind_spots: string[]; photos: Photo[] };
const chip = 'rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-2';
const photoSrc = (id: string) => `/api/check/photos/${id}`;

export function CheckHome() {
  const sess = useSession();
  const level = sess.menus?.check_guide ?? 'none';
  const canView = level !== 'none'; const canEdit = level === 'edit';
  const canRun = (sess.menus?.check_run ?? 'none') === 'use'; // 점검 2단계: 점검하기·보완 확인
  const canReport = (sess.menus?.check_report ?? 'none') !== 'none'; // 점검 4단계: 리포트(숫자·표)
  const [tab, setTab] = useState<'run' | 'guide' | 'shared' | 'setup' | 'report'>(canRun ? 'run' : canView ? 'guide' : 'shared');
  useEffect(() => { const t = new URLSearchParams(location.search).get('tab'); if (t === 'run' && canRun) setTab('run'); else if (t === 'guide' && canView) setTab('guide'); else if (t === 'shared') setTab('shared'); else if (t === 'setup' && canEdit) setTab('setup'); else if (t === 'report' && canReport) setTab('report'); }, [canRun, canView, canEdit, canReport]);
  const tabs: [typeof tab, string][] = [...(canRun ? [['run', C.tabs.run] as [typeof tab, string]] : []), ...(canView ? [['guide', C.tabs.guide] as [typeof tab, string]] : []), ['shared', C.tabs.shared], ...(canEdit ? [['setup', C.tabs.setup] as [typeof tab, string]] : []), ...(canReport ? [['report', C.tabs.report] as [typeof tab, string]] : [])];
  return (
    <div className="mx-auto max-w-4xl" data-testid="check-home">
      <PageHeader title={C.menu} sub={canRun || canView ? C.sub : C.subShared} icon={ClipboardCheck} />
      {(canView || canRun || canReport) && (
        <div role="tablist" aria-label={C.menu} className="mb-3 flex gap-1 overflow-x-auto rounded-input border border-line bg-white p-0.5 text-sm shadow-card">
          {tabs.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`check-tab-${k}`}
              className={cx('shrink-0 rounded-md px-3 py-1.5 font-medium', tab === k ? 'bg-brand-600 text-white shadow-card' : 'text-ink-2 hover:bg-slate-100')}>{l}</button>
          ))}
        </div>
      )}
      {tab === 'run' && canRun && <RunHome />}
      {tab === 'guide' && canView && <Guide canEdit={canEdit} />}
      {tab === 'shared' && <SharedList />}
      {tab === 'setup' && canEdit && <Setup />}
      {tab === 'report' && canReport && <CheckReport />}
    </div>
  );
}

// ---------------- 점검 가이드 ----------------
function Guide({ canEdit }: { canEdit: boolean }) {
  const sess = useSession(); const multi = useMultiSite(); const terms = useTerms();
  const [q, setQ] = useState(''); const [dq, setDq] = useState('');
  const [cat, setCat] = useState(''); const [pt, setPt] = useState(''); const [unit, setUnit] = useState(''); const [off, setOff] = useState(false);
  const [open, setOpen] = useState<string | null>(null); // 항목 id 또는 'new'
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const qs = new URLSearchParams();
  if (dq) qs.set('q', dq); if (cat) qs.set('category', cat); if (pt) qs.set('placeType', pt); if (unit) qs.set('unit', unit); if (off) qs.set('all', '1');
  const list = useApi<{ items: Item[]; methods: Record<string, string>; cycles: Record<string, string> }>(`/api/check/items?${qs}`);
  const cats = useApi<{ categories: Cat[] }>('/api/check/categories');
  const pts = useApi<{ placeTypes: PT[] }>('/api/check/place-types');
  const units = sess.dir.orgUnits.filter((o) => o.active);
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of list.data?.items ?? []) { const k = it.category_name ?? C.uncategorized; m.set(k, [...(m.get(k) ?? []), it]); }
    return [...m.entries()];
  }, [list.data]);
  const filtered = !!(dq || cat || pt || unit);
  const sel = cx(inputCls, 'h-9 min-w-0 py-1 text-xs sm:!w-auto');
  return (
    <div className="space-y-3" data-testid="check-guide">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input className={cx(inputCls, 'h-9 pl-8')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={C.search} aria-label={C.search} data-testid="check-search" />
        </label>
        {canEdit && <Button size="sm" onClick={() => setOpen('new')} data-testid="check-item-add"><Plus />{C.add}</Button>}
      </div>
      <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap">
        <select className={sel} value={cat} onChange={(e) => setCat(e.target.value)} aria-label={C.category} data-testid="check-filter-category">
          <option value="">{C.category}: {C.all}</option>
          {(cats.data?.categories ?? []).filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}
        </select>
        <select className={sel} value={pt} onChange={(e) => setPt(e.target.value)} aria-label={C.placeType} data-testid="check-filter-place">
          <option value="">{C.placeType}: {C.all}</option>
          {(pts.data?.placeTypes ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {multi && units.length > 1 && (
          <select className={sel} value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={terms.unit.branch}>
            <option value="">{terms.unit.branch}: {C.all}</option>
            {units.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {canEdit && <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-2 max-sm:col-span-2"><input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} />안 쓰는 항목도</label>}
      </div>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Skeleton rows={6} />
        : !groups.length ? (filtered ? <Empty title={C.emptyFiltered} /> : <Empty title={C.emptyTitle} action={canEdit ? <Button size="sm" onClick={() => setOpen('new')}><Plus />{C.add}</Button> : undefined}>{C.emptyHint}</Empty>)
        : groups.map(([name, items]) => (
          <section key={name} className="overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="check-group">
            <h2 className="flex items-center justify-between border-b border-line bg-slate-50 px-3 py-2 text-sm font-semibold">{name}<span className="text-xs font-normal text-ink-3">{items.length}</span></h2>
            <ul className="divide-y divide-line">
              {items.map((it) => (
                <li key={it.id}>
                  <button type="button" onClick={() => setOpen(it.id)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50" data-testid="check-item-row">
                    <span className="min-w-0 flex-1">
                      <span className={cx('font-medium', !it.active && 'text-ink-3 line-through')}>{it.title}</span>
                      <span className="mt-0.5 block text-xs text-ink-2">{it.pass_criteria || '-'}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <span className={chip}>{list.data!.methods[it.method] ?? it.method}</span>
                        {it.cycle && <span className={chip}>{list.data!.cycles[it.cycle] ?? it.cycle}</span>}
                        {it.photos > 0 && <span className={chip}><Camera className="mr-0.5 inline size-3" />{it.photos}</span>}
                        {it.share_staff && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">{C.sharedBadge}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {open && <ItemEditor id={open === 'new' ? null : open} canEdit={canEdit} cats={cats.data?.categories ?? []} pts={pts.data?.placeTypes ?? []} methods={list.data?.methods ?? {}} cycles={list.data?.cycles ?? {}}
        onClose={() => setOpen(null)} onSaved={(id) => { list.reload(); cats.reload(); if (id) setOpen(id); }} />}
    </div>
  );
}

// ---------------- 점검 항목 보기·작성 ----------------
type Form = { title: string; categoryId: string; placeTypeIds: string[]; unitScope: 'all' | 'some'; orgUnitIds: string[]; method: string; methodNote: string; passCriteria: string; blind: string; fixNote: string; dueDays: string; external: boolean;
  cycle: string; basisNote: string; shareStaff: boolean; active: boolean; reason: string };
const EMPTY: Form = { title: '', categoryId: '', placeTypeIds: [], unitScope: 'all', orgUnitIds: [], method: 'look', methodNote: '', passCriteria: '', blind: '', fixNote: '', dueDays: '', external: false, cycle: '', basisNote: '', shareStaff: false, active: true, reason: '' };

function ItemEditor({ id, canEdit, cats, pts, methods, cycles, onClose, onSaved }: { id: string | null; canEdit: boolean; cats: Cat[]; pts: PT[]; methods: Record<string, string>; cycles: Record<string, string>; onClose: () => void; onSaved: (id?: string) => void }) {
  const sess = useSession(); const multi = useMultiSite(); const terms = useTerms();
  const detail = useApi<{ item: Item; versions: { version: number; reason: string | null; at: string; by_name: string | null }[]; photos: Photo[] }>(id ? `/api/check/items/${id}` : null);
  const [f, setF] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false); const [upBusy, setUpBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const it = detail.data?.item; if (!it) return;
    setF({ title: it.title, categoryId: it.category_id ?? '', placeTypeIds: it.place_type_ids, unitScope: it.unit_scope, orgUnitIds: it.org_unit_ids, method: it.method, methodNote: it.method_note ?? '', passCriteria: it.pass_criteria,
      blind: (it.blind_spots ?? []).join('\n'), fixNote: it.fix_action?.note ?? '', dueDays: it.fix_action?.dueDays === undefined ? '' : String(it.fix_action.dueDays), external: !!it.fix_action?.external, cycle: it.cycle ?? '',
      basisNote: it.basis_note ?? '', shareStaff: it.share_staff, active: it.active, reason: '' });
  }, [detail.data]);
  const units = sess.dir.orgUnits.filter((o) => o.active);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (k: 'placeTypeIds' | 'orgUnitIds', v: string) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const due = f.dueDays.trim() === '' ? undefined : Math.max(0, Math.min(365, Number(f.dueDays) || 0));
    const body = { title: f.title, categoryId: f.categoryId || null, placeTypeIds: f.placeTypeIds, unitScope: f.unitScope, orgUnitIds: f.unitScope === 'some' ? f.orgUnitIds : [], method: f.method, methodNote: f.methodNote.trim() || null,
      passCriteria: f.passCriteria, blindSpots: f.blind.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20), fixAction: { ...(f.fixNote.trim() ? { note: f.fixNote.trim() } : {}), ...(due !== undefined ? { dueDays: due } : {}), ...(f.external ? { external: true } : {}) },
      cycle: f.cycle || null, basisNote: f.basisNote.trim() || null, shareStaff: f.shareStaff, active: f.active, ...(f.reason.trim() ? { reason: f.reason.trim() } : {}) };
    try {
      if (id) { const r = await api<{ version: number; revised: boolean }>(`/api/check/items/${id}`, { method: 'PATCH', body }); toast.ok(r.revised ? C.item.revised(r.version) : C.item.saved); detail.reload(); onSaved(); }
      else { const r = await api<{ id: string }>('/api/check/items', { body }); toast.ok(C.item.saved); onSaved(r.id); } // 저장하면 같은 창에서 기준 사진을 올릴 수 있게 그 항목으로
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  async function addPhotos(files: FileList | null) {
    if (!files?.length || !id) return;
    setUpBusy(true);
    try {
      for (const raw of Array.from(files)) {
        const file = await shrinkImage(raw);
        const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('사진을 읽지 못했습니다')); r.readAsDataURL(file); });
        await api(`/api/check/items/${id}/photos`, { body: { fileName: file.name || 'photo.jpg', mimeType: /^image\/(jpeg|png|webp)$/.test(file.type) ? file.type : 'image/jpeg', data } });
      }
      detail.reload(); onSaved();
    } catch (er: any) { toast.error(er.message); } finally { setUpBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function removePhoto(pid: string) {
    if (!window.confirm('이 기준 사진을 지울까요?')) return;
    try { await api(`/api/check/photos/${pid}`, { method: 'DELETE' }); detail.reload(); onSaved(); } catch (er: any) { toast.error(er.message); }
  }
  const ro = !canEdit;
  const photos = detail.data?.photos ?? [];
  return (
    <Modal open onClose={onClose} title={id ? C.item.edit : C.item.new} wide>
      {id && !detail.data ? (detail.error ? <ErrorBox error={detail.error} retry={detail.reload} /> : <Skeleton rows={6} />) : (
        <form onSubmit={save} className="space-y-3 text-sm" data-testid="check-item-form">
          <fieldset disabled={ro} className="space-y-3">
            <Field label={C.item.title}><input className={inputCls} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder={C.item.titleHint} required maxLength={120} data-testid="check-item-title" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={C.category}>
                <select className={inputCls} value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)} data-testid="check-item-category">
                  <option value="">{C.uncategorized}</option>
                  {cats.filter((c) => c.active || c.id === f.categoryId).map((c) => <option key={c.id} value={c.id}>{c.parent_id ? '— ' : ''}{c.name}</option>)}
                </select>
              </Field>
              <Field label={C.item.cycle}>
                <select className={inputCls} value={f.cycle} onChange={(e) => set('cycle', e.target.value)}>
                  <option value="">{C.item.cycleNone}</option>
                  {Object.entries(cycles).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
              <Field label={C.item.method}>
                <select className={inputCls} value={f.method} onChange={(e) => set('method', e.target.value)}>{Object.entries(methods).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </Field>
              <Field label={C.item.methodNote}><input className={inputCls} value={f.methodNote} onChange={(e) => set('methodNote', e.target.value)} placeholder={C.item.methodNoteHint} maxLength={500} /></Field>
            </div>
            <Field label={C.item.pass}><textarea className={inputCls} rows={2} value={f.passCriteria} onChange={(e) => set('passCriteria', e.target.value)} placeholder={C.item.passHint} maxLength={1000} data-testid="check-item-pass" /></Field>
            <Field label={C.item.blind} hint={C.item.blindHint}><textarea className={inputCls} rows={2} value={f.blind} onChange={(e) => set('blind', e.target.value)} data-testid="check-item-blind" /></Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <Field label={C.item.fix}><input className={inputCls} value={f.fixNote} onChange={(e) => set('fixNote', e.target.value)} placeholder={C.item.fixHint} maxLength={300} /></Field>
              <Field label={C.item.dueDays}><input className={inputCls} inputMode="numeric" value={f.dueDays} onChange={(e) => set('dueDays', e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} /></Field>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.external} onChange={(e) => set('external', e.target.checked)} />{C.item.external}</label>
            <div>
              <span className="mb-1 block text-xs font-medium text-ink-2">{C.item.places} <span className="font-normal text-ink-3">· {C.item.placesHint}</span></span>
              <div className="flex flex-wrap gap-1.5">
                {pts.filter((p) => p.active || f.placeTypeIds.includes(p.id)).map((p) => (
                  <label key={p.id} className={cx('cursor-pointer rounded-full border px-2.5 py-1 text-xs', f.placeTypeIds.includes(p.id) ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line text-ink-2')}>
                    <input type="checkbox" className="sr-only" checked={f.placeTypeIds.includes(p.id)} onChange={() => toggle('placeTypeIds', p.id)} />{p.name}
                  </label>
                ))}
              </div>
            </div>
            {multi && units.length > 1 && (
              <div>
                <span className="mb-1 block text-xs font-medium text-ink-2">{C.item.units}</span>
                <div className="flex items-center gap-3 text-sm">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={f.unitScope === 'all'} onChange={() => set('unitScope', 'all')} />{C.item.unitsAll}</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={f.unitScope === 'some'} onChange={() => set('unitScope', 'some')} />{C.item.unitsSome}</label>
                </div>
                {f.unitScope === 'some' && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label={terms.unit.branch}>
                    {units.map((o) => (
                      <label key={o.id} className={cx('cursor-pointer rounded-full border px-2.5 py-1 text-xs', f.orgUnitIds.includes(o.id) ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line text-ink-2')}>
                        <input type="checkbox" className="sr-only" checked={f.orgUnitIds.includes(o.id)} onChange={() => toggle('orgUnitIds', o.id)} />{o.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            <label className="flex items-start gap-2 rounded-input border border-line p-2.5"><input type="checkbox" className="mt-0.5" checked={f.shareStaff} onChange={(e) => set('shareStaff', e.target.checked)} data-testid="check-item-share" />
              <span><span className="font-medium">{C.item.share}</span><span className="mt-0.5 block text-xs text-ink-3">{C.item.shareHint}</span></span></label>
            <Field label={C.item.basis} hint={C.item.basisHint}><textarea className={inputCls} rows={2} value={f.basisNote} onChange={(e) => set('basisNote', e.target.value)} maxLength={1000} /></Field>
            {id && <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />{C.item.active}</label>}
            {id && canEdit && <Field label={C.item.reason} hint={C.item.reasonHint}><input className={inputCls} value={f.reason} onChange={(e) => set('reason', e.target.value)} maxLength={300} data-testid="check-item-reason" /></Field>}
          </fieldset>
          {/* 기준 사진 — 저장한 항목에만 */}
          <DropZone onFiles={(fl) => void addPhotos(fl)} accept="image/*" acceptLabel="사진" disabled={!id || !canEdit || photos.length >= 6 || upBusy} label="여기에 놓으면 기준 사진으로 올립니다" testid="check-item-photos-drop">
          <div className="rounded-input border border-line p-2.5" data-testid="check-item-photos">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-ink-2">{C.item.photos}</span>
              {id && canEdit && photos.length < 6 && (
                <>
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} data-testid="check-photo-input" />
                  <Button type="button" size="sm" variant="secondary" disabled={upBusy} onClick={() => fileRef.current?.click()}>{upBusy ? <Loader2 className="animate-spin" /> : <Camera />}{C.item.photoAdd}</Button>
                </>
              )}
            </div>
            {!id ? <p className="mt-1 text-xs text-ink-3">{C.item.photosAfterSave}</p>
              : !photos.length ? <p className="mt-1 text-xs text-ink-3">{C.item.photosHint}</p>
              : (
                <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((p) => (
                    <li key={p.id} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <a href={photoSrc(p.id)} target="_blank" rel="noreferrer"><img src={photoSrc(p.id)} alt={p.fileName ?? C.item.photos} className="aspect-square w-full rounded-input border border-line object-cover" loading="lazy" data-testid="check-photo" /></a>
                      {canEdit && <button type="button" onClick={() => removePhoto(p.id)} aria-label="사진 지우기" className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-ink-2 shadow hover:text-red-600"><Trash2 className="size-3.5" /></button>}
                    </li>
                  ))}
                </ul>
              )}
          </div>
          </DropZone>
          {id && !!detail.data?.versions.length && (
            <details className="text-xs text-ink-2" data-testid="check-item-history">
              <summary className="cursor-pointer">{C.item.history} · {C.item.version(detail.data.item.version)}</summary>
              <ul className="mt-1 space-y-0.5 pl-3">{detail.data.versions.map((v) => <li key={v.version}>{C.item.version(v.version)} · {new Date(v.at).toLocaleDateString('ko-KR')}{v.by_name ? ` · ${v.by_name}` : ''}{v.reason ? ` — ${v.reason}` : ''}</li>)}</ul>
            </details>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose}>닫기</Button>
            {canEdit && <Button type="submit" disabled={busy} data-testid="check-item-save">{C.item.save}</Button>}
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------------- 직원 공유 양호 기준 ----------------
function SharedList() {
  const { data, error, reload } = useApi<{ items: Shared[]; methods: Record<string, string> }>('/api/check/shared');
  const groups = useMemo(() => {
    const m = new Map<string, Shared[]>();
    for (const it of data?.items ?? []) { const k = it.category_name ?? C.uncategorized; m.set(k, [...(m.get(k) ?? []), it]); }
    return [...m.entries()];
  }, [data]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={5} />;
  if (!data.items.length) return <Empty title={C.sharedEmptyTitle}>{C.sharedEmptyHint}</Empty>;
  async function copy() { try { await navigator.clipboard.writeText(sharedText(data!.items)); toast.ok(C.export.copied); } catch { toast.error('복사하지 못했습니다'); } }
  return (
    <div className="space-y-3" data-testid="check-shared">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={copy} data-testid="check-shared-copy"><Copy />{C.export.copy}</Button>
        <Button size="sm" variant="secondary" onClick={() => window.print()} data-testid="check-shared-print"><Printer />{C.export.print}</Button>
      </div>
      <div className="print-area print-flow space-y-3">
        <h2 className="hidden text-lg font-bold print:block">{C.export.heading}</h2>
        {groups.map(([name, items]) => (
          <section key={name} className="overflow-hidden rounded-card border border-line bg-white shadow-card">
            <h3 className="border-b border-line bg-slate-50 px-3 py-2 text-sm font-semibold">{name}</h3>
            <ul className="divide-y divide-line">
              {items.map((it) => (
                <li key={it.id} className="px-3 py-2.5" data-testid="check-shared-item">
                  <p className="font-medium">{it.title} <span className={cx(chip, 'ml-1 font-normal')}>{data.methods[it.method] ?? it.method}</span></p>
                  <p className="mt-0.5 text-sm text-ink">{it.pass_criteria || '-'}</p>
                  {!!it.blind_spots?.length && <p className="mt-0.5 text-xs text-ink-2">{C.item.blind}: {it.blind_spots.join(' · ')}</p>}
                  {!!it.photos.length && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {it.photos.map((p) => <a key={p.id} href={photoSrc(p.id)} target="_blank" rel="noreferrer"><img src={photoSrc(p.id)} alt={`${it.title} ${C.item.photos}`} className="size-20 rounded-input border border-line object-cover" loading="lazy" /></a>)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------- 분야 · 공간 · 템플릿(편집 권한) ----------------
function Setup() {
  const sess = useSession(); const multi = useMultiSite(); const terms = useTerms();
  const cats = useApi<{ categories: Cat[] }>('/api/check/categories');
  const pts = useApi<{ placeTypes: PT[] }>('/api/check/place-types');
  const tpls = useApi<{ templates: { key: string; name: string; description: string; items: number; installed: boolean }[] }>('/api/check/templates');
  const units = sess.dir.orgUnits.filter((o) => o.active);
  const [unit, setUnit] = useState(units[0]?.id ?? '');
  const places = useApi<{ places: { id: string; name: string; place_type_id: string | null; place_type_name: string | null; active: boolean }[] }>(unit ? `/api/check/places?unit=${unit}` : null);
  const [busy, setBusy] = useState(false);
  const [nc, setNc] = useState(''); const [ncParent, setNcParent] = useState(''); const [np, setNp] = useState(''); const [npl, setNpl] = useState(''); const [nplType, setNplType] = useState('');
  // 점검 2단계: 점검 코스(공간 유형을 도는 순서) — 목록은 점검하기 권한이 있어야 보임(없으면 이 칸을 숨김)
  const courses = useApi<{ courses: { id: string; name: string; orgUnitId: string | null; placeTypeIds: string[]; includeGeneral: boolean; active: boolean }[] }>((sess.menus?.check_run ?? 'none') === 'use' ? '/api/check/courses?all=1' : null);
  const [cn, setCn] = useState(''); const [cOrder, setCOrder] = useState<string[]>([]); const [cUnit, setCUnit] = useState('');
  const ptName = (id: string) => (pts.data?.placeTypes ?? []).find((p) => p.id === id)?.name ?? '';
  const run = async (fn: () => Promise<unknown>, after: () => void) => { setBusy(true); try { await fn(); after(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const box = 'rounded-card border border-line bg-white p-3 shadow-card';
  const top = (cats.data?.categories ?? []).filter((c) => !c.parent_id);
  return (
    <div className="space-y-3 text-sm" data-testid="check-setup">
      <section className={box} data-testid="check-setup-categories">
        <h2 className="font-semibold">{C.setup.categories}</h2><p className="text-xs text-ink-3">{C.setup.categoryHint}</p>
        <ul className="mt-2 space-y-1">
          {(cats.data?.categories ?? []).map((c) => (
            <li key={c.id} className={cx('flex items-center gap-2', c.parent_id && 'pl-4')}>
              <span className={cx('min-w-0 flex-1 truncate', !c.active && 'text-ink-3 line-through')}>{c.name}</span><span className="text-xs text-ink-3">항목 {c.items}</span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const name = window.prompt('분야 이름', c.name)?.trim(); if (name && name !== c.name) run(() => api(`/api/check/categories/${c.id}`, { method: 'PATCH', body: { name } }), cats.reload); }}>이름</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api(`/api/check/categories/${c.id}`, { method: 'PATCH', body: { name: c.name, active: !c.active } }), cats.reload)}>{c.active ? '안 씀' : '다시 씀'}</Button>
            </li>
          ))}
        </ul>
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!nc.trim()) return; run(() => api('/api/check/categories', { body: { name: nc.trim(), parentId: ncParent || null, sort: 990 } }), () => { setNc(''); cats.reload(); }); }}>
          <input className={cx(inputCls, 'h-9 min-w-0 flex-1 basis-40')} value={nc} onChange={(e) => setNc(e.target.value)} placeholder={C.setup.categoryAdd} maxLength={60} data-testid="check-category-name" />
          <select className={cx(inputCls, 'h-9 w-auto py-1 text-xs')} value={ncParent} onChange={(e) => setNcParent(e.target.value)} aria-label="위 분야"><option value="">맨 위 분야</option>{top.map((c) => <option key={c.id} value={c.id}>{c.name} 아래</option>)}</select>
          <Button size="sm" type="submit" disabled={busy || !nc.trim()} data-testid="check-category-add"><Plus />추가</Button>
        </form>
      </section>
      <section className={box} data-testid="check-setup-place-types">
        <h2 className="font-semibold">{C.setup.placeTypes}</h2>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {(pts.data?.placeTypes ?? []).map((p) => (
            <li key={p.id}><button type="button" disabled={busy} title={p.active ? '누르면 안 씀' : '누르면 다시 씀'} onClick={() => run(() => api(`/api/check/place-types/${p.id}`, { method: 'PATCH', body: { name: p.name, active: !p.active } }), pts.reload)}
              className={cx('rounded-full border px-2.5 py-1 text-xs', p.active ? 'border-line text-ink' : 'border-dashed border-line text-ink-3 line-through')}>{p.name}</button></li>
          ))}
        </ul>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!np.trim()) return; run(() => api('/api/check/place-types', { body: { name: np.trim(), sort: 990 } }), () => { setNp(''); pts.reload(); }); }}>
          <input className={cx(inputCls, 'h-9 min-w-0 flex-1')} value={np} onChange={(e) => setNp(e.target.value)} placeholder={C.setup.placeTypeAdd} maxLength={60} data-testid="check-place-type-name" />
          <Button size="sm" type="submit" disabled={busy || !np.trim()} data-testid="check-place-type-add"><Plus />추가</Button>
        </form>
      </section>
      <section className={box} data-testid="check-setup-places">
        <h2 className="font-semibold">{C.setup.places}</h2><p className="text-xs text-ink-3">{C.setup.placesHint}</p>
        {multi && units.length > 1 && <select className={cx(inputCls, 'mt-2 h-9 w-auto py-1 text-xs')} value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={terms.unit.branch}>{units.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
        <ul className="mt-2 space-y-1">
          {(places.data?.places ?? []).map((p) => <li key={p.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{p.name}</span>{p.place_type_name && <span className={chip}>{p.place_type_name}</span>}</li>)}
        </ul>
        <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!npl.trim() || !unit) return; run(() => api('/api/check/places', { body: { name: npl.trim(), orgUnitId: unit, placeTypeId: nplType || null } }), () => { setNpl(''); places.reload(); }); }}>
          <input className={cx(inputCls, 'h-9 min-w-0 flex-1 basis-40')} value={npl} onChange={(e) => setNpl(e.target.value)} placeholder={C.setup.placeAdd} maxLength={60} data-testid="check-place-name" />
          <select className={cx(inputCls, 'h-9 w-auto py-1 text-xs')} value={nplType} onChange={(e) => setNplType(e.target.value)} aria-label={C.placeType}><option value="">{C.placeType}</option>{(pts.data?.placeTypes ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <Button size="sm" type="submit" disabled={busy || !npl.trim() || !unit} data-testid="check-place-add"><Plus />추가</Button>
        </form>
      </section>
      {courses.data && (
        <section className={box} data-testid="check-setup-courses">
          <h2 className="font-semibold">{C.setup.courses}</h2><p className="text-xs text-ink-3">{C.setup.coursesHint}</p>
          <ul className="mt-2 space-y-1.5">
            {courses.data.courses.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <span className="min-w-0 flex-1"><span className={cx('font-medium', !c.active && 'text-ink-3 line-through')}>{c.name}</span>{c.orgUnitId && <span className="ml-1.5 text-xs text-ink-3">{units.find((o) => o.id === c.orgUnitId)?.name}</span>}
                  <span className="block text-xs text-ink-2">{c.placeTypeIds.map(ptName).filter(Boolean).join(' → ') || '-'}{c.includeGeneral ? ' → 공간 없이 보는 항목' : ''}</span></span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => api(`/api/check/courses/${c.id}`, { method: 'PATCH', body: { name: c.name, placeTypeIds: c.placeTypeIds, active: !c.active } }), courses.reload)}>{c.active ? '안 씀' : '다시 씀'}</Button>
              </li>
            ))}
          </ul>
          <form className="mt-3 space-y-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); if (!cn.trim() || !cOrder.length) return; run(() => api('/api/check/courses', { body: { name: cn.trim(), placeTypeIds: cOrder, orgUnitId: cUnit || null } }), () => { setCn(''); setCOrder([]); courses.reload(); }); }}>
            <div className="flex flex-wrap gap-2">
              <input className={cx(inputCls, 'h-9 min-w-0 flex-1 basis-40')} value={cn} onChange={(e) => setCn(e.target.value)} placeholder={C.setup.courseAdd} maxLength={60} data-testid="check-course-name" />
              {multi && units.length > 1 && <select className={cx(inputCls, 'h-9 !w-auto py-1 text-xs')} value={cUnit} onChange={(e) => setCUnit(e.target.value)} aria-label={terms.unit.branch}><option value="">모든 곳</option>{units.map((o) => <option key={o.id} value={o.id}>{o.name}만</option>)}</select>}
            </div>
            <div className="flex flex-wrap gap-1.5" aria-label={C.setup.courseOrder}>
              {(pts.data?.placeTypes ?? []).filter((p) => p.active).map((p) => { const n = cOrder.indexOf(p.id); return (
                <button key={p.id} type="button" onClick={() => setCOrder((o) => (o.includes(p.id) ? o.filter((x) => x !== p.id) : [...o, p.id]))} data-testid="check-course-place"
                  className={cx('rounded-full border px-2.5 py-1 text-xs', n >= 0 ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line text-ink-2')}>{n >= 0 ? `${n + 1}. ` : ''}{p.name}</button>); })}
            </div>
            <div className="flex items-center justify-between gap-2"><span className="text-xs text-ink-3">{C.setup.courseOrder}</span><Button size="sm" type="submit" disabled={busy || !cn.trim() || !cOrder.length} data-testid="check-course-add"><Plus />추가</Button></div>
          </form>
        </section>
      )}
      <section className={box} data-testid="check-setup-templates">
        <h2 className="font-semibold">{C.setup.templates}</h2><p className="text-xs text-ink-3">{C.setup.templatesHint}</p>
        <ul className="mt-2 space-y-1.5">
          {(tpls.data?.templates ?? []).map((t) => (
            <li key={t.key} className="flex items-center gap-2" data-testid={`check-template-${t.key}`}>
              <span className="min-w-0 flex-1"><span className="font-medium">{t.name}</span><span className="ml-1.5 text-xs text-ink-3">{t.description} · 항목 {t.items}개</span></span>
              {t.installed ? <span className="text-xs text-ink-3">{C.setup.installed}</span>
                : <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { const r = await api<{ items: number }>('/api/check/templates', { body: { key: t.key } }); toast.ok(C.setup.installedMsg(t.name, r.items)); }, () => { tpls.reload(); cats.reload(); pts.reload(); })}>{C.setup.install}</Button>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
