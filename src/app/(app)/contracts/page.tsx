'use client';
// 전자계약 2차(대표 10/23 "글로싸인 레퍼런스", docs/handoff/ECONTRACT_GLOSIGN_REFERENCE_2026-10-23.md §4·§6 1~2단계):
// 계약 관리(상태 바구니·참여자 진행) + 새 계약 4단계(문서 올리기 → 서명자 → 칸 놓기 → 검토·보내기). 직원 입사 서류(텍스트 서식)는 사용자 관리에서 그대로
import { useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Copy, FileSignature, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { putFile } from '@/components/upload';
import { useSession } from '@/components/session';
import { Button, Empty, Field, Skeleton, cx, inputCls, toast } from '@/components/ui';
import { SIGNER_COLORS, usePdfPages } from '@/components/pdfPages';

const BUCKETS = [['mine', '내 서명 필요'], ['others', '상대 서명 필요'], ['draft', '작성 중'], ['done', '완료'], ['closed', '취소·거절·만료'], ['all', '전체']] as const;
const STATUS: Record<string, string> = { draft: '작성 중', sent: '서명 대기', partially_signed: '일부 서명', completed: '완료', declined: '거절', cancelled: '취소', expired: '만료' };
const TOOLS = [['sign', '서명', 120, 50], ['stamp', '도장', 60, 60], ['text', '텍스트', 160, 22], ['date', '날짜', 110, 22]] as const;
type Tool = (typeof TOOLS)[number][0];
type Row = { id: string; title: string; doc_no: string | null; status: string; is_pdf: boolean; file_id: string | null; expires_at: string | null; created_at: string; bucket: string;
  signers: { id: string; ord: number; name: string; status: string; openedAt: string | null }[] | null };
type Signer = { name: string; email: string; phone: string; role: 'party' | 'company' | 'employee' | 'witness'; userId?: string };
type Fld = { signer: number; type: Tool; page: number; x: number; y: number; w: number; h: number; required: boolean; label: string };
const dday = (d: string | null) => { if (!d) return ''; const n = Math.ceil((new Date(d).getTime() - Date.now()) / 864e5); return n < 0 ? '기한 지남' : `D-${n}`; };
const day = (d: string) => new Date(d).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' });

export default function ContractsPage() {
  const [bucket, setBucket] = useState('all');
  const [creating, setCreating] = useState(false);
  const list = useApi<{ contracts: Row[]; counts: Record<string, number> }>(`/api/contracts${bucket === 'all' ? '' : `?bucket=${bucket}`}`, [bucket]);
  if (creating) return <NewContract onClose={() => { setCreating(false); list.reload(); }} />;
  async function cancel(r: Row) { if (!confirm(`"${r.title}" 계약을 취소할까요? 서명 링크가 더 열리지 않습니다.`)) return; try { await api(`/api/contracts/${r.id}`, { method: 'DELETE' }); list.reload(); toast.ok('취소했습니다'); } catch (e: any) { toast.error(e.message); } }
  async function resend(r: Row) {
    try { const x = await api(`/api/contracts/${r.id}/resend`, { body: {} }); const t = x.delivery?.map((d: any) => d.smsText).join('\n\n'); if (t) await navigator.clipboard?.writeText(t).catch(() => {}); toast.ok('다시 보냈습니다 — 새 링크·접속 코드 문자 문구를 복사했습니다'); list.reload(); } catch (e: any) { toast.error(e.message); }
  }
  const total = Object.values(list.data?.counts ?? {}).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-4" data-testid="contracts-page">
      <div className="flex flex-wrap items-center gap-2">
        <FileSignature className="size-5 text-teal-700" /><h1 className="text-lg font-bold">전자계약</h1>
        <span className="text-xs text-ink-3">계약서(PDF·사진)를 올리고 서명 칸을 놓아 보냅니다</span>
        <div className="ml-auto flex gap-2">
          <Link href="/admin/users?tab=contracts" className="inline-flex h-9 items-center rounded-input border border-line px-3 text-sm text-ink-2 hover:bg-slate-50">직원 입사 서류(서식)</Link>
          <Button onClick={() => setCreating(true)} data-testid="contract-new"><Plus />새 계약</Button>
        </div>
      </div>
      <div className="scrollbar-thin flex gap-1.5 overflow-x-auto" role="tablist" data-testid="contract-buckets">
        {BUCKETS.map(([k, label]) => {
          const n = k === 'all' ? total : list.data?.counts?.[k] ?? 0;
          return <button key={k} role="tab" aria-selected={bucket === k} onClick={() => setBucket(k)} data-testid={`bucket-${k}`}
            className={cx('shrink-0 rounded-full border px-3 py-1 text-sm', bucket === k ? 'border-teal-700 bg-teal-700 font-semibold text-white' : 'border-line bg-white text-ink-2 hover:bg-slate-50')}>{label} <span className="tabular-nums">{n}</span></button>;
        })}
      </div>
      {list.loading && !list.data ? <Skeleton rows={4} /> : !list.data?.contracts.length ? (
        <Empty title="계약이 없습니다" icon={FileSignature}><Button className="mt-2" onClick={() => setCreating(true)}><Plus />새 계약</Button></Empty>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line bg-white" data-testid="contract-list">
          {list.data.contracts.map((r) => {
            const ss = r.signers ?? [], done = ss.filter((s) => s.status === 'signed').length;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm" data-testid="contract-row">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{r.title}{r.is_pdf && <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10px] font-normal text-ink-2">올린 계약서</span>}</div>
                  <div className="text-xs text-ink-3">{r.doc_no} · 보낸 날 {day(r.created_at)}{['sent', 'partially_signed'].includes(r.status) && r.expires_at ? ` · ${dday(r.expires_at)}` : ''}</div>
                </div>
                <div className="flex items-center gap-1" title={ss.map((s) => `${s.ord}. ${s.name} ${s.status === 'signed' ? '서명' : s.openedAt ? '열람' : '대기'}`).join('\n')} data-testid="contract-progress">
                  {ss.map((s, i) => <span key={s.id} className={cx('size-2.5 rounded-full', s.status === 'signed' ? 'bg-emerald-500' : s.status === 'declined' ? 'bg-red-500' : 'bg-slate-300')} style={s.status === 'pending' ? { boxShadow: `0 0 0 1.5px ${SIGNER_COLORS[i % 6]}` } : undefined} />)}
                  <span className="ml-1 text-xs tabular-nums text-ink-2">{done}/{ss.length}</span>
                </div>
                <span className={cx('rounded-full px-2 py-0.5 text-xs', r.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : ['declined', 'cancelled', 'expired'].includes(r.status) ? 'bg-slate-100 text-ink-3' : 'bg-amber-50 text-amber-800')}>{STATUS[r.status] ?? r.status}</span>
                <span className="flex gap-1">
                  {r.file_id && <Link href={`/library?file=${r.file_id}`} className="rounded-input px-2 py-1 text-xs text-teal-700 hover:bg-teal-50">완료본</Link>}
                  {['sent', 'partially_signed', 'draft'].includes(r.status) && <button className="rounded-input px-2 py-1 text-xs text-ink-2 hover:bg-slate-100" onClick={() => resend(r)}>다시 보내기</button>}
                  {!['completed', 'cancelled'].includes(r.status) && <button className="rounded-input px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => cancel(r)}>취소</button>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 새 계약: ① 문서 ② 서명자 ③ 칸 놓기 ④ 검토·보내기 */
function NewContract({ onClose }: { onClose: () => void }) {
  const { user, dir } = useSession();
  const [step, setStep] = useState(1);
  const [src, setSrc] = useState<{ key: string; pages: number; name: string } | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [title, setTitle] = useState(''); const [message, setMessage] = useState('');
  const [days, setDays] = useState(14); const [codeBy, setCodeBy] = useState<'sms' | 'mail'>('sms');
  const [signers, setSigners] = useState<Signer[]>([{ name: '', email: '', phone: '', role: 'party' }]);
  const [fields, setFields] = useState<Fld[]>([]);
  const [tool, setTool] = useState<Tool | null>('sign'); const [cur, setCur] = useState(0); const [sel, setSel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<any>(null);
  const { pages, error } = usePdfPages(step === 3 && src ? `/api/contracts/source?key=${encodeURIComponent(src.key)}` : null);
  const drag = useRef<{ i: number; mode: 'move' | 'size'; sx: number; sy: number; f: Fld; W: number; H: number } | null>(null);
  async function upload(f: File) {
    setBusy(true); setPct(0);
    try {
      const t = await api('/api/contracts/upload', { body: { fileName: f.name, mime: f.type || 'application/octet-stream', size: f.size } });
      await putFile(t.upload, f, setPct);
      const r = await api('/api/contracts/source', { body: { key: t.key } });
      setSrc({ key: r.key, pages: r.pages, name: f.name }); setFields([]);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 120));
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); setPct(null); }
  }
  const setS = (i: number, p: Partial<Signer>) => setSigners((ss) => ss.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const okSigners = signers.length > 0 && signers.every((s) => s.name.trim() && (s.email.trim() || s.phone.trim()));
  const lacking = signers.map((s, i) => ({ s, i })).filter(({ i }) => !fields.some((f) => f.signer === i && (f.type === 'sign' || f.type === 'stamp')));
  function place(e: React.MouseEvent<HTMLDivElement>, page: number, pw: number, ph: number) {
    if (!tool || drag.current) return;
    const r = e.currentTarget.getBoundingClientRect(); const t = TOOLS.find((x) => x[0] === tool)!;
    const w = Math.min(0.9, t[2] / pw), h = Math.min(0.5, t[3] / ph);
    const x = Math.max(0, Math.min(1 - w, (e.clientX - r.left) / r.width - w / 2)), y = Math.max(0, Math.min(1 - h, (e.clientY - r.top) / r.height - h / 2));
    setFields((fs) => [...fs, { signer: cur, type: tool, page, x, y, w, h, required: true, label: '' }]); setSel(fields.length);
  }
  function startDrag(e: React.PointerEvent, i: number, mode: 'move' | 'size') {
    e.stopPropagation(); e.preventDefault(); setSel(i);
    const box = (e.currentTarget as HTMLElement).closest('[data-page]')!.getBoundingClientRect();
    drag.current = { i, mode, sx: e.clientX, sy: e.clientY, f: fields[i], W: box.width, H: box.height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDrag(e: React.PointerEvent) {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.sx) / d.W, dy = (e.clientY - d.sy) / d.H, f = d.f;
    const n = d.mode === 'move' ? { ...f, x: Math.max(0, Math.min(1 - f.w, f.x + dx)), y: Math.max(0, Math.min(1 - f.h, f.y + dy)) }
      : { ...f, w: Math.max(0.03, Math.min(1 - f.x, f.w + dx)), h: Math.max(0.012, Math.min(1 - f.y, f.h + dy)) };
    setFields((fs) => fs.map((x, j) => (j === d.i ? n : x)));
  }
  const endDrag = () => { setTimeout(() => { drag.current = null; }, 0); };
  async function send() {
    if (!src) return; setBusy(true);
    try {
      setResult(await api('/api/contracts/pdf', { body: { title: title.trim(), sourceKey: src.key, sourceName: src.name, message: message.trim() || undefined, codeBy, expiresDays: days,
        signers: signers.map((s, i) => ({ name: s.name.trim(), email: s.email.trim() || undefined, phone: s.phone.trim() || undefined, role: s.role, userId: s.userId, ord: i + 1 })),
        fields: fields.map((f) => ({ signer: f.signer, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label.trim() || undefined })) } }));
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.ok('복사했습니다'), () => {});
  const sf = sel !== null ? fields[sel] : null;
  const next = step === 1 ? !!src && !!title.trim() : step === 2 ? okSigners : step === 3 ? !!fields.length && !lacking.length : false;
  return (
    <div className="space-y-4" data-testid="contract-wizard">
      <div className="flex flex-wrap items-center gap-2">
        <button className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink" onClick={onClose}><ChevronLeft className="size-4" />계약 관리</button>
        <ol className="flex flex-1 justify-center gap-1 text-xs">{['문서', '서명자', '칸 놓기', '검토·보내기'].map((s, i) => <li key={s} className={cx('rounded-full px-2.5 py-1', step === i + 1 ? 'bg-teal-700 font-semibold text-white' : step > i + 1 ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-ink-3')}>{i + 1} {s}</li>)}</ol>
        {!result && <div className="flex gap-2">{step > 1 && <Button variant="secondary" onClick={() => setStep(step - 1)}>이전</Button>}{step < 4 && <Button onClick={() => setStep(step + 1)} disabled={!next} data-testid="wizard-next">다음</Button>}</div>}
      </div>
      {step === 1 && (
        <div className="mx-auto max-w-xl space-y-3 rounded-card border border-line bg-white p-4">
          <label className={cx('flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-line p-6 text-sm text-ink-2 hover:bg-slate-50', busy && 'pointer-events-none opacity-60')}>
            {busy ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6" />}
            {src ? <span><b>{src.name}</b> · {src.pages}쪽 — 다른 파일로 바꾸려면 누르세요</span> : <span>계약서 파일을 고르세요 (PDF·사진 png·jpg, 20MB까지)</span>}
            {pct !== null && <span className="text-xs">{pct}%</span>}
            <input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} data-testid="contract-file" />
          </label>
          <p className="text-[11px] text-ink-3">한글·워드 문서는 [PDF로 저장]한 뒤 올려 주세요.</p>
          <Field label="계약명"><input className={inputCls} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-testid="contract-title" /></Field>
          <Field label="전하는 말(선택)"><textarea className={cx(inputCls, 'min-h-16')} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="서명 기한"><select className={inputCls} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d}일</option>)}</select></Field>
            <Field label="접속 코드 전달"><select className={inputCls} value={codeBy} onChange={(e) => setCodeBy(e.target.value as 'sms' | 'mail')}><option value="sms">문자(문구 복사해 보냄)</option><option value="mail">메일</option></select></Field>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="mx-auto max-w-3xl space-y-2 rounded-card border border-line bg-white p-4" data-testid="contract-signers">
          <p className="text-xs text-ink-3">위에서부터 차례로 서명합니다. 서명자마다 색이 정해지고, 다음 단계에서 그 색으로 칸을 놓습니다.</p>
          {signers.map((s, i) => (
            <div key={i} className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-2 max-sm:grid-cols-[auto_1fr_auto]" data-testid="signer-row">
              <span className="inline-flex size-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: SIGNER_COLORS[i % 6] }}>{i + 1}</span>
              <input className={inputCls} placeholder="이름" value={s.name} onChange={(e) => setS(i, { name: e.target.value, userId: undefined })} list="contract-people" data-testid="signer-name"
                onBlur={(e) => { const u = dir.users.find((x) => x.name === e.target.value.trim()); if (u && !s.email) setS(i, { userId: u.id, email: (u as any).email ?? '', role: 'employee' }); }} />
              <input className={cx(inputCls, 'max-sm:col-span-2')} placeholder="이메일" value={s.email} onChange={(e) => setS(i, { email: e.target.value })} data-testid="signer-email" />
              <input className={cx(inputCls, 'max-sm:col-span-2')} placeholder="휴대폰" value={s.phone} onChange={(e) => setS(i, { phone: e.target.value })} />
              <button className="rounded p-1 text-ink-3 hover:text-red-600 disabled:opacity-30" disabled={signers.length < 2} onClick={() => { setSigners((ss) => ss.filter((_, j) => j !== i)); setFields((fs) => fs.filter((f) => f.signer !== i).map((f) => (f.signer > i ? { ...f, signer: f.signer - 1 } : f))); setCur(0); }} aria-label="서명자 빼기"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <datalist id="contract-people">{dir.users.map((u) => <option key={u.id} value={u.name} />)}</datalist>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="secondary" disabled={signers.length >= 6} onClick={() => setSigners((ss) => [...ss, { name: '', email: '', phone: '', role: 'party' }])} data-testid="signer-add"><Plus />서명자 추가</Button>
            <Button size="sm" variant="secondary" disabled={signers.length >= 6 || signers.some((s) => s.userId === user.id)} onClick={() => setSigners((ss) => [...ss.filter((s) => s.name.trim()), { name: user.name, email: user.email, phone: '', role: 'company', userId: user.id }])} data-testid="signer-me">나도 서명(회사)</Button>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="grid gap-3 lg:grid-cols-[1fr_240px]">
          <div className="space-y-3" onPointerMove={onDrag} onPointerUp={endDrag}>
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 rounded-card border border-line bg-white/95 p-2 text-sm backdrop-blur" data-testid="editor-tools">
              {signers.map((s, i) => <button key={i} onClick={() => setCur(i)} className={cx('rounded-full border-2 px-2 py-0.5 text-xs', cur === i ? 'font-semibold' : 'opacity-60')} style={{ borderColor: SIGNER_COLORS[i % 6], color: SIGNER_COLORS[i % 6] }} data-testid={`editor-signer-${i}`}>{i + 1}. {s.name}</button>)}
              <span className="mx-1 h-5 w-px bg-line" />
              {TOOLS.map(([k, label]) => <button key={k} onClick={() => setTool(tool === k ? null : k)} className={cx('rounded-input border px-2.5 py-1 text-xs', tool === k ? 'border-teal-700 bg-teal-700 text-white' : 'border-line hover:bg-slate-50')} data-testid={`tool-${k}`}>{label}</button>)}
              <span className="text-[11px] text-ink-3">도구를 고르고 문서를 누르면 칸이 놓입니다 · 끌어서 옮기고 오른쪽 아래 점으로 크기 조절</span>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!pages && !error && <Skeleton rows={6} />}
            {pages?.map((p, k) => (
              <div key={k} className="relative mx-auto max-w-[820px] select-none border border-line bg-white shadow-card" data-page={k + 1} data-testid="editor-page" onClick={(e) => place(e, k + 1, p.w, p.h)}>
                <img src={p.url} alt={`${k + 1}쪽`} className="pointer-events-none block w-full" draggable={false} />
                {fields.map((f, i) => f.page !== k + 1 ? null : (
                  <div key={i} onPointerDown={(e) => startDrag(e, i, 'move')} onClick={(e) => e.stopPropagation()} data-testid="editor-field"
                    className={cx('absolute flex cursor-move items-center justify-center overflow-hidden rounded-sm text-[10px] font-semibold', sel === i && 'ring-2 ring-offset-1')}
                    style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, border: `2px solid ${SIGNER_COLORS[f.signer % 6]}`, background: `${SIGNER_COLORS[f.signer % 6]}22`, color: SIGNER_COLORS[f.signer % 6] }}>
                    <span className="truncate px-0.5">{TOOLS.find((t) => t[0] === f.type)![1]}{f.label ? ` · ${f.label}` : ''} · {signers[f.signer]?.name}</span>
                    <span onPointerDown={(e) => startDrag(e, i, 'size')} className="absolute bottom-0 right-0 size-2.5 cursor-se-resize" style={{ background: SIGNER_COLORS[f.signer % 6] }} />
                  </div>
                ))}
                <span className="absolute right-1 top-1 rounded bg-black/40 px-1 text-[10px] text-white">{k + 1}/{pages.length}</span>
              </div>
            ))}
          </div>
          <aside className="space-y-2 lg:sticky lg:top-2 lg:self-start">
            {lacking.length > 0 && <p className="rounded-input bg-amber-50 p-2 text-xs text-amber-900" data-testid="editor-lacking">서명이나 도장 칸이 필요합니다: {lacking.map(({ s, i }) => `${i + 1}. ${s.name}`).join(', ')}</p>}
            <p className="text-xs text-ink-3">칸 {fields.length}개</p>
            {sf && (
              <div className="space-y-2 rounded-card border border-line bg-white p-3 text-sm" data-testid="field-props">
                <div className="font-semibold">{TOOLS.find((t) => t[0] === sf.type)![1]} 칸</div>
                <Field label="서명자"><select className={inputCls} value={sf.signer} onChange={(e) => setFields((fs) => fs.map((x, j) => (j === sel ? { ...x, signer: Number(e.target.value) } : x)))}>{signers.map((s, i) => <option key={i} value={i}>{i + 1}. {s.name}</option>)}</select></Field>
                {sf.type === 'text' && <><Field label="안내(예: 주소)"><input className={inputCls} value={sf.label} maxLength={40} onChange={(e) => setFields((fs) => fs.map((x, j) => (j === sel ? { ...x, label: e.target.value } : x)))} /></Field>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={sf.required} onChange={(e) => setFields((fs) => fs.map((x, j) => (j === sel ? { ...x, required: e.target.checked } : x)))} />꼭 채워야 함</label></>}
                {sf.type === 'date' && <p className="text-xs text-ink-3">서명한 날짜가 자동으로 들어갑니다</p>}
                <Button size="sm" variant="secondary" className="text-red-600" onClick={() => { setFields((fs) => fs.filter((_, j) => j !== sel)); setSel(null); }} data-testid="field-delete"><Trash2 />칸 지우기</Button>
              </div>
            )}
          </aside>
        </div>
      )}
      {step === 4 && !result && (
        <div className="mx-auto max-w-2xl space-y-3 rounded-card border border-line bg-white p-4 text-sm" data-testid="contract-review">
          <div><b>{title}</b> · {src?.name} ({src?.pages}쪽) · 기한 {days}일 · 접속 코드 {codeBy === 'mail' ? '메일' : '문자(직접 보냄)'}</div>
          {message && <p className="rounded-input bg-slate-50 p-2 text-xs">{message}</p>}
          <ul className="divide-y divide-line rounded-input border border-line">{signers.map((s, i) => {
            const mine = fields.filter((f) => f.signer === i);
            return <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2"><span className="size-3 rounded-full" style={{ background: SIGNER_COLORS[i % 6] }} /><b>{i + 1}. {s.name}</b><span className="text-xs text-ink-3">{s.email || s.phone}</span>
              <span className="ml-auto text-xs text-ink-2">{TOOLS.map(([k, label]) => { const n = mine.filter((f) => f.type === k).length; return n ? `${label} ${n}` : ''; }).filter(Boolean).join(' · ')}</span></li>;
          })}</ul>
          <div className="flex justify-end"><Button onClick={send} disabled={busy} data-testid="contract-send">{busy && <Loader2 className="animate-spin" />}보내기</Button></div>
        </div>
      )}
      {result && (
        <div className="mx-auto max-w-2xl space-y-3 rounded-card border border-emerald-200 bg-emerald-50/50 p-4 text-sm" data-testid="contract-sent">
          <p className="font-semibold text-emerald-800">{result.docNo} 을(를) 보냈습니다. 첫 순서 서명자에게 서명 요청이 갔습니다.</p>
          {(result.delivery ?? []).map((d: any) => (
            <div key={d.signerId} className="space-y-1 rounded-input bg-white p-2">
              <div><b>{d.name}</b> · 메일 {d.mail === 'sent' ? '보냄' : d.mail === 'none' ? '없음' : d.mail === 'dev' ? '(시험 환경)' : '실패'}</div>
              <div className="flex flex-wrap gap-2 text-xs"><code className="break-all">{d.link}</code><span>접속 코드 <b data-testid="sent-code">{d.code}</b></span></div>
              <Button size="sm" variant="secondary" onClick={() => copy(d.smsText)}><Copy />문자 문구 복사</Button>
            </div>
          ))}
          <div className="flex justify-end"><Button onClick={onClose}>계약 관리로</Button></div>
        </div>
      )}
    </div>
  );
}
