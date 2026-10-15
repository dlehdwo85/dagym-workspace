'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Eye, Library, Loader2, Mail, MessageSquare, Paperclip, RotateCcw, Search, Send, Sparkles, Upload } from 'lucide-react';
import QRCode from 'qrcode';
import { api, broadcastRefresh, useApi } from './client';
import { Button, Field, Modal, cx, fmtDateTime, inputCls, toast } from './ui';
import { uploadTaskFiles } from './Attachments';

type Ctx = {
  canSend: boolean; account: { fromEmail: string; fromName: string | null } | null;
  kinds: { key: string; label: string; subject: string; body: string }[];
  companies: { key: string; name: string; isDefault: boolean; html: string; smsLine: string }[]; company: string | null;
  to: string[]; contact: { name: string | null; email: string | null; phone: string | null; organization: string | null } | null;
  me: { name: string; title: string | null; phone: string | null; email: string };
  attachments: { id: string; name: string; size: number; mime: string }[]; linkThresholdBytes: number; taskTitle: string;
};
type Item = { id: string; channel: string; preview: string | null; status: string; to_addrs: string[]; subject: string; files: { name: string }[]; as_link: boolean; attempts: number; last_error: string | null;
  error_kind: string | null; sent_at: string | null; created_at: string; next_attempt_at: string; sender_name: string; first_opened_at: string | null };

const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const splitAddrs = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const STATUS: Record<string, [string, string]> = {
  queued: ['보내는 중', 'bg-sky-50 text-sky-700'], sending: ['보내는 중', 'bg-sky-50 text-sky-700'], retry: ['재시도 대기', 'bg-amber-50 text-amber-800'],
  sent: ['보냄', 'bg-emerald-50 text-emerald-700'], failed: ['실패', 'bg-red-50 text-red-700'], canceled: ['취소', 'bg-slate-100 text-ink-3'],
};

/** V21 업무 안 "보낼 자료·메일": [메일로] 시안(실제 나갈 모습 그대로) → 사람이 [보내기] → 보관함 발송, 상태 실시간 */
export function TaskMail({ taskId, onChange }: { taskId: string; onChange: () => void }) {
  const hist = useApi<{ items: Item[]; canSend: boolean }>(`/api/tasks/${taskId}/mail?history=1`, [taskId]);
  const [open, setOpen] = useState(false);
  const busy = hist.data?.items.some((i) => ['queued', 'sending', 'retry'].includes(i.status));
  useEffect(() => { if (!busy) return; const t = setInterval(hist.reload, 3000); return () => clearInterval(t); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  async function retry(id: string) {
    try { await api(`/api/mail/outbox/${id}/retry`, { body: {} }); hist.reload(); } catch (e: any) { toast.error(e.message); }
  }
  if (!hist.data) return null;
  if (!hist.data.canSend && !hist.data.items.length) return null;
  return (
    <div className="mt-3 space-y-2" data-testid="task-mail">
      {hist.data.canSend && <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="mail-compose-open"><Mail />메일·문자 보내기</Button>}
      {hist.data.items.length > 0 && (
        <ul className="space-y-1 text-sm" data-testid="mail-history">
          {hist.data.items.map((i) => {
            const [label, tone] = STATUS[i.status] ?? [i.status, 'bg-slate-100'];
            return (
              <li key={i.id} className="rounded-input border border-line px-3 py-2" data-status={i.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone)} data-testid="mail-status">
                    {['queued', 'sending'].includes(i.status) ? <Loader2 className="size-3 animate-spin" /> : i.status === 'sent' ? <CheckCircle2 className="size-3" /> : i.status === 'failed' ? <AlertTriangle className="size-3" /> : null}{label}</span>
                  <b className="min-w-0 flex-1 truncate">{i.channel === 'sms:handoff' ? `문자 · ${i.preview ?? ''}` : i.subject}</b>
                  <span className="text-xs text-ink-3">{i.sender_name} · {fmtDateTime(i.sent_at ?? i.created_at)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-2">받는 사람 {i.to_addrs.join(', ')}{i.files.length > 0 && ` · 첨부 ${i.files.length}개${i.as_link ? '(링크)' : ''}`}</p>
                {i.first_opened_at && <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-700" data-testid="mail-opened"><Eye className="size-3" />고객이 자료를 열어봄 · {fmtDateTime(i.first_opened_at)}</p>}
                {i.status === 'retry' && <p className="mt-0.5 text-xs text-amber-800">{i.last_error} — {fmtDateTime(i.next_attempt_at)}에 자동으로 다시 보냅니다</p>}
                {i.status === 'failed' && <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-red-700" data-testid="mail-error">{i.last_error}
                  {i.error_kind === 'auth' && <Link href="/admin/mail" className="underline">메일 계정 확인</Link>}
                  {hist.data!.canSend && <button type="button" className="inline-flex items-center gap-1 font-medium underline" onClick={() => retry(i.id)} data-testid="mail-retry"><RotateCcw className="size-3" />다시 보내기</button>}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {open && <Compose taskId={taskId} onClose={() => setOpen(false)} onSent={() => { setOpen(false); hist.reload(); onChange(); broadcastRefresh(); }} onAttach={onChange} />}
    </div>
  );
}

function Compose({ taskId, onClose, onSent, onAttach }: { taskId: string; onClose: () => void; onSent: () => void; onAttach: () => void }) {
  const ctx = useApi<Ctx>(`/api/tasks/${taskId}/mail`, [taskId]);
  const d = ctx.data;
  const [f, setF] = useState<{ company: string; kind: string; to: string; cc: string; subject: string; body: string; files: string[]; title: string; phone: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [drafting, setDrafting] = useState(false);
  const [rec, setRec] = useState<{ id: string; title: string; folder: string; size: number }[]>([]);
  const [sms, setSms] = useState({ to: '', body: '' });
  const [smsOpen, setSmsOpen] = useState<{ url: string; qr: string | null; share?: string } | null>(null);
  const [lib, setLib] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [prog, setProg] = useState<{ name: string; pct: number; error?: string }[]>([]);
  useEffect(() => {
    if (!d || f) return;
    const k = d.kinds[d.kinds.length - 1];
    setF({ company: d.company ?? d.companies[0]?.key ?? '', kind: k.key, to: d.to.join(', '), cc: '', subject: `${k.subject}${d.contact?.organization ? ` — ${d.contact.organization}` : ''}`, body: k.body, files: [], title: '', phone: '' });
  }, [d, f]);
  const sig = d?.companies.find((c) => c.key === f?.company);
  const total = useMemo(() => (d && f ? d.attachments.filter((a) => f.files.includes(a.id)).reduce((s, a) => s + a.size, 0) : 0), [d, f]);
  const asLink = !!d && total > d.linkThresholdBytes;
  const preview = useMemo(() => {
    if (!d || !f) return '';
    const paras = esc(f.body).split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('');
    const link = asLink ? `<p style="margin:0 0 12px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc">첨부 자료 ${f.files.length}개(${mb(total)})는 용량이 커서 다운로드 링크로 바뀌어 들어갑니다(14일).</p>` : '';
    return `<body style="margin:12px;font-family:'Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${paras}${link}${sig?.html ?? ''}</body>`;
  }, [d, f, sig, asLink, total]);
  if (!d || !f) return <Modal open onClose={onClose} title="메일 시안" wide><p className="text-sm text-ink-3">불러오는 중…</p></Modal>;
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  function pickKind(key: string) {
    const k = d!.kinds.find((x) => x.key === key)!;
    set({ kind: key, subject: `${k.subject}${d!.contact?.organization ? ` — ${d!.contact.organization}` : ''}`, body: k.body });
  }
  // V21 2차: AI 초안(제목·본문) + 자료 추천 상위 3 — 초안만, 보내기는 사람
  async function aiDraft() {
    setDrafting(true);
    try {
      const r = await api('/api/mail/draft', { body: { taskId, kind: f!.kind, company: f!.company || undefined, channel } });
      if (channel === 'sms') setSms((x) => ({ ...x, body: r.body })); else set({ subject: r.subject, body: r.body });
      setRec(r.recommend ?? []);
      toast.ok('AI 초안을 넣었습니다 — 확인하고 고쳐 주세요');
    } catch (e: any) { toast.error(e.message); } finally { setDrafting(false); }
  }
  async function attachRec(id: string) {
    try {
      const r = await api(`/api/library/${id}/attach`, { body: { taskId } });
      const c = await api<Ctx>(`/api/tasks/${taskId}/mail`); ctx.setData(c); onAttach();
      setF((x) => x && { ...x, files: x.files.includes(r.id) ? x.files : [...x.files, r.id] }); setRec((x) => x.filter((y) => y.id !== id));
    } catch (e: any) { toast.error(e.message); }
  }
  // 문자 A 방식: 휴대폰 문자앱으로 넘김(본문·첨부 링크·서명 한 줄). PC 는 QR 로 휴대폰에서 열기
  const smsLine = sig?.smsLine ?? '';
  async function openSms() {
    const nums = sms.to.split(/[,;\s]+/).map((x) => x.replace(/[^0-9+]/g, '')).filter(Boolean);
    if (!nums.length) { toast.error('받는 사람 전화번호를 넣어 주세요'); return; }
    let share: string | undefined;
    try {
      if (f!.files.length) share = (await api('/api/mail/share', { body: { taskId, attachmentIds: f!.files } })).url;
    } catch (e: any) { toast.error(e.message); return; }
    const text = [sms.body.trim(), share ? `자료 내려받기(14일): ${share}` : '', smsLine].filter(Boolean).join('\n\n');
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const url = `sms:${nums.join(',')}${ios ? '&' : '?'}body=${encodeURIComponent(text)}`;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const qr = touch ? null : await QRCode.toDataURL(`sms:${nums.join(',')}?body=${encodeURIComponent(text)}`, { margin: 1, width: 220 }).catch(() => null);
    setSmsOpen({ url, qr, share });
    if (touch) window.location.href = url;
  }
  async function smsDone(sent: boolean) {
    if (!sent) { setSmsOpen(null); return; }
    try {
      const nums = sms.to.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
      await api('/api/mail/sms-log', { body: { taskId, to: nums, body: sms.body, shareUrl: smsOpen?.share } });
      toast.ok('문자 보낸 기록을 남겼습니다'); onSent();
    } catch (e: any) { toast.error(e.message); }
  }
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    const before = new Set(d!.attachments.map((a) => a.id));
    await uploadTaskFiles([...list], { taskId }, setProg);
    const r = await api<Ctx>(`/api/tasks/${taskId}/mail`); ctx.setData(r); onAttach();
    const added = r.attachments.filter((a) => !before.has(a.id)).map((a) => a.id) ?? [];
    setF((x) => x && { ...x, files: [...x.files, ...added] }); setProg([]);
  }
  async function send() {
    const to = splitAddrs(f!.to);
    if (!to.length) { toast.error('받는 사람 메일 주소를 넣어 주세요'); return; }
    setBusy(true);
    try {
      const r = await api('/api/mail/send', { body: { taskId, company: f!.company, to, cc: splitAddrs(f!.cc), subject: f!.subject, body: f!.body, attachmentIds: f!.files,
        senderTitle: f!.title || undefined, senderPhone: f!.phone || undefined } });
      toast.ok(r.asLink ? '보관함에 넣었습니다 — 첨부는 다운로드 링크로 보냅니다' : '보관함에 넣었습니다 — 곧 발송됩니다');
      onSent();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const from = d.account ? (d.account.fromName ? `${d.account.fromName} <${d.account.fromEmail}>` : d.account.fromEmail) : null;
  return (
    <Modal open onClose={onClose} title={channel === 'sms' ? '문자 시안' : '메일 시안 — 실제 나갈 모습'} wide>
      <div className="space-y-3" data-testid="mail-compose">
        {channel === 'email' && !d.account && <p className="rounded-input bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="mail-no-account">회사 메일 계정이 아직 연결되지 않아 보낼 수 없습니다. <Link href="/admin/mail" className="font-medium underline">메일 계정 연결</Link></p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="mr-2 flex rounded-input border border-line p-0.5 text-sm" role="tablist" aria-label="보내는 방법">
            {([['email', '메일', Mail], ['sms', '문자', MessageSquare]] as const).map(([k, l, I]) => (
              <button key={k} type="button" role="tab" aria-selected={channel === k} data-testid={`mail-channel-${k}`}
                onClick={() => { setChannel(k); if (k === 'sms' && !sms.to && !sms.body) setSms({ to: d!.contact?.phone ?? '', body: '' }); }}
                className={cx('inline-flex items-center gap-1 rounded-md px-2.5 py-1', channel === k ? 'bg-brand-600 text-white' : 'text-ink-2 hover:bg-slate-100')}><I className="size-4" />{l}</button>
            ))}
          </div>
          <span className="text-xs text-ink-3">회사</span>
          {d.companies.map((c) => <button key={c.key} type="button" onClick={() => set({ company: c.key })} aria-pressed={f.company === c.key} data-testid={`mail-company-${c.key}`}
            className={cx('rounded-full border px-2.5 py-0.5 text-sm', f.company === c.key ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line hover:bg-slate-50')}>{c.name}</button>)}
          <span className="ml-2 text-xs text-ink-3">양식</span>
          <span className="w-40"><select className={cx(inputCls, 'py-1')} value={f.kind} onChange={(e) => pickKind(e.target.value)} aria-label="메일 양식">{d.kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></span>
          <Button size="sm" variant="ghost" onClick={aiDraft} disabled={drafting} data-testid="mail-ai-draft"><Sparkles />{drafting ? 'AI 작성 중…' : 'AI 초안'}</Button>
        </div>
        {rec.length > 0 && (
          <div className="rounded-input bg-brand-50/60 px-3 py-2 text-sm" data-testid="mail-rec">
            <p className="mb-1 text-xs font-medium text-brand-700">AI 추천 자료 — 눌러서 첨부</p>
            <div className="flex flex-wrap gap-1.5">{rec.map((r) => <button key={r.id} type="button" onClick={() => attachRec(r.id)} className="rounded-full border border-brand-200 bg-white px-2.5 py-0.5 hover:bg-brand-50">+ {r.title} <span className="text-xs text-ink-3">{mb(r.size)}</span></button>)}</div>
          </div>
        )}
        {channel === 'sms' ? (
          <div className="grid gap-2 text-sm" data-testid="sms-pane">
            <p className="text-ink-2">내 휴대폰 문자앱으로 넘겨서 <b>내 번호로</b> 보냅니다. 첨부를 고르면 14일 다운로드 링크가 들어갑니다.</p>
            <Field label="받는 사람 전화번호 (여러 명은 쉼표)"><input className={inputCls} value={sms.to} onChange={(e) => setSms({ ...sms, to: e.target.value })} inputMode="tel" data-testid="sms-to" /></Field>
            <Field label="문자 내용"><textarea className={inputCls} rows={4} value={sms.body} onChange={(e) => setSms({ ...sms, body: e.target.value })} data-testid="sms-body" /></Field>
            <p className="whitespace-pre-wrap rounded-input bg-slate-50 px-3 py-2 text-xs text-ink-2" data-testid="sms-preview">{[sms.body.trim() || '(내용)', f.files.length ? '자료 내려받기(14일): https://…/d/…' : '', smsLine].filter(Boolean).join('\n\n')}</p>
          </div>
        ) : (
        <div className="grid gap-2 text-sm">
          <p className="text-ink-2">보내는 주소 <b className="text-ink" data-testid="mail-from-line">{from ?? '연결 안 됨'}</b></p>
          <Field label="받는 사람 (여러 명은 쉼표)"><input className={inputCls} value={f.to} onChange={(e) => set({ to: e.target.value })} placeholder={d.contact?.email ? '' : '고객 메일 주소 — 문의에 이메일이 없으면 직접 넣어 주세요'} data-testid="mail-to" /></Field>
          <Field label="참조"><input className={inputCls} value={f.cc} onChange={(e) => set({ cc: e.target.value })} data-testid="mail-cc" /></Field>
          <Field label="제목"><input className={inputCls} value={f.subject} onChange={(e) => set({ subject: e.target.value })} maxLength={200} data-testid="mail-subject" /></Field>
          <Field label="본문"><textarea className={inputCls} rows={7} value={f.body} onChange={(e) => set({ body: e.target.value })} data-testid="mail-body" /></Field>
        </div>
        )}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 text-sm font-medium"><Paperclip className="size-4" />첨부</span>
            <Button size="sm" variant="ghost" onClick={() => setLib((x) => !x)} data-testid="mail-lib-open"><Library />자료실에서 고르기</Button>
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}><Upload />파일 올리기</Button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
            <span className="ml-auto text-xs tabular-nums text-ink-3" data-testid="mail-total">합계 {total ? mb(total) : '0'}</span>
          </div>
          {prog.map((p) => <p key={p.name} className="text-xs text-ink-3">{p.name} {p.error ?? `${p.pct}%`}</p>)}
          {lib && <LibraryPick taskId={taskId} onPicked={async (id) => { await ctx.reload(); onAttach(); setF((x) => x && { ...x, files: x.files.includes(id) ? x.files : [...x.files, id] }); }} />}
          {d.attachments.length === 0 ? <p className="text-xs text-ink-3">이 업무에 첨부가 없습니다.</p> : (
            <ul className="grid gap-1 sm:grid-cols-2" data-testid="mail-files">
              {d.attachments.map((a) => (
                <li key={a.id}><label className="flex items-center gap-2 rounded-input border border-line px-2 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={f.files.includes(a.id)} onChange={(e) => set({ files: e.target.checked ? [...f.files, a.id] : f.files.filter((x) => x !== a.id) })} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span><span className="text-xs tabular-nums text-ink-3">{mb(a.size)}</span></label></li>
              ))}
            </ul>
          )}
          {asLink && <p className="text-xs text-amber-800" data-testid="mail-as-link">첨부 합계가 {mb(d.linkThresholdBytes)}를 넘어 메일에는 다운로드 링크(14일, 열람 기록)로 넣습니다.</p>}
        </div>
        {channel === 'email' && (!d.me.title || !d.me.phone) && (
          <div className="grid gap-2 rounded-input bg-slate-50 p-3 sm:grid-cols-2" data-testid="mail-me-ask">
            <p className="text-xs text-ink-2 sm:col-span-2">명함에 들어갈 내 {[!d.me.title && '직급', !d.me.phone && '휴대폰'].filter(Boolean).join('·')}이 비어 있습니다. 넣으면 프로필에 저장되어 다음부터 자동으로 들어갑니다.</p>
            {!d.me.title && <Field label="직급"><input className={inputCls} value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={50} data-testid="mail-me-title" /></Field>}
            {!d.me.phone && <Field label="휴대폰"><input className={inputCls} value={f.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={40} inputMode="tel" /></Field>}
          </div>
        )}
        {channel === 'email' && <div>
          <p className="mb-1 text-xs text-ink-3">미리보기 — 받는 사람에게 이렇게 보입니다</p>
          <iframe title="메일 미리보기" className="h-80 w-full rounded-input border border-line bg-white" srcDoc={preview} data-testid="mail-preview" />
        </div>}
        {channel === 'sms' && smsOpen && (
          <div className="space-y-2 rounded-input border border-line p-3 text-sm" data-testid="sms-confirm">
            {smsOpen.qr && <div className="flex items-center gap-3"><img src={smsOpen.qr} alt="휴대폰으로 찍으면 문자앱이 열립니다" className="size-36" /><p className="text-xs text-ink-2">PC 에는 문자앱이 없습니다. 휴대폰 카메라로 QR 을 찍으면 같은 문자가 문자앱에 채워집니다.</p></div>}
            {!smsOpen.qr && <p className="text-xs text-ink-2">문자앱이 열리지 않으면 <a href={smsOpen.url} className="underline">여기</a>를 누르세요.</p>}
            <p className="font-medium">문자를 보내셨나요?</p>
            <div className="flex gap-2"><Button size="sm" onClick={() => smsDone(true)} data-testid="sms-sent">보냈어요</Button><Button size="sm" variant="secondary" onClick={() => smsDone(false)}>안 보냄</Button></div>
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>닫기</Button>
          {channel === 'email'
            ? <Button onClick={send} disabled={busy || !d.account || !d.canSend} data-testid="mail-send"><Send />{busy ? '보관함에 넣는 중…' : '보내기'}</Button>
            : <Button onClick={openSms} disabled={!d.canSend} data-testid="sms-open"><MessageSquare />문자앱으로 보내기</Button>}
        </div>
      </div>
    </Modal>
  );
}

/** 자료실 검색 → 고르면 업무 첨부로 붙이고(같은 저장 파일) 메일 첨부에 체크. 권한 있는 자료만 보인다 */
function LibraryPick({ taskId, onPicked }: { taskId: string; onPicked: (attachmentId: string) => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const res = useApi<{ files: { id: string; title: string; file_name: string; folder: string; size_bytes: number }[] }>(`/api/library?limit=30&q=${encodeURIComponent(query)}`, [query]);
  async function pick(id: string) {
    try { const r = await api(`/api/library/${id}/attach`, { body: { taskId } }); onPicked(r.id); toast.ok('업무에 붙이고 메일 첨부에 넣었습니다'); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="space-y-1.5 rounded-input border border-line p-2" data-testid="mail-lib">
      <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="flex gap-1.5">
        <input className={cx(inputCls, 'py-1')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="회사소개서·제안서·견적서…" aria-label="자료 검색" />
        <Button size="sm" type="submit" variant="secondary"><Search />찾기</Button>
      </form>
      <ul className="max-h-48 overflow-y-auto text-sm">
        {(res.data?.files ?? []).map((x) => (
          <li key={x.id}><button type="button" onClick={() => pick(x.id)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-50">
            <span className="min-w-0 flex-1 truncate">{x.title || x.file_name}</span><span className="truncate text-xs text-ink-3">{x.folder}</span><span className="text-xs tabular-nums text-ink-3">{mb(Number(x.size_bytes))}</span></button></li>
        ))}
        {res.data && !res.data.files.length && <li className="px-2 py-1 text-xs text-ink-3">찾는 자료가 없습니다</li>}
      </ul>
    </div>
  );
}
