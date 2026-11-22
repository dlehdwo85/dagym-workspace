'use client';
// 계약 관리 1단계(대표 11/19 · docs/contract-docs-design.md): 맺은 계약서를 보관하고 만료일로 챙긴다. '전자계약'(서명 받는 도구)과는 따로.
// 목록(임박한 것부터) · 등록·고치기 · 갱신 등록(기간 이력) · 종료 · 계약서 파일(계약 관리 권한이 있는 사람만 열고, 열람은 감사 기록에 남음) · 회사 기본 알림 날짜 · 엑셀.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BellRing, Download, FileText, FolderClock, History, Loader2, Paperclip, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { MultiUserSelect, UnitSelect, UserSelect } from '@/components/pickers';
import { useSession } from '@/components/session';
import { Button, Empty, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, fmtDate, inputCls, toast } from '@/components/ui';
import { DropZone, putFile } from '@/components/upload';
import { agreementLeftText } from '@/lib/agreementLabel';

type State = 'active' | 'soon' | 'notice_passed' | 'expired' | 'renew_check' | 'open_ended' | 'ended';
type Agr = { id: string; title: string; counterparty: string; amount: number | null; ownerId: string | null; ownerName: string | null; orgUnitId: string | null; orgUnitName: string | null; tags: string[]; memo: string | null;
  startDate: string | null; endDate: string | null; autoRenew: boolean; noticeDays: number | null; alertDays: number[] | null; notifyUserIds: string[]; reviewTask: boolean; termNo: number; status: 'active' | 'ended';
  endedReason: string | null; files: number; state: State; stateLabel: string; basis: string | null; basisKind: 'notice' | 'end' | null; daysLeft: number | null };
type List = { agreements: Agr[]; counts: { total: number; in30: number; in90: number; attention: number; ended: number }; tags: string[]; alertDays: number[]; today: string };
type Detail = { agreement: Agr; terms: { term_no: number; start_date: string | null; end_date: string | null; amount: string | null; memo: string | null; by_name: string | null }[];
  files: { id: string; term_no: number; file_name: string; size_bytes: number; created_at: string; by_name: string | null }[]; notifyUsers: { id: string; name: string }[] };

const won = (n: number | null) => (n === null ? '' : `${n.toLocaleString('ko-KR')}원`);
const TONE: Record<State, string> = { active: 'bg-slate-100 text-ink-2', soon: 'bg-amber-100 text-amber-800', notice_passed: 'bg-red-100 text-red-700', expired: 'bg-red-100 text-red-700', renew_check: 'bg-red-100 text-red-700', open_ended: 'bg-slate-100 text-ink-3', ended: 'bg-slate-100 text-ink-3' };
const leftText = agreementLeftText; // 남은 날 한 줄 — 홈 카드와 같은 글
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);
const daysText = (d: number[]) => d.join('·');
const parseDays = (s: string) => [...new Set(s.split(/[^0-9]+/).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 365))].sort((a, b) => b - a).slice(0, 6);

export function AgreementsHome() {
  const sess = useSession(); const router = useRouter(); const sp = useSearchParams();
  const canEdit = (sess.menus?.agreements ?? 'none') === 'edit';
  const [q, setQ] = useState(''); const [tag, setTag] = useState(''); const [state, setState] = useState('open');
  const qs = useMemo(() => { const p = new URLSearchParams(); if (q.trim()) p.set('q', q.trim()); if (tag) p.set('tag', tag); if (state && state !== 'all') p.set('state', state); return p.toString(); }, [q, tag, state]);
  const list = useApi<List>(`/api/agreements${qs ? `?${qs}` : ''}`, [qs]);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ edit: Agr | null } | null>(null);
  const [settings, setSettings] = useState(false);
  useEffect(() => { const id = sp.get('open'); if (id) setOpen(id); }, [sp]);
  const close = () => { setOpen(null); if (sp.get('open')) router.replace('/agreements'); };
  const c = list.data?.counts;
  const chips: [string, string, number | undefined][] = [['open', '진행 중', c?.total], ['attention', '챙길 것', c?.attention], ['soon', '만료 임박', undefined], ['ended', '종료', c?.ended], ['all', '모두', undefined]];
  const rows = (list.data?.agreements ?? []).filter((a) => state !== 'attention' || ['expired', 'renew_check', 'notice_passed'].includes(a.state));
  return (
    <div className="mx-auto max-w-5xl" data-testid="agreements-page">
      <PageHeader title="계약 관리" icon={FolderClock} sub={`맺은 계약서를 보관하고 만료일을 챙깁니다. 만료 ${daysText(list.data?.alertDays ?? [90, 60, 30, 7])}일 전에 알림이 갑니다.`}
        actions={<>
          <a href="/api/agreements/export" download className="inline-flex h-9 items-center gap-1.5 rounded-input border border-line bg-white px-3 text-sm font-medium text-ink-2 hover:bg-slate-50" data-testid="agr-export"><Download className="size-4" />엑셀</a>
          {canEdit && <Button variant="secondary" onClick={() => setSettings(true)} data-testid="agr-settings"><BellRing />알림 날짜</Button>}
          {canEdit && <Button onClick={() => setForm({ edit: null })} data-testid="agr-add"><Plus />계약 등록</Button>}
        </>} />
      {c && <div className="mb-3 grid grid-cols-3 gap-2 text-sm" data-testid="agr-summary">
        <div className="rounded-card border border-line bg-white p-3 shadow-card"><p className="text-xs text-ink-2">30일 안 만료</p><p className={cx('mt-0.5 text-xl font-bold tabular-nums', c.in30 ? 'text-red-600' : 'text-ink')} data-testid="agr-in30">{c.in30}</p></div>
        <div className="rounded-card border border-line bg-white p-3 shadow-card"><p className="text-xs text-ink-2">90일 안 만료</p><p className="mt-0.5 text-xl font-bold tabular-nums" data-testid="agr-in90">{c.in90}</p></div>
        <div className="rounded-card border border-line bg-white p-3 shadow-card"><p className="text-xs text-ink-2">챙길 것 <span className="text-ink-3">(만료·연장 확인·통보 기한 지남)</span></p><p className={cx('mt-0.5 text-xl font-bold tabular-nums', c.attention ? 'text-red-600' : 'text-ink')} data-testid="agr-attention">{c.attention}</p></div>
      </div>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-input border border-line bg-white p-0.5 text-sm shadow-card" role="tablist" aria-label="계약 상태">
          {chips.map(([k, l, n]) => <button key={k} role="tab" aria-selected={state === k} onClick={() => setState(k)} data-testid={`agr-state-${k}`}
            className={cx('shrink-0 rounded-md px-2.5 py-1.5 font-medium', state === k ? 'bg-brand-600 text-white shadow-card' : 'text-ink-2 hover:bg-slate-100')}>{l}{n !== undefined ? ` ${n}` : ''}</button>)}
        </div>
        <label className="relative min-w-[10rem] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input className={cx(inputCls, 'pl-8')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="계약명·상대방·메모 찾기" aria-label="계약 찾기" data-testid="agr-search" /></label>
        {(list.data?.tags.length ?? 0) > 0 && <div className="w-36 shrink-0"><select className={inputCls} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="꼬리표" data-testid="agr-tag"><option value="">꼬리표 전체</option>{list.data!.tags.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>}
      </div>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Skeleton rows={5} /> : !rows.length ? (
        <Empty title={q || tag || state !== 'open' ? '맞는 계약이 없습니다' : '등록한 계약이 없습니다'} icon={FileText}
          action={canEdit && !q && !tag && state === 'open' ? <Button onClick={() => setForm({ edit: null })}><Plus />첫 계약 등록</Button> : undefined}>
          {q || tag || state !== 'open' ? '찾는 말이나 상태를 바꿔 보세요.' : '임대차·용역·렌탈·보험처럼 기한이 있는 계약을 등록해 두면 만료 전에 알려 드립니다.'}</Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="agr-list">
          {rows.map((a) => (
            <li key={a.id}><button type="button" className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50" onClick={() => setOpen(a.id)} data-testid="agr-row" data-state={a.state}>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5"><b className="truncate font-semibold text-ink">{a.title}</b>
                  {a.autoRenew && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">자동 연장</span>}
                  {a.tags.map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-ink-2">{t}</span>)}</span>
                <span className="mt-0.5 block truncate text-xs text-ink-2">{[a.counterparty, a.endDate ? `만료 ${fmtDate(a.endDate)}` : null, a.ownerName ? `담당 ${a.ownerName}` : null, a.amount !== null ? won(a.amount) : null].filter(Boolean).join(' · ')}</span>
              </span>
              {a.files > 0 && <span className="hidden shrink-0 items-center gap-0.5 text-xs text-ink-3 sm:inline-flex"><Paperclip className="size-3.5" />{a.files}</span>}
              <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', TONE[a.state])} data-testid="agr-left">{leftText(a)}</span>
            </button></li>
          ))}
        </ul>
      )}
      {open && <DetailModal id={open} canEdit={canEdit} onClose={close} onChanged={list.reload} onEdit={(a) => { setOpen(null); setForm({ edit: a }); }} />}
      {form && <FormModal edit={form.edit} companyDays={list.data?.alertDays ?? [90, 60, 30, 7]} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); list.reload(); setOpen(id); }} />}
      {settings && <SettingsModal onClose={() => setSettings(false)} onSaved={() => { setSettings(false); list.reload(); }} />}
    </div>
  );
}

function FormModal({ edit, companyDays, onClose, onSaved }: { edit: Agr | null; companyDays: number[]; onClose: () => void; onSaved: (id: string) => void }) {
  const sess = useSession();
  const [f, setF] = useState(() => ({
    title: edit?.title ?? '', counterparty: edit?.counterparty ?? '', tags: (edit?.tags ?? []).join(', '), startDate: edit?.startDate ?? '', endDate: edit?.endDate ?? '', autoRenew: edit?.autoRenew ?? false,
    noticeDays: edit?.noticeDays != null ? String(edit.noticeDays) : '', amount: edit?.amount != null ? String(edit.amount) : '', ownerId: edit ? edit.ownerId : sess.user.id, orgUnitId: edit?.orgUnitId ?? '',
    notifyUserIds: edit?.notifyUserIds ?? [sess.user.id], ownDays: !!edit?.alertDays, alertDays: daysText(edit?.alertDays ?? companyDays), reviewTask: edit?.reviewTask ?? true, memo: edit?.memo ?? '' }));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const days = f.ownDays ? parseDays(f.alertDays) : null;
    if (f.ownDays && !days?.length) { toast.error('알림 날짜를 숫자로 적어 주세요(예: 90, 30, 7)'); return; }
    const body = { title: f.title, counterparty: f.counterparty, tags: f.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean), startDate: f.startDate || null, endDate: f.endDate || null, autoRenew: f.autoRenew,
      noticeDays: f.autoRenew && f.noticeDays !== '' ? Number(f.noticeDays) : null, amount: f.amount.replace(/[^0-9]/g, '') === '' ? null : Number(f.amount.replace(/[^0-9]/g, '')), ownerId: f.ownerId, orgUnitId: f.orgUnitId || null,
      notifyUserIds: f.notifyUserIds, alertDays: days, reviewTask: f.reviewTask, memo: f.memo.trim() || null };
    setBusy(true);
    try { const r = edit ? await api<{ id: string }>(`/api/agreements/${edit.id}`, { method: 'PATCH', body }) : await api<{ id: string }>('/api/agreements', { body }); toast.ok(edit ? '고쳤습니다' : '계약을 등록했습니다'); onSaved(r.id); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={edit ? '계약 고치기' : '계약 등록'} wide>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={save} data-testid="agr-form">
        <Field label="계약명" className="sm:col-span-2"><input className={inputCls} value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} required placeholder="예: 본사 사무실 임대차" data-testid="agr-title" /></Field>
        <Field label="상대방"><input className={inputCls} value={f.counterparty} onChange={(e) => set({ counterparty: e.target.value })} maxLength={120} placeholder="예: 한빛빌딩" data-testid="agr-counterparty" /></Field>
        <Field label="꼬리표" hint="종류를 쉼표로 나눠 적습니다(예: 임대차, 본사)"><input className={inputCls} value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="임대차, 본사" data-testid="agr-tags" /></Field>
        <Field label="시작일"><input type="date" className={inputCls} value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} data-testid="agr-start" /></Field>
        <Field label="만료일" hint="비워 두면 기한 없는 계약(알림 없음)"><input type="date" className={inputCls} value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} data-testid="agr-end" /></Field>
        <div className="sm:col-span-2 rounded-input border border-line p-3">
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={f.autoRenew} onChange={(e) => set({ autoRenew: e.target.checked })} data-testid="agr-auto" />
            <span><b className="font-medium">자동 연장 계약</b><span className="mt-0.5 block text-xs text-ink-2">가만히 두면 연장되는 계약입니다. 기간은 저절로 늘리지 않고, 연장되면 [갱신 등록]으로 새 기간을 적습니다.</span></span></label>
          {f.autoRenew && <Field label="해지 통보 기한" hint="만료 며칠 전까지 알려야 하는지. 적어 두면 알림을 그 날짜 기준으로 당겨 보냅니다" className="mt-2">
            <span className="flex items-center gap-2 text-sm">만료 <input type="number" min={0} max={365} className={cx(inputCls, 'w-24')} value={f.noticeDays} onChange={(e) => set({ noticeDays: e.target.value })} data-testid="agr-notice" /> 일 전까지</span></Field>}
        </div>
        <Field label="금액(원)" hint="선택"><input inputMode="numeric" className={inputCls} value={f.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="예: 3300000" data-testid="agr-amount" /></Field>
        <Field label="담당자"><UserSelect value={f.ownerId} onChange={(v) => set({ ownerId: v })} ariaLabel="담당자" /></Field>
        <Field label="소속" hint="선택"><UnitSelect value={f.orgUnitId} onChange={(v) => set({ orgUnitId: v })} allowEmpty="소속 없음" /></Field>
        <Field label="알림 받는 사람" hint="계약 관리 권한이 없는 사람은 계약명과 만료일만 알림으로 받습니다"><MultiUserSelect value={f.notifyUserIds} onChange={(v) => set({ notifyUserIds: v })} /></Field>
        <div className="sm:col-span-2 space-y-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.ownDays} onChange={(e) => set({ ownDays: e.target.checked })} data-testid="agr-own-days" />이 계약만 알림 날짜를 따로 정하기 <span className="text-xs text-ink-3">(회사 기본: {daysText(companyDays)}일 전)</span></label>
          {f.ownDays && <input className={inputCls} value={f.alertDays} onChange={(e) => set({ alertDays: e.target.value })} placeholder="90, 30, 7" aria-label="알림 날짜(일 전)" data-testid="agr-days" />}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.reviewTask} onChange={(e) => set({ reviewTask: e.target.checked })} data-testid="agr-review-task" />첫 알림 때 담당자에게 “계약 갱신 검토” 업무 만들기</label>
        </div>
        <Field label="메모" className="sm:col-span-2"><textarea className={cx(inputCls, 'min-h-[72px]')} value={f.memo} onChange={(e) => set({ memo: e.target.value })} maxLength={2000} placeholder="조건·특이 사항" data-testid="agr-memo" /></Field>
        <div className="sm:col-span-2 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy || !f.title.trim()} data-testid="agr-save">{busy && <Loader2 className="animate-spin" />}{edit ? '저장' : '등록'}</Button></div>
      </form>
    </Modal>
  );
}

function DetailModal({ id, canEdit, onClose, onChanged, onEdit }: { id: string; canEdit: boolean; onClose: () => void; onChanged: () => void; onEdit: (a: Agr) => void }) {
  const d = useApi<Detail>(`/api/agreements/${id}`, [id]);
  const [renew, setRenew] = useState(false); const [end, setEnd] = useState(false);
  const [up, setUp] = useState<{ name: string; pct: number } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const a = d.data?.agreement;
  const changed = () => { d.reload(); onChanged(); };
  async function upload(file: File | undefined) {
    if (!file) return;
    setUp({ name: file.name, pct: 0 });
    try {
      const r = await api<{ id: string; upload: any }>(`/api/agreements/${id}/files`, { body: { fileName: file.name, mimeType: file.type || undefined, size: file.size } });
      const done = await putFile(r.upload, file, (pct) => setUp({ name: file.name, pct }));
      await api(`/api/agreements/files/${r.id}`, { body: { uploadId: done.uploadId } });
      toast.ok('계약서 파일을 올렸습니다'); changed();
    } catch (e: any) { toast.error(e.message || '파일을 올리지 못했습니다'); } finally { setUp(null); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function openFile(fid: string, inline: boolean) {
    try { const r = await api<{ url: string }>(`/api/agreements/files/${fid}${inline ? '?inline=1' : ''}`); window.open(r.url, '_blank', 'noopener'); } catch (e: any) { toast.error(e.message); }
  }
  async function removeFile(fid: string, name: string) {
    if (!confirm(`"${name}" 파일을 지울까요?`)) return;
    try { await api(`/api/agreements/files/${fid}`, { method: 'DELETE' }); changed(); } catch (e: any) { toast.error(e.message); }
  }
  const row = (k: string, v: React.ReactNode) => v ? <div className="flex gap-3 py-1.5 text-sm"><dt className="w-24 shrink-0 text-ink-2">{k}</dt><dd className="min-w-0 flex-1 break-words text-ink">{v}</dd></div> : null;
  return (
    <Modal open onClose={onClose} title={a?.title ?? '계약'} wide>
      {d.error ? <ErrorBox error={d.error} retry={d.reload} /> : !a ? <Skeleton rows={4} /> : (
        <div className="space-y-4" data-testid="agr-detail">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', TONE[a.state])} data-testid="agr-detail-state">{a.stateLabel} · {leftText(a)}</span>
            {a.autoRenew && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-700">자동 연장{a.noticeDays ? ` · 만료 ${a.noticeDays}일 전까지 해지 통보` : ''}</span>}
            {a.termNo > 1 && <span className="text-xs text-ink-3">{a.termNo}번째 기간</span>}
            {canEdit && <span className="ml-auto flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => onEdit(a)} data-testid="agr-edit">고치기</Button>
              {a.status === 'active' && a.endDate && <Button size="sm" onClick={() => setRenew(true)} data-testid="agr-renew"><RefreshCw />갱신 등록</Button>}
              {a.status === 'active' && <Button size="sm" variant="secondary" onClick={() => setEnd(true)} data-testid="agr-end-open">종료</Button>}
            </span>}
          </div>
          <dl className="divide-y divide-line rounded-card border border-line px-3">
            {row('상대방', a.counterparty)}
            {row('기간', a.startDate || a.endDate ? `${a.startDate ? fmtDate(a.startDate) : '시작일 없음'} ~ ${a.endDate ? fmtDate(a.endDate) : '기한 없음'}` : '기한 없음')}
            {row('금액', a.amount !== null ? won(a.amount) : null)}
            {row('담당자', [a.ownerName, a.orgUnitName].filter(Boolean).join(' · '))}
            {row('꼬리표', a.tags.length ? a.tags.join(', ') : null)}
            {row('알림', <span data-testid="agr-detail-notify">{a.endDate ? `${a.basisKind === 'notice' ? '해지 통보 마감일' : '만료일'} 기준 ${a.alertDays ? `${daysText(a.alertDays)}일 전(이 계약만)` : '회사 기본 날짜'} · ` : ''}받는 사람: {d.data!.notifyUsers.map((u) => u.name).join(', ') || '없음'}</span>)}
            {row('메모', a.memo ? <span className="whitespace-pre-wrap">{a.memo}</span> : null)}
            {a.status === 'ended' && row('종료 까닭', a.endedReason)}
          </dl>
          <DropZone onFile={(f) => void upload(f)} disabled={!canEdit || !!up} label="여기에 놓으면 계약서 파일로 올립니다" testid="agr-file-drop">
          <section>
            <div className="mb-1.5 flex items-center gap-2"><h3 className="text-sm font-semibold">계약서 파일</h3><span className="text-xs text-ink-3">계약 관리 권한이 있는 사람만 열 수 있고, 연 기록이 남습니다</span>
              {canEdit && <Button size="sm" variant="secondary" className="ml-auto" disabled={!!up} onClick={() => fileRef.current?.click()} data-testid="agr-file-add">{up ? <Loader2 className="animate-spin" /> : <Paperclip />}{up ? `${up.pct}%` : '파일 올리기'}</Button>}</div>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} data-testid="agr-file-input" />
            {d.data!.files.length ? <ul className="divide-y divide-line rounded-card border border-line" data-testid="agr-files">{d.data!.files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm"><FileText className="size-4 shrink-0 text-ink-3" />
                <button type="button" className="min-w-0 flex-1 truncate text-left font-medium text-brand-700 hover:underline" onClick={() => void openFile(f.id, true)} data-testid="agr-file-open">{f.file_name}</button>
                <span className="hidden shrink-0 text-xs text-ink-3 sm:inline">{size(f.size_bytes)}{a.termNo > 1 ? ` · ${f.term_no}번째 기간` : ''}</span>
                <button type="button" className="shrink-0 rounded p-1 text-ink-3 hover:bg-slate-100" onClick={() => void openFile(f.id, false)} aria-label={`${f.file_name} 내려받기`}><Download className="size-4" /></button>
                {canEdit && <button type="button" className="shrink-0 rounded p-1 text-ink-3 hover:bg-slate-100" onClick={() => void removeFile(f.id, f.file_name)} aria-label={`${f.file_name} 지우기`} data-testid="agr-file-remove"><Trash2 className="size-4" /></button>}
              </li>))}</ul> : <p className="rounded-card border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3">올린 파일이 없습니다{canEdit ? ' — 파일을 여기로 끌어다 놓거나 [파일 올리기]' : ''}</p>}
          </section>
          </DropZone>
          {d.data!.terms.length > 0 && <section data-testid="agr-terms">
            <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><History className="size-4" />지난 기간</h3>
            <ul className="divide-y divide-line rounded-card border border-line text-sm">{d.data!.terms.map((t) => (
              <li key={t.term_no} className="px-3 py-2"><span className="font-medium">{t.term_no}번째</span> · {t.start_date ? fmtDate(t.start_date) : '시작일 없음'} ~ {t.end_date ? fmtDate(t.end_date) : '—'}{t.amount ? ` · ${won(Number(t.amount))}` : ''}
                {(t.memo || t.by_name) && <span className="block text-xs text-ink-2">{[t.memo, t.by_name ? `${t.by_name} 갱신 등록` : null].filter(Boolean).join(' · ')}</span>}</li>))}</ul>
          </section>}
          {renew && <RenewModal a={a} onClose={() => setRenew(false)} onDone={() => { setRenew(false); changed(); }} />}
          {end && <EndModal a={a} onClose={() => setEnd(false)} onDone={() => { setEnd(false); changed(); }} />}
        </div>
      )}
    </Modal>
  );
}

function RenewModal({ a, onClose, onDone }: { a: Agr; onClose: () => void; onDone: () => void }) {
  const [endDate, setEndDate] = useState(''); const [amount, setAmount] = useState(a.amount !== null ? String(a.amount) : ''); const [memo, setMemo] = useState(''); const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { const n = amount.replace(/[^0-9]/g, ''); await api(`/api/agreements/${a.id}/renew`, { body: { endDate, amount: n === '' ? null : Number(n), memo: memo.trim() || undefined } }); toast.ok('갱신을 등록했습니다 — 새 만료일 기준으로 다시 알려 드립니다'); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="갱신 등록">
      <form className="space-y-3" onSubmit={save} data-testid="agr-renew-form">
        <p className="text-sm text-ink-2">지금 기간({a.endDate ? `~ ${fmtDate(a.endDate)}` : '기한 없음'})은 “지난 기간”으로 남고, 새 만료일로 이어 갑니다.</p>
        <Field label="새 만료일"><input type="date" className={inputCls} value={endDate} min={a.endDate ?? undefined} onChange={(e) => setEndDate(e.target.value)} required data-testid="agr-renew-end" /></Field>
        <Field label="금액(원)" hint="바뀌었으면 고쳐 적습니다"><input inputMode="numeric" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="agr-renew-amount" /></Field>
        <Field label="메모" hint="바뀐 조건(선택)"><input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} data-testid="agr-renew-memo" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy || !endDate} data-testid="agr-renew-save">갱신 등록</Button></div>
      </form>
    </Modal>
  );
}
function EndModal({ a, onClose, onDone }: { a: Agr; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api(`/api/agreements/${a.id}/end`, { body: { reason } }); toast.ok('종료로 옮겼습니다 — 알림이 멈춥니다'); onDone(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="계약 종료">
      <form className="space-y-3" onSubmit={save} data-testid="agr-end-form">
        <p className="text-sm text-ink-2">“{a.title}”을 종료로 옮깁니다. 기록과 파일은 그대로 남고 알림만 멈춥니다.</p>
        <Field label="종료 까닭"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required placeholder="예: 기간 만료 · 업체 변경" data-testid="agr-end-reason" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" variant="danger" disabled={busy || !reason.trim()} data-testid="agr-end-save">종료</Button></div>
      </form>
    </Modal>
  );
}
function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const s = useApi<{ alertDays: number[]; defaults: number[] }>('/api/agreements/settings');
  const [v, setV] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const val = v ?? (s.data ? daysText(s.data.alertDays).replace(/·/g, ', ') : '');
  async function save(e: React.FormEvent) {
    e.preventDefault(); const days = parseDays(val);
    if (!days.length) { toast.error('숫자로 적어 주세요(예: 90, 60, 30, 7)'); return; }
    setBusy(true);
    try { await api('/api/agreements/settings', { method: 'PUT', body: { alertDays: days } }); toast.ok('회사 기본 알림 날짜를 바꿨습니다'); onSaved(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="알림 날짜">
      <form className="space-y-3" onSubmit={save} data-testid="agr-settings-form">
        <p className="text-sm text-ink-2">만료(자동 연장 계약은 해지 통보 마감일) 며칠 전에 알릴지 정합니다. 계약마다 따로 정한 것은 그 값을 따릅니다. 늦게 등록한 계약은 지난 단계를 몰아 보내지 않고 가장 가까운 단계 하나만 보냅니다.</p>
        <Field label="회사 기본(일 전)" hint={`쉼표로 나눠 최대 6개 · 처음 값 ${daysText(s.data?.defaults ?? [90, 60, 30, 7])}`}><input className={inputCls} value={val} onChange={(e) => setV(e.target.value)} placeholder="90, 60, 30, 7" data-testid="agr-settings-days" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy} data-testid="agr-settings-save">저장</Button></div>
      </form>
    </Modal>
  );
}
