'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Bot, Camera, FileImage, Upload, UserRound } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { shrinkImage } from '@/components/Attachments';
import { putFile } from '@/components/upload';
import { Button, Empty, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, inputCls, toast } from '@/components/ui';

type Row = { id: string; brand_id: string | null; brand: string; content_id: string | null; content_title: string | null; kind: Kind; title: string; detail: string; wanted: number;
  assignee_id: string | null; assignee: string | null; due_on: string; status: Status; source: 'ai' | 'manual'; blocked: number; files: { id: string; title: string; mime_type: string }[] };
type Kind = 'photo' | 'video' | 'screen' | 'other';
type Status = 'requested' | 'received' | 'used' | 'canceled';
type Data = { rows: Row[]; brands: { id: string; name: string }[]; people: { id: string; name: string }[]; counts: Partial<Record<Status, number>>; canEdit: boolean; me?: string };

const KIND: Record<Kind, string> = { photo: '사진', video: '영상', screen: '앱 화면', other: '기타' };
const ACCEPT: Record<Kind, string> = { photo: 'image/*', video: 'video/*', screen: 'image/*,video/*', other: 'image/*,video/*,.pdf' };
const STATUS: Record<Status, string> = { requested: '요청 중', received: '받음', used: '사용함', canceled: '취소' };
const TABS: [Status | 'all', string][] = [['requested', '요청 중'], ['received', '받음'], ['used', '사용함'], ['all', '전체']];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
function dday(d: string) {
  const n = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 864e5);
  return n === 0 ? 'D-day' : n > 0 ? `D-${n}` : `${-n}일 지남`;
}

/** 자료실에 올리기 — 마케팅 자료실 '마케팅/브랜드 자료/{브랜드}'(서버가 받음 때 폴더·태그를 한 번 더 맞춤) */
async function upload(raw: File, brand: string, onPct: (p: number) => void) {
  const file = raw.type.startsWith('image/') ? await shrinkImage(raw) : raw;
  const r = await api('/api/library', { body: { fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, space: 'marketing',
    folder: `마케팅/브랜드 자료/${brand || '브랜드 없음'}`, tags: [...(brand ? [brand.slice(0, 30)] : []), '자료 요청'] } });
  const { uploadId } = await putFile(r.upload, file, onPct);
  await api(`/api/library/${r.id}/complete`, { body: uploadId ? { uploadId } : {} });
  return r.id as string;
}

/**
 * 297차 #836(대표 10/31 '사진이나 자료를 업로드하는 걸 요청하는 요청 페이지 — AI 마케터가 요청할 자료가 있으면 더 높은 퀄리티'): 마케팅 › 자료 요청.
 * AI 마케터가 단색 표지로 막힌 브랜드마다 자동으로 1장, 관리자도 만들 수 있음. 카드에서 바로 올리면 자료실 브랜드 폴더로 → 받음 → 그 브랜드 단색 표지 글 다시 그림 → 시안에 쓰이면 사용함.
 */
export function Materials() {
  const sp = useSearchParams();
  const focus = sp.get('r');
  const [tab, setTab] = useState<Status | 'all'>(sp.get('status') as Status || 'requested');
  const { data, error, loading, reload } = useApi<Data>(`/api/marketing/materials?status=${tab}`, [tab]);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (focus && data) document.querySelector(`[data-material="${focus}"]`)?.scrollIntoView({ block: 'center' }); }, [focus, data]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader icon={Camera} title="자료 요청" sub="AI 마케터가 더 좋은 시안을 만들려고 필요한 사진·화면을 요청합니다. 카드에서 바로 올리면 자료실 '마케팅/브랜드 자료'에 브랜드별로 저장되고, 그 브랜드의 단색 표지 글을 다시 그립니다."
        actions={data?.canEdit ? <Button size="sm" onClick={() => setCreating(true)} data-testid="material-new">자료 요청 만들기</Button> : null} />
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`material-tab-${k}`}
            className={cx('rounded-full border px-3 py-1 text-sm', tab === k ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-slate-200 text-ink-2 hover:bg-slate-50')}>
            {l}{k !== 'all' && data?.counts[k] ? <span className="ml-1 text-xs">{data.counts[k]}</span> : null}
          </button>
        ))}
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Skeleton rows={4} /> : data.rows.length === 0 ? (
        <Empty title={tab === 'requested' ? '요청 중인 자료가 없습니다' : '자료 요청이 없습니다'} icon={FileImage}>
          표지에 쓸 사진·화면이 없어 단색 표지만 나오는 브랜드가 생기면 AI 마케터가 여기에 요청을 남깁니다.
        </Empty>
      ) : (
        <ul className={cx('space-y-3', loading && 'opacity-70')} data-testid="material-list">
          {data.rows.map((r) => <Card key={r.id} r={r} focus={focus === r.id} canEdit={data.canEdit} reload={reload} />)}
        </ul>
      )}
      {data && <NewRequest open={creating} onClose={() => setCreating(false)} data={data} done={() => { setCreating(false); setTab('requested'); reload(); }} />}
    </div>
  );
}

function Card({ r, focus, canEdit, reload }: { r: Row; focus: boolean; canEdit: boolean; reload: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const late = r.status === 'requested' && r.due_on < today();
  async function pick(list: FileList | null) {
    const files = [...(list ?? [])].slice(0, 50);
    if (!files.length) return;
    setPct(0);
    try {
      const ids: string[] = [];
      for (let i = 0; i < files.length; i++) ids.push(await upload(files[i], r.brand, (p) => setPct(Math.round(((i + p / 100) / files.length) * 100))));
      await api(`/api/marketing/materials/${r.id}/receive`, { body: { fileIds: ids } });
      toast.ok(`${ids.length}개 받았습니다 — ${r.blocked ? `단색 표지 글 ${r.blocked}개를 다시 그립니다` : '다음 시안부터 씁니다'}`);
      reload();
    } catch (e: any) { toast.error(e.message || '올리지 못했습니다'); } finally { setPct(null); if (input.current) input.current.value = ''; }
  }
  async function setStatus(status: 'canceled' | 'requested') {
    setBusy(true);
    try { await api(`/api/marketing/materials/${r.id}`, { method: 'PATCH', body: { status } }); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <li data-testid="material-card" data-material={r.id} data-status={r.status}
      className={cx('rounded-card border bg-white p-4', focus ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200')}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-ink">{r.brand || '브랜드 없음'}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-ink-2">{KIND[r.kind]} {r.wanted}개</span>
        <span className={cx('inline-flex items-center gap-0.5 rounded px-1.5 py-0.5', r.source === 'ai' ? 'bg-violet-50 text-violet-700' : 'bg-slate-50 text-ink-2')}>
          {r.source === 'ai' ? <><Bot className="size-3" />AI 마케터</> : <><UserRound className="size-3" />사람</>}</span>
        <span className={cx('rounded px-1.5 py-0.5', r.status === 'requested' ? 'bg-amber-50 text-amber-800' : r.status === 'canceled' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700')} data-testid="material-status">{STATUS[r.status]}</span>
        {r.status === 'requested' && <span className={cx('font-medium', late ? 'text-red-600' : 'text-ink-2')}>기한 {r.due_on.slice(5).replace('-', '/')} · {dday(r.due_on)}</span>}
        <span className="text-ink-2">담당 {r.assignee ?? '없음'}</span>
      </div>
      <h3 className="mt-2 font-semibold text-ink">{r.title}</h3>
      {r.detail && <p className="mt-1 whitespace-pre-line text-sm text-ink-2">{r.detail}</p>}
      {(r.blocked > 0 || r.content_id) && (
        <p className="mt-2 text-xs text-ink-2">
          {r.blocked > 0 && <span className="font-medium text-amber-800" data-testid="material-blocked">표지 사진이 필요한 글 {r.blocked}개</span>}
          {r.blocked > 0 && r.content_id && ' · '}
          {r.content_id && <Link href={`/s/marketing/approvals?c=${r.content_id}`} className="underline">요청한 글: {r.content_title ?? '시안'}</Link>}
        </p>
      )}
      {r.files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="material-files">
          {r.files.map((f) => <li key={f.id}><Link href={`/library?file=${f.id}`} className="inline-flex max-w-[14rem] items-center gap-1 truncate rounded border border-slate-200 px-1.5 py-0.5 text-xs text-ink-2 hover:bg-slate-50"><FileImage className="size-3 shrink-0" /><span className="truncate">{f.title}</span></Link></li>)}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {r.status !== 'canceled' && (
          <>
            <input ref={input} type="file" multiple accept={ACCEPT[r.kind]} className="hidden" onChange={(e) => pick(e.target.files)} data-testid="material-upload" />
            <Button size="sm" variant={r.status === 'requested' ? 'primary' : 'secondary'} disabled={pct !== null} onClick={() => input.current?.click()}>
              <Upload className="size-4" />{pct !== null ? `올리는 중 ${pct}%` : r.status === 'requested' ? '자료 올리기' : '더 올리기'}
            </Button>
          </>
        )}
        {r.status === 'requested' && canEdit && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus('canceled')} data-testid="material-cancel">요청 취소</Button>}
        {r.status === 'canceled' && canEdit && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStatus('requested')}>다시 요청</Button>}
      </div>
    </li>
  );
}

function NewRequest({ open, onClose, data, done }: { open: boolean; onClose: () => void; data: Data; done: () => void }) {
  const [f, setF] = useState({ brandId: '', kind: 'photo' as Kind, title: '', detail: '', wanted: 5, assigneeId: '', dueOn: '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api('/api/marketing/materials', { body: { brandId: f.brandId, kind: f.kind, title: f.title, detail: f.detail, wanted: Number(f.wanted) || 1,
        assigneeId: f.assigneeId || null, ...(f.dueOn ? { dueOn: f.dueOn } : {}) } });
      toast.ok('자료 요청을 만들었습니다');
      setF({ brandId: '', kind: 'photo', title: '', detail: '', wanted: 5, assigneeId: '', dueOn: '' });
      done();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="자료 요청 만들기">
      <div className="space-y-3" data-testid="material-form">
        <div className="grid grid-cols-2 gap-3">
          <Field label="브랜드"><select className={inputCls} value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })} data-testid="material-brand">
            <option value="">고르기</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="종류"><select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind })}>
            {(Object.keys(KIND) as Kind[]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></Field>
        </div>
        <Field label="무엇이 필요한가요"><input className={inputCls} value={f.title} maxLength={120} placeholder="예: 다짐 강남점 입구·운동 장면 실사 5장" onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="material-title" /></Field>
        <Field label="설명·예시" hint="찍을 장면, 가로·세로, 피할 것(얼굴 정면·글자 있는 홍보물) 등"><textarea className={inputCls} rows={4} value={f.detail} maxLength={2000} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="몇 개"><input type="number" min={1} max={50} className={inputCls} value={f.wanted} onChange={(e) => setF({ ...f, wanted: Number(e.target.value) })} /></Field>
          <Field label="담당"><select className={inputCls} value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
            <option value="">없음</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="기한" hint="비우면 7일 뒤"><input type="date" className={inputCls} value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>닫기</Button>
          <Button disabled={busy || !f.brandId || f.title.trim().length < 2} onClick={save} data-testid="material-save">요청 보내기</Button>
        </div>
      </div>
    </Modal>
  );
}
