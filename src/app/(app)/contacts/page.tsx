'use client';
// V31 ① 회사 공용 연락처(고객·거래처): 검색·태그·목록, 등록/고치기, 상세(연결 업무·보낸 기록·변경 기록), 휴지통(30일), 엑셀·CSV·vCard 가져오기, 엑셀 내려받기.
// 직원 개인 주소록은 모으지 않는다 — 문의·발송·견적으로 받은 연락처가 자동으로 쌓이고, 직접 등록·파일 가져오기를 더한다.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Contact, Download, FileSpreadsheet, Mail, Phone, Plus, RotateCcw, Search, Trash2, Upload, X } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type C = { id: string; name: string; organization: string | null; title: string | null; phone: string | null; email: string | null; memo: string; tags: string[]; owner_id: string | null; owner_name: string | null; source: string; last_contact_at: string | null; created_by_name: string | null; created_at: string; deleted_at: string | null; task_count: number; canEdit: boolean };
type List = { contacts: C[]; total: number; tags: { tag: string; n: number }[]; isAdmin: boolean };
type Detail = { contact: C; tasks: { id: string; title: string; status: string; linked_at: string }[]; sent: { id: string; channel: string; subject: string | null; sent_at: string | null; created_at: string; sender: string }[]; history: { action: string; changes: any; created_at: string; actor: string | null }[] };
const SOURCE: Record<string, string> = { manual: '직접', inquiry: '문의', send: '발송', import: '가져오기', vcard: 'vCard', quote: '견적' };
const CHANNEL: Record<string, string> = { 'email:smtp': '메일', 'email:workin': '메일', 'sms:handoff': '문자', 'kakao:handoff': '카카오톡', 'quote:mail': '견적 메일', 'quote:sms': '견적 문자', 'quote:kakao': '견적 카카오톡', 'quote:share': '견적 공유' };
const ACTION: Record<string, string> = { created: '등록', updated: '수정', deleted: '휴지통', restored: '복원' };
const FIELD_KO: Record<string, string> = { name: '이름', organization: '회사·단지', title: '직함', phone: '휴대폰', email: '이메일', memo: '메모', tags: '태그', ownerId: '담당' };

export default function ContactsPage() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [tag, setTag] = useState('');
  const [trash, setTrash] = useState(false);
  const [edit, setEdit] = useState<Partial<C> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [imp, setImp] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q), 200); return () => clearTimeout(t); }, [q]);
  const list = useApi<List>(`/api/contacts?q=${encodeURIComponent(dq)}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}${trash ? '&trash=1' : ''}`, [dq, tag, trash]);
  return (
    <div className="mx-auto max-w-5xl space-y-3" data-testid="contacts-page">
      <PageHeader title="연락처" icon={Contact} sub="고객·거래처 연락처는 문의·메일·문자·견적서를 보낼 때 자동으로 쌓이고, 받는 사람 칸에 이름을 치면 바로 채워집니다. 직원 개인 주소록은 가져오지 않습니다."
        actions={<div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setImp(true)} data-testid="contacts-import"><Upload />가져오기</Button>
          <a href={`/api/contacts/export`} className="inline-flex h-8 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-xs hover:bg-slate-50" data-testid="contacts-export"><Download className="size-3.5" />엑셀</a>
          <Button size="sm" onClick={() => setEdit({})} data-testid="contact-new"><Plus />연락처</Button>
        </div>} />
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="relative min-w-0 flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" /><input className={cx(inputCls, 'pl-8')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·회사·번호·이메일·태그" aria-label="연락처 검색" data-testid="contacts-q" /></label>
        {list.data?.tags.slice(0, 8).map((t) => <button key={t.tag} onClick={() => setTag(tag === t.tag ? '' : t.tag)} className={cx('rounded-full border px-2.5 py-0.5 text-xs', tag === t.tag ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')}>#{t.tag} <span className="opacity-70">{t.n}</span></button>)}
        <button onClick={() => setTrash(!trash)} className={cx('ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs', trash ? 'border-slate-500 bg-slate-600 text-white' : 'border-line bg-white text-ink-2')} data-testid="contacts-trash"><Trash2 className="size-3" />휴지통</button>
      </div>
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Skeleton rows={6} />}
      {list.data && (
        <ul className="divide-y divide-line rounded-card border border-line bg-white shadow-card" data-testid="contact-list">
          {!list.data.contacts.length && <li className="p-6 text-center text-sm text-ink-3">{trash ? '휴지통이 비어 있습니다' : dq || tag ? '맞는 연락처가 없습니다' : '아직 연락처가 없습니다 — 문의를 받거나 메일·문자를 보내면 자동으로 쌓이고, [연락처]·[가져오기]로 직접 넣을 수도 있습니다'}</li>}
          {list.data.contacts.map((c) => (
            <li key={c.id}>
              <button className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50" onClick={() => setOpen(c.id)} data-testid="contact-row">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{c.name.slice(0, 1)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name}{c.title && <span className="ml-1 text-xs font-normal text-ink-2">{c.title}</span>}{c.organization && <span className="ml-1 text-xs font-normal text-ink-3">· {c.organization}</span>}</div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-ink-2">{c.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3" />{c.phone}</span>}{c.email && <span className="inline-flex items-center gap-1"><Mail className="size-3" />{c.email}</span>}</div>
                  <div className="text-[11px] text-ink-3">{SOURCE[c.source] ?? c.source}{c.owner_name && ` · 담당 ${c.owner_name}`}{c.task_count > 0 && ` · 업무 ${c.task_count}`}{c.last_contact_at && ` · 마지막 연락 ${fmtDateTime(c.last_contact_at)}`}{c.tags.length > 0 && ` · ${c.tags.map((t) => `#${t}`).join(' ')}`}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.data && !trash && <p className="text-[11px] text-ink-3">전체 {list.data.total.toLocaleString('ko-KR')}명 · 열람은 같은 회사 직원, 고치기·지우기는 등록한 사람·담당 직원·관리자. 지운 연락처는 휴지통에 30일 보관됩니다.</p>}
      {edit && <EditModal init={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
      {open && <DetailModal id={open} onClose={() => setOpen(null)} onEdit={(c) => { setOpen(null); setEdit(c); }} onChanged={() => { list.reload(); }} />}
      {imp && <ImportModal onClose={() => setImp(false)} onDone={() => { setImp(false); list.reload(); }} />}
    </div>
  );
}

function EditModal({ init, onClose, onSaved }: { init: Partial<C>; onClose: () => void; onSaved: () => void }) {
  const { dir } = useSession();
  const [f, setF] = useState({ name: init.name ?? '', organization: init.organization ?? '', title: init.title ?? '', phone: init.phone ?? '', email: init.email ?? '', memo: init.memo ?? '', tags: (init.tags ?? []).join(', '), ownerId: init.owner_id ?? '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, tags: f.tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean), ownerId: f.ownerId || null };
      if (init.id) await api(`/api/contacts/${init.id}`, { method: 'PATCH', body }); else await api('/api/contacts', { body });
      toast.ok(init.id ? '연락처를 고쳤습니다' : '연락처를 등록했습니다'); onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={init.id ? '연락처 고치기' : '연락처 등록'}>
      <div className="space-y-2" data-testid="contact-form">
        <div className="grid grid-cols-2 gap-2">
          <Field label="이름 *"><input className={inputCls} value={f.name} onChange={set('name')} aria-label="이름" data-testid="cf-name" autoFocus /></Field>
          <Field label="직함"><input className={inputCls} value={f.title} onChange={set('title')} aria-label="직함" data-testid="cf-title" /></Field>
        </div>
        <Field label="회사·단지"><input className={inputCls} value={f.organization} onChange={set('organization')} aria-label="회사·단지" data-testid="cf-org" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="휴대폰"><input className={inputCls} value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="010-0000-0000" aria-label="휴대폰" data-testid="cf-phone" /></Field>
          <Field label="이메일"><input className={inputCls} value={f.email} onChange={set('email')} inputMode="email" aria-label="이메일" data-testid="cf-email" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="태그 (쉼표)"><input className={inputCls} value={f.tags} onChange={set('tags')} placeholder="고객, 관리소" aria-label="태그" data-testid="cf-tags" /></Field>
          <Field label="담당 직원"><select className={inputCls} value={f.ownerId} onChange={set('ownerId')} aria-label="담당 직원"><option value="">없음</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        </div>
        <Field label="메모"><textarea className={cx(inputCls, 'min-h-16')} value={f.memo} onChange={set('memo')} aria-label="메모" /></Field>
        <p className="text-[11px] text-ink-3">휴대폰 번호나 이메일 중 하나는 있어야 합니다. 고객이 요청하면 지워 주세요(개인정보).</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={save} disabled={busy || !f.name.trim()} data-testid="cf-save">저장</Button></div>
      </div>
    </Modal>
  );
}

function DetailModal({ id, onClose, onEdit, onChanged }: { id: string; onClose: () => void; onEdit: (c: C) => void; onChanged: () => void }) {
  const st = useApi<Detail>(`/api/contacts/${id}`, [id]);
  const c = st.data?.contact;
  const del = async () => {
    if (!c || !confirm(`${c.name} 연락처를 휴지통으로 옮길까요? (30일 안에 되살릴 수 있습니다)`)) return;
    try { await api(`/api/contacts/${id}`, { method: 'DELETE' }); toast.ok('휴지통으로 옮겼습니다'); onChanged(); onClose(); } catch (e: any) { toast.error(e.message); }
  };
  const restore = async () => { try { await api(`/api/contacts/${id}/restore`, { method: 'POST' }); toast.ok('되살렸습니다'); onChanged(); st.reload(); } catch (e: any) { toast.error(e.message); } };
  return (
    <Modal open onClose={onClose} title={c ? c.name : '연락처'}>
      {!c ? <Skeleton rows={4} /> : (
        <div className="space-y-3 text-sm" data-testid="contact-detail">
          <div>
            <div className="text-base font-semibold">{c.name}{c.title && <span className="ml-1 text-sm font-normal text-ink-2">{c.title}</span>}</div>
            {c.organization && <div className="text-ink-2">{c.organization}</div>}
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {c.phone && <a href={`tel:${c.phone.replace(/\D/g, '')}`} className="inline-flex items-center gap-1 text-brand-700 underline" data-testid="cd-phone"><Phone className="size-3.5" />{c.phone}</a>}
              {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 text-brand-700 underline" data-testid="cd-email"><Mail className="size-3.5" />{c.email}</a>}
            </div>
            {c.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{c.tags.map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">#{t}</span>)}</div>}
            {c.memo && <p className="mt-2 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-ink-2">{c.memo}</p>}
            <p className="mt-1 text-[11px] text-ink-3">{SOURCE[c.source] ?? c.source}{c.created_by_name && ` · ${c.created_by_name} 등록`} · {fmtDateTime(c.created_at)}{c.owner_name && ` · 담당 ${c.owner_name}`}{c.deleted_at && ` · 휴지통 ${fmtDateTime(c.deleted_at)}`}</p>
          </div>
          {st.data!.tasks.length > 0 && <div><h3 className="text-xs font-semibold text-ink-2">연결된 업무</h3><ul className="mt-1 space-y-0.5 text-xs" data-testid="cd-tasks">{st.data!.tasks.map((t) => <li key={t.id}><Link href={`/tasks/${t.id}`} className="underline">{t.title}</Link> <span className="text-ink-3">· {fmtDateTime(t.linked_at)}</span></li>)}</ul></div>}
          {st.data!.sent.length > 0 && <div><h3 className="text-xs font-semibold text-ink-2">보낸 기록</h3><ul className="mt-1 space-y-0.5 text-xs" data-testid="cd-sent">{st.data!.sent.map((s) => <li key={s.id}>{CHANNEL[s.channel] ?? s.channel} · {s.subject ?? ''} <span className="text-ink-3">· {s.sender} · {fmtDateTime(s.sent_at ?? s.created_at)}</span></li>)}</ul></div>}
          {st.data!.history.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-ink-2">변경 기록 {st.data!.history.length}건</summary><ul className="mt-1 space-y-0.5">{st.data!.history.map((h, i) => <li key={i} className="text-ink-3">{fmtDateTime(h.created_at)} · {h.actor ?? '자동'} · {ACTION[h.action] ?? h.action}{h.action === 'updated' && h.changes && ` (${Object.keys(h.changes).map((k) => FIELD_KO[k] ?? k).join(', ')})`}</li>)}</ul></details>}
          <div className="flex flex-wrap justify-end gap-2">
            {c.deleted_at ? (c.canEdit && <Button size="sm" variant="secondary" onClick={restore} data-testid="cd-restore"><RotateCcw />되살리기</Button>) : c.canEdit && <>
              <Button size="sm" variant="danger" onClick={del} data-testid="cd-delete"><Trash2 />휴지통</Button>
              <Button size="sm" variant="secondary" onClick={() => onEdit(c)} data-testid="cd-edit">고치기</Button>
            </>}
            <Button size="sm" variant="ghost" onClick={onClose}>닫기</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

type Parsed = { headers: string[]; rows: string[][]; mapping: Record<string, number | undefined>; vcard: boolean };
type Preview = { rows: { row: number; name: string; phone: string; email: string; errors: string[] }[]; counts: { total: number; ready: number; errors: number } };
const IMPORT_FIELDS: [string, string][] = [['name', '이름 *'], ['organization', '회사·단지'], ['title', '직함'], ['phone', '휴대폰'], ['email', '이메일'], ['memo', '메모'], ['tags', '태그']];
const toBase64 = (f: File) => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => fail(r.error); r.readAsDataURL(f); });

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | undefined>>({});
  const [tags, setTags] = useState('');
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const inp = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  async function pick(f: File | undefined) {
    if (!f) return;
    if (!/\.(xlsx|csv|txt|tsv|vcf|vcard)$/i.test(f.name)) { toast.error('.xlsx · .csv · .vcf 파일을 골라 주세요'); return; }
    setBusy(true);
    try { const r = await api<Parsed>('/api/contacts/import/parse', { body: { fileName: f.name, data: await toBase64(f) } }); setParsed(r); setMapping(r.mapping); setFileName(f.name); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); if (inp.current) inp.current.value = ''; }
  }
  const body = () => ({ headers: parsed!.headers, rows: parsed!.rows, mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v !== undefined)), tags: tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean), source: parsed!.vcard ? 'vcard' : 'import' });
  useEffect(() => {
    if (!parsed || mapping.name === undefined) { setPv(null); return; }
    const n = ++seq.current;
    const t = setTimeout(async () => { try { const r = await api<Preview>('/api/contacts/import/preview', { body: body() }); if (n === seq.current) setPv(r); } catch (e: any) { if (n === seq.current) toast.error(e.message); } }, 250);
    return () => clearTimeout(t);
  }, [parsed, mapping]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run() {
    setBusy(true);
    try { const r = await api<{ created: number; updated: number }>('/api/contacts/import', { body: body() }); toast.ok(`연락처 ${r.created}명을 넣고 ${r.updated}명은 빈 칸을 채웠습니다`); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="연락처 가져오기" wide>
      <div className="space-y-3 text-sm" data-testid="contacts-import-modal">
        {!parsed ? (
          <div className="rounded-card border-2 border-dashed border-line p-6 text-center">
            <FileSpreadsheet className="mx-auto size-8 text-ink-3" />
            <p className="mt-2">엑셀(.xlsx)·CSV 또는 휴대폰에서 내보낸 vCard(.vcf) 파일</p>
            <p className="text-xs text-ink-3">첫 줄은 머리글(이름·회사·직함·휴대폰·이메일·메모·태그). 이미 있는 번호·이메일은 빈 칸만 채웁니다. 한 번에 1,000명까지.</p>
            <input ref={inp} type="file" accept=".xlsx,.csv,.txt,.tsv,.vcf,.vcard" className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-testid="contacts-file" />
            <Button className="mt-3" onClick={() => inp.current?.click()} disabled={busy}><Upload />파일 고르기</Button>
          </div>
        ) : (
          <>
            <p className="flex items-center gap-2 text-xs text-ink-2"><FileSpreadsheet className="size-4" />{fileName} · {parsed.rows.length}줄 <button className="ml-auto inline-flex items-center gap-1 text-ink-3 hover:text-ink" onClick={() => { setParsed(null); setPv(null); }}><X className="size-3.5" />다른 파일</button></p>
            {!parsed.vcard && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="contacts-mapping">
              {IMPORT_FIELDS.map(([k, label]) => <label key={k} className="text-xs text-ink-2">{label}<select className={cx(inputCls, 'mt-0.5 py-1')} value={mapping[k] ?? ''} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label={`${label} 열`}><option value="">— 없음 —</option>{parsed.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}</select></label>)}
            </div>}
            <Field label="모두에게 붙일 태그 (선택, 쉼표)"><input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="예: 2026 박람회" aria-label="가져오기 태그" /></Field>
            {pv && <div className="rounded-card border border-line p-3" data-testid="contacts-preview">
              <p className="text-sm">넣을 수 있는 연락처 <b data-testid="contacts-ready">{pv.counts.ready}</b>명{pv.counts.errors > 0 && <span className="text-amber-700"> · 건너뜀 {pv.counts.errors}줄</span>}</p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-xs">{pv.rows.slice(0, 50).map((r) => <li key={r.row} className={cx(r.errors.length && 'text-amber-800')}>{r.row}. {r.name || '(이름 없음)'} · {r.phone || r.email || '—'}{r.errors.length > 0 && ` — ${r.errors.join(', ')}`}</li>)}</ul>
            </div>}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={run} disabled={busy || !pv?.counts.ready} data-testid="contacts-import-run">{pv?.counts.ready ?? 0}명 가져오기</Button></div>
          </>
        )}
      </div>
    </Modal>
  );
}
