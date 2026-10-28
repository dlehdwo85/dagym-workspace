'use client';
import { dtf } from '@/lib/dtf';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, MessageCircle, CheckCircle2, Eye, Library, Loader2, Mail, MessageSquare, Paperclip, RotateCcw, Search, Send, Sparkles, Upload } from 'lucide-react';
import QRCode from 'qrcode';
import { api, broadcastRefresh, useApi } from './client';
import { SuggestInput, SuggestList, useRecipientSuggest } from './contacts/RecipientSuggest';
import { Button, Field, Modal, cx, fmtDateTime, inputCls, toast } from './ui';
import { uploadTaskFiles } from './Attachments';
import type { AssistDraft } from './TaskAssist';
import { KakaoSend } from './KakaoSend';
import { cacheForSms, canSmsAttach, smsWithFiles, type SmsFile } from './native';
import { planSmsAttach } from '@/lib/smsAttach';

type Cand = { value: string; label: string; source: 'inquiry' | 'contact' | 'lead' | 'description' }; // 대표 05:20 ②
type Ctx = {
  canSend: boolean; account: { fromEmail: string; fromName: string | null; mine?: boolean } | null;
  channel: 'email:smtp' | 'email:workin' | null; workinFrom: string | null; defaults: { fromName: string; replyTo: string }; replyToEditable?: boolean;
  kinds: { key: string; label: string; subject: string; body: string }[];
  companies: { key: string; name: string; isDefault: boolean; html: string; smsLine: string }[]; company: string | null;
  to: string[]; phone?: string | null; candidates?: { emails: Cand[]; phones: Cand[] }; contact: { name: string | null; email: string | null; phone: string | null; organization: string | null } | null;
  me: { name: string; title: string | null; phone: string | null; email: string; workEmail: string | null };
  attachments: { id: string; name: string; size: number; mime: string; source?: string; blocked?: 'deleted' | 'confidential' | null }[]; linkThresholdBytes: number; taskTitle: string;
};
type Item = { id: string; channel: string; preview: string | null; status: string; to_addrs: string[]; subject: string; files: { name: string }[]; as_link: boolean; attempts: number; last_error: string | null;
  error_kind: string | null; sent_at: string | null; created_at: string; next_attempt_at: string; sender_name: string; first_opened_at: string | null; scheduled_at?: string | null; created_by?: string; sms_body?: string | null };
/** #177 예약 문자를 다시 열 때(본문 완성본·받는 사람·보관함 행) */
type ComposeInitial = AssistDraft & { to?: string; outboxId?: string; complete?: boolean };
const INTENTS = { send: '자료 보냄', progress: '진행 안내', schedule: '일정 확인', thanks: '감사 인사' } as const;
const PH = /\[[^\]\n]{1,12}\]/; // V32 7-1: [날짜] 같은 빈칸

// ---- 대표 요청(10/19) 예약 보내기: KST 날짜·시각 → ISO(+09:00), 빠른 선택, 밤·주말 경고 ----
const kstParts = (d = new Date()) => { const f = dtf('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d);
  const g = (t: string) => f.find((x) => x.type === t)?.value ?? ''; return { date: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour').replace('24', '00')}:${g('minute')}`, wd: g('weekday') }; };
const addDaysKst = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00+09:00`) + n * 86400000);
export const kstIso = (date: string, hm: string) => `${date}T${hm}:00+09:00`;
export function quickSendTimes(now = new Date()) {
  const k = kstParts(now); const out: { label: string; iso: string }[] = [];
  if (k.hm < '17:50') out.push({ label: '오늘 오후 6시', iso: kstIso(k.date, '18:00') });
  out.push({ label: '내일 오전 9시', iso: kstIso(kstParts(addDaysKst(k.date, 1)).date, '09:00') });
  const wd = new Date(Date.UTC(+k.date.slice(0, 4), +k.date.slice(5, 7) - 1, +k.date.slice(8, 10))).getUTCDay(); // 서울 날짜의 요일
  out.push({ label: '월요일 오전 9시', iso: kstIso(kstParts(addDaysKst(k.date, ((8 - wd) % 7) || 7)).date, '09:00') });
  return out;
}
/** 받는 사람 쪽에서 불편할 수 있는 시각: 밤 9시~아침 8시·주말 */
export function sendTimeWarning(iso: string) {
  const k = kstParts(new Date(iso));
  const wd = new Date(Date.UTC(+k.date.slice(0, 4), +k.date.slice(5, 7) - 1, +k.date.slice(8, 10))).getUTCDay();
  if (wd === 0 || wd === 6) return '주말에 보내집니다';
  if (k.hm >= '21:00' || k.hm < '08:00') return '밤·이른 아침(21~08시)에 보내집니다';
  return '';
}
const fmtKst = (iso: string) => { const k = kstParts(new Date(iso)); return `${+k.date.slice(5, 7)}/${+k.date.slice(8, 10)}(${({ Sun: '일', Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토' } as Record<string, string>)[k.wd] ?? ''}) ${k.hm}`; };
const isScheduled = (i: Item) => i.status === 'queued' && !!i.scheduled_at && Date.parse(i.scheduled_at) > Date.now();

const mb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const splitAddrs = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
const STATUS: Record<string, [string, string]> = {
  queued: ['보내는 중', 'bg-sky-50 text-sky-700'], sending: ['보내는 중', 'bg-sky-50 text-sky-700'], retry: ['재시도 대기', 'bg-amber-50 text-amber-800'],
  sent: ['보냄', 'bg-emerald-50 text-emerald-700'], failed: ['실패', 'bg-red-50 text-red-700'], canceled: ['취소', 'bg-slate-100 text-ink-3'], due: ['보낼 시간', 'bg-amber-50 text-amber-800'],
};

/** V21 업무 안 "보낼 자료·메일": [메일로] 시안(실제 나갈 모습 그대로) → 사람이 [보내기] → 보관함 발송, 상태 실시간 */
export function TaskMail({ taskId, onChange, draft, onDraftUsed }: { taskId: string; onChange: () => void; draft?: AssistDraft | null; onDraftUsed?: () => void }) {
  const hist = useApi<{ items: Item[]; canSend: boolean }>(`/api/tasks/${taskId}/mail?history=1`, [taskId]);
  const [open, setOpen] = useState(false);
  const busy = hist.data?.items.some((i) => ['queued', 'sending', 'retry'].includes(i.status) && !isScheduled(i));
  useEffect(() => { if (!busy) return; const t = setInterval(hist.reload, 3000); return () => clearInterval(t); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  async function reschedule(id: string, body: { sendAt?: string; cancel?: boolean }) {
    try { await api(`/api/mail/outbox/${id}/schedule`, { body }); toast.ok(body.cancel ? '예약을 취소했습니다' : `${fmtKst(body.sendAt!)}에 보내도록 바꿨습니다`); hist.reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function retry(id: string) {
    try { await api(`/api/mail/outbox/${id}/retry`, { body: {} }); hist.reload(); } catch (e: any) { toast.error(e.message); }
  }
  // V28-1: 업무 AI 비서의 초안 → 시안 창을 바로 연다(보내기 권한이 없으면 안내만)
  const [initial, setInitial] = useState<ComposeInitial | null>(null);
  useEffect(() => {
    if (!draft || !hist.data) return;
    if (hist.data.canSend) { setInitial(draft); setOpen(true); } else toast.info('보내기 권한이 없어 시안 창을 열 수 없습니다 — 초안을 복사해 대표에게 전달해 주세요');
    onDraftUsed?.();
  }, [draft, hist.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // #177 예약 문자가 '보낼 시간'이면 본문 완성본으로 시안 창을 열어 문자앱으로 넘긴다 (알림 링크 /tasks/{id}?sms={outboxId} 는 자동으로)
  const openDue = (i: Item) => { setInitial({ channel: 'sms', subject: '', body: i.sms_body ?? '', attachmentIds: [], to: i.to_addrs.join(', '), outboxId: i.id, complete: true }); setOpen(true); };
  const dueOpened = useRef(false);
  useEffect(() => {
    if (!hist.data || dueOpened.current) return;
    const id = new URLSearchParams(window.location.search).get('sms'); if (!id) return;
    const it = hist.data.items.find((x) => x.id === id && x.status === 'due');
    if (it && hist.data.canSend) { dueOpened.current = true; openDue(it); }
  }, [hist.data]);
  if (!hist.data) return null;
  if (!hist.data.canSend && !hist.data.items.length) return null;
  return (
    <div className="mt-3 space-y-2" data-testid="task-mail">
      {hist.data.canSend && <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="mail-compose-open"><Mail />메일·문자 보내기</Button>}
      {hist.data.items.length > 0 && (
        <ul className="space-y-1 text-sm" data-testid="mail-history">
          {hist.data.items.map((i) => {
            const sch = isScheduled(i);
            const [label, tone] = sch ? [`예약 · ${fmtKst(i.scheduled_at!)}`, 'bg-violet-50 text-violet-700'] : STATUS[i.status] ?? [i.status, 'bg-slate-100'];
            return (
              <li key={i.id} className="rounded-input border border-line px-3 py-2" data-status={i.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone)} data-testid="mail-status">
                    {sch ? null : ['queued', 'sending'].includes(i.status) ? <Loader2 className="size-3 animate-spin" /> : i.status === 'sent' ? <CheckCircle2 className="size-3" /> : i.status === 'failed' ? <AlertTriangle className="size-3" /> : null}{label}</span>
                  <b className="min-w-0 flex-1 truncate">{i.channel === 'sms:handoff' ? `문자 · ${i.preview ?? ''}` : i.channel === 'kakao:handoff' ? `카카오톡 · ${i.preview ?? ''}` : i.subject}</b>
                  <span className="text-xs text-ink-3">{i.sender_name} · {fmtDateTime(i.sent_at ?? i.created_at)}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-2">받는 사람 {i.to_addrs.join(', ')}{i.files.length > 0 && ` · 첨부 ${i.files.length}개${i.as_link ? '(링크)' : ''}`}</p>
                {i.first_opened_at && <p className="mt-0.5 flex items-center gap-1 text-xs text-emerald-700" data-testid="mail-opened"><Eye className="size-3" />고객이 자료를 열어봄 · {fmtDateTime(i.first_opened_at)}</p>}
                {sch && hist.data!.canSend && <ScheduleEdit at={i.scheduled_at!} onChange={(iso) => reschedule(i.id, { sendAt: iso })} onCancel={() => confirm('예약을 취소할까요?') && reschedule(i.id, { cancel: true })} />}
                {i.status === 'due' && hist.data!.canSend && <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-800" data-testid="sms-due"><span>보낼 시간이 됐습니다 — 휴대폰 문자앱으로 넘겨 보내 주세요</span>
                  <button type="button" className="font-medium underline" onClick={() => openDue(i)} data-testid="sms-due-open">문자앱 열기</button>
                  <button type="button" className="underline" onClick={() => confirm('이 예약 문자를 보내지 않을까요?') && reschedule(i.id, { cancel: true })} data-testid="sms-due-cancel">안 보냄</button></p>}
                {i.status === 'retry' && <p className="mt-0.5 text-xs text-amber-800">{i.last_error} — {fmtDateTime(i.next_attempt_at)}에 자동으로 다시 보냅니다</p>}
                {i.status === 'failed' && <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-red-700" data-testid="mail-error">{i.last_error}
                  {i.error_kind === 'auth' && <Link href="/admin/mail" className="underline">메일 계정 확인</Link>}
                  {hist.data!.canSend && <button type="button" className="inline-flex items-center gap-1 font-medium underline" onClick={() => retry(i.id)} data-testid="mail-retry"><RotateCcw className="size-3" />다시 보내기</button>}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {open && <Compose taskId={taskId} initial={initial} onClose={() => { setOpen(false); setInitial(null); }} onSent={() => { setOpen(false); setInitial(null); hist.reload(); onChange(); broadcastRefresh(); }} onAttach={onChange} />}
    </div>
  );
}

function Compose({ taskId, onClose, onSent, onAttach, initial }: { taskId: string; onClose: () => void; onSent: () => void; onAttach: () => void; initial?: ComposeInitial | null }) {
  const ctx = useApi<Ctx>(`/api/tasks/${taskId}/mail`, [taskId]);
  const d = ctx.data;
  const [f, setF] = useState<{ company: string; kind: string; to: string; cc: string; bcc: string; fromName: string; replyTo: string; more: boolean; subject: string; body: string; files: string[]; title: string; phone: string; workEmail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sched, setSched] = useState<string | null>(null); // 예약 시각 ISO(+09:00)
  const [schedOpen, setSchedOpen] = useState(false);
  // 대표 실기기: 카카오톡 보내기 버튼이 안 보임(AI 카카오 초안에만 있었음) → 메일·문자 옆에 [카카오톡] 탭
  const [channel, setChannel] = useState<'email' | 'sms' | 'kakao'>(initial?.channel === 'sms' ? 'sms' : initial?.channel === 'kakao' ? 'kakao' : 'email');
  const [kakao, setKakao] = useState(initial?.channel === 'kakao' ? [initial.subject, initial.body].filter(Boolean).join('\n\n') : '');
  const [drafting, setDrafting] = useState(false);
  const [rec, setRec] = useState<{ id: string; title: string; folder: string; size: number }[]>([]);
  const [warn, setWarn] = useState<string[]>([]); // V32 7-1 초안 경고(빈칸·LMS)
  const [sms, setSms] = useState({ to: '', body: '' });
  // #194 files = 문자에 바로 붙인 파일(앱 1.1.3), fallbackShare = 문자앱이 안 열려 주소 방식으로 다시 열 때 쓸 내려받기 링크
  const [smsOpen, setSmsOpen] = useState<{ url: string; qr: string | null; share?: string; files?: { name: string; size: number }[]; fallbackShare?: string } | null>(null);
  const [attachOk, setAttachOk] = useState(false); // #194 앱 1.1.3(안드로이드): 문자에 파일 바로 첨부
  useEffect(() => { canSmsAttach().then(setAttachOk).catch(() => {}); }, []);
  const [lib, setLib] = useState(false);
  // 로컬 검수 10/17 보안: 자료실에서 고른 파일은 업무 첨부로 붙이지 않고 이번 발송에만 담는다
  const [libFiles, setLibFiles] = useState<{ id: string; name: string; size: number }[]>([]);
  const addLib = (x: { id: string; name: string; size: number }) => setLibFiles((l) => (l.some((y) => y.id === x.id) ? l : [...l, x]));
  const fileRef = useRef<HTMLInputElement>(null);
  const [prog, setProg] = useState<{ name: string; pct: number; error?: string }[]>([]);
  useEffect(() => {
    if (!d || f) return;
    const k = d.kinds[d.kinds.length - 1];
    const okFiles = (initial?.attachmentIds ?? []).filter((id) => d.attachments.some((a) => a.id === id && !a.blocked));
    setF({ company: d.company ?? d.companies[0]?.key ?? '', kind: k.key, to: d.to.join(', '), cc: '', bcc: '', fromName: d.defaults?.fromName ?? '', replyTo: d.defaults?.replyTo ?? '', more: false,
      subject: initial?.channel === 'email' && initial.subject ? initial.subject : `${k.subject}${d.contact?.organization ? ` — ${d.contact.organization}` : ''}`,
      body: initial?.channel === 'email' && initial.body ? initial.body : k.body, files: okFiles, title: '', phone: '', workEmail: '' });
    if (initial?.channel === 'sms') setSms({ to: initial.to ?? d.phone ?? d.contact?.phone ?? '', body: initial.body });
  }, [d, f]);
  const sig = d?.companies.find((c) => c.key === f?.company);
  const total = useMemo(() => (d && f ? d.attachments.filter((a) => f.files.includes(a.id)).reduce((s, a) => s + a.size, 0) + libFiles.reduce((s, a) => s + a.size, 0) : 0), [d, f, libFiles]);
  const fileCount = (f?.files.length ?? 0) + libFiles.length;
  const asLink = !!d && total > d.linkThresholdBytes;
  const preview = useMemo(() => {
    if (!d || !f) return '';
    const paras = esc(f.body).split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('');
    const link = asLink ? `<p style="margin:0 0 12px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc">첨부 자료 ${fileCount}개(${mb(total)})는 용량이 커서 다운로드 링크로 바뀌어 들어갑니다(14일).</p>` : '';
    return `<body style="margin:12px;font-family:'Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${paras}${link}${sig?.html ?? ''}</body>`;
  }, [d, f, sig, asLink, total, fileCount]);
  if (!d || !f) return <Modal open onClose={onClose} title="메일 시안" wide><p className="text-sm text-ink-3">불러오는 중…</p></Modal>;
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  function pickKind(key: string) {
    const k = d!.kinds.find((x) => x.key === key)!;
    set({ kind: key, subject: `${k.subject}${d!.contact?.organization ? ` — ${d!.contact.organization}` : ''}`, body: k.body });
  }
  // V21 2차: AI 초안(제목·본문) + 자료 추천 상위 3 — 초안만, 보내기는 사람
  async function aiDraft(intent?: string) {
    setDrafting(true);
    try {
      const r = await api('/api/mail/draft', { body: { taskId, kind: f!.kind, company: f!.company || undefined, channel: channel === 'kakao' ? 'sms' : channel, ...(intent ? { intent } : {}), hasFiles: fileCount > 0 } }); // 카카오톡은 짧은 문자 초안을 씀
      if (channel === 'sms') setSms((x) => ({ ...x, body: r.body })); else if (channel === 'kakao') setKakao(r.body); else set({ subject: r.subject, body: r.body });
      setRec(r.recommend ?? []); setWarn(r.warnings ?? []);
      toast.ok('AI 초안을 넣었습니다 — 확인하고 고쳐 주세요');
    } catch (e: any) { toast.error(e.message); } finally { setDrafting(false); }
  }
  function attachRec(r: { id: string; title: string; size: number }) {
    addLib({ id: r.id, name: r.title, size: r.size }); setRec((x) => x.filter((y) => y.id !== r.id));
  }
  const libIds = () => (libFiles.length ? libFiles.map((x) => x.id) : undefined);
  const picked = (): SmsFile[] => [...d!.attachments.filter((a) => f!.files.includes(a.id)).map((a) => ({ kind: 'att' as const, id: a.id, name: a.name, size: a.size, mime: a.mime })),
    ...libFiles.map((x) => ({ kind: 'lib' as const, id: x.id, name: x.name, size: x.size }))];
  const smsPlan = attachOk && fileCount > 0 && !initial?.complete ? planSmsAttach(picked()) : null;
  // 문자 A 방식: 휴대폰 문자앱으로 넘김(본문·첨부 링크·서명 한 줄). PC 는 QR 로 휴대폰에서 열기
  const smsLine = sig?.smsLine ?? '';
  async function openSms() {
    const nums = sms.to.split(/[,;\s]+/).map((x) => x.replace(/[^0-9+]/g, '')).filter(Boolean);
    if (!nums.length) { toast.error('받는 사람 전화번호를 넣어 주세요'); return; }
    if (PH.test(sms.body)) { toast.error('빈칸([날짜] 등)을 채운 뒤 보내 주세요'); return; }
    const complete = !!initial?.complete; // 예약 문자: 본문에 링크·서명이 이미 들어 있음
    let share: string | undefined;
    try {
      if (!complete && (f!.files.length || libFiles.length)) {
        const r = await withConfidentialConfirm((ok) => api('/api/mail/share', { body: { taskId, attachmentIds: f!.files, libraryFileIds: libIds(), company: f!.company || undefined, ...(ok ? { confirmConfidential: true } : {}) } }));
        if (!r) return; // 기밀 경고에서 [취소]
        share = r.url;
      }
    } catch (e: any) { toast.error(e.message); return; }
    const textOf = (link: boolean) => (complete ? sms.body.trim() : [sms.body.trim(), link && share ? `자료 내려받기(14일): ${share}` : '', smsLine].filter(Boolean).join('\n\n'));
    const text = textOf(true);
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const url = `sms:${nums.join(',')}${ios ? '&' : '?'}body=${encodeURIComponent(text)}`;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    // #194 앱 1.1.3(안드로이드): 합계 10MB까지는 파일을 문자에 바로 붙이고, 못 붙인 파일이 있을 때만 내려받기 링크를 넣는다.
    // 링크는 위에서 먼저 만든다(기밀 확인·공유 기록) — 문자앱이 안 열리면 아래 예전 방식(sms: 주소 + 링크)
    if (touch && attachOk && share) {
      setBusy(true);
      try {
        const plan = planSmsAttach(picked());
        const got = plan.direct.length ? await cacheForSms(plan.direct) : { ok: [], failed: [] };
        if (got.ok.length) {
          const linked = plan.link.length + got.failed.length > 0;
          await smsWithFiles({ phones: nums, body: textOf(linked), files: got.ok.map((x) => ({ uri: x.uri, mime: x.mime })) });
          setSmsOpen({ url, qr: null, share: linked ? share : undefined, files: got.ok.map((x) => ({ name: x.name, size: x.size })), fallbackShare: share });
          if (got.failed.length) toast.info(`${got.failed.length}개 파일은 받지 못해 내려받기 링크로 넣었습니다`);
          return;
        }
      } catch { /* 문자앱을 열지 못함 → 예전 방식 */ } finally { setBusy(false); }
    }
    const qr = touch ? null : await QRCode.toDataURL(`sms:${nums.join(',')}?body=${encodeURIComponent(text)}`, { margin: 1, width: 220 }).catch(() => null);
    setSmsOpen({ url, qr, share });
    if (touch) window.location.href = url;
  }
  async function smsDone(sent: boolean) {
    if (!sent) { setSmsOpen(null); return; }
    try {
      const nums = sms.to.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
      await api('/api/mail/sms-log', { body: { taskId, to: nums, body: sms.body, shareUrl: smsOpen?.share, ...(smsOpen?.files?.length ? { files: smsOpen.files } : {}), ...(initial?.outboxId ? { outboxId: initial.outboxId } : {}) } });
      toast.ok('문자 보낸 기록을 남겼습니다'); onSent();
    } catch (e: any) { toast.error(e.message); }
  }
  // #177 문자 예약: 서버는 보내지 못하므로 그 시각에 알림 → 문자앱으로 넘겨 사람이 보냄. 본문은 지금 완성본(링크·서명 포함)으로 저장
  async function scheduleSmsSend() {
    const nums = sms.to.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!nums.length) { toast.error('받는 사람 전화번호를 넣어 주세요'); return; }
    if (PH.test(sms.body)) { toast.error('빈칸([날짜] 등)을 채운 뒤 예약해 주세요'); return; }
    setBusy(true);
    try {
      let share: string | undefined;
      if (f!.files.length || libFiles.length) {
        const r = await withConfidentialConfirm((ok) => api('/api/mail/share', { body: { taskId, attachmentIds: f!.files, libraryFileIds: libIds(), company: f!.company || undefined, ...(ok ? { confirmConfidential: true } : {}) } }));
        if (!r) return; share = r.url;
      }
      const text = [sms.body.trim(), share ? `자료 내려받기(14일): ${share}` : '', smsLine].filter(Boolean).join('\n\n');
      const r = await api('/api/mail/sms-schedule', { body: { taskId, to: nums, body: text, sendAt: sched, ...(share ? { shareUrl: share } : {}) } });
      toast.ok(`${fmtKst(r.scheduledAt)}에 알려 드립니다 — 그때 문자앱으로 넘겨 보내 주세요`); onSent();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
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
    if (PH.test(f!.body)) { toast.error('빈칸([날짜] 등)을 채운 뒤 보내 주세요'); return; }
    setBusy(true);
    try {
      const r = await withConfidentialConfirm((ok) => api('/api/mail/send', { body: { taskId, company: f!.company, to, cc: splitAddrs(f!.cc), bcc: splitAddrs(f!.bcc), fromName: f!.fromName.trim() || undefined, replyTo: f!.replyTo.trim() || undefined, subject: f!.subject, body: f!.body, attachmentIds: f!.files, libraryFileIds: libIds(),
        senderTitle: f!.title || undefined, senderPhone: f!.phone || undefined, senderWorkEmail: f!.workEmail.trim() || undefined, ...(sched ? { sendAt: sched } : {}), ...(ok ? { confirmConfidential: true } : {}) } }));
      if (!r) return; // 기밀 경고에서 [취소]
      toast.ok(r.scheduledAt ? `${fmtKst(r.scheduledAt)}에 보내도록 예약했습니다 — 보낸 뒤 알림을 드립니다` : r.asLink ? '보관함에 넣었습니다 — 첨부는 다운로드 링크로 보냅니다' : '보관함에 넣었습니다 — 곧 발송됩니다');
      onSent();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const fromAddr = d.channel === 'email:workin' ? d.workinFrom : d.channel === 'email:smtp' ? d.account?.fromEmail ?? null : null;
  const from = fromAddr ? `${f.fromName || d.account?.fromName || ''} <${fromAddr}>`.trim() : null;
  return (
    <Modal open onClose={onClose} title={channel === 'sms' ? '문자 시안' : channel === 'kakao' ? '카카오톡 시안' : '메일 시안 — 실제 나갈 모습'} wide>
      <div className="space-y-3" data-testid="mail-compose">
        {channel === 'email' && !d.channel && <p className="rounded-input bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="mail-no-account">메일을 보낼 방법이 아직 없습니다 — 회사 메일 계정을 연결하거나 워크인 발송을 켜 주세요. <Link href="/admin/mail" className="font-medium underline">메일 설정</Link></p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="mr-2 flex rounded-input border border-line p-0.5 text-sm" role="tablist" aria-label="보내는 방법">
            {([['email', '메일', Mail], ['sms', '문자', MessageSquare], ['kakao', '카카오톡', MessageCircle]] as const).map(([k, l, I]) => (
              <button key={k} type="button" role="tab" aria-selected={channel === k} data-testid={`mail-channel-${k}`}
                onClick={() => { setChannel(k); if (k === 'sms' && !sms.body.trim()) setSms({ to: sms.to || d!.phone || (d!.contact?.phone ?? ''), body: plainOf(f.body) }); /* 대표 지적(10/19): 문자도 메일 시안 본문을 그대로 넣음 */ if (k === 'kakao' && !kakao) setKakao(sms.body || f.body.replace(/<[^>]+>/g, '').slice(0, 1000)); }}
                className={cx('inline-flex items-center gap-1 rounded-md px-2.5 py-1', channel === k ? 'bg-brand-600 text-white' : 'text-ink-2 hover:bg-slate-100')}><I className="size-4" />{l}</button>
            ))}
          </div>
          <span className="text-xs text-ink-3">회사</span>
          {d.companies.map((c) => <button key={c.key} type="button" onClick={() => set({ company: c.key })} aria-pressed={f.company === c.key} data-testid={`mail-company-${c.key}`}
            className={cx('rounded-full border px-2.5 py-0.5 text-sm', f.company === c.key ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line hover:bg-slate-50')}>{c.name}</button>)}
          <span className="ml-2 text-xs text-ink-3">양식</span>
          <span className="w-40"><select className={cx(inputCls, 'py-1')} value={f.kind} onChange={(e) => pickKind(e.target.value)} aria-label="메일 양식">{d.kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select></span>
          <Button size="sm" variant="ghost" onClick={() => aiDraft()} disabled={drafting} data-testid="mail-ai-draft"><Sparkles />{drafting ? 'AI 작성 중…' : 'AI 초안'}</Button>
          {channel !== 'kakao' && <span className="flex flex-wrap items-center gap-1 text-[11px] text-ink-3" data-testid="mail-ai-intents">다시 쓰기:
            {Object.entries(INTENTS).map(([k, l]) => <button key={k} type="button" disabled={drafting} onClick={() => aiDraft(k)} className="rounded-full border border-line bg-white px-2 py-0.5 hover:bg-slate-50" data-testid={`mail-ai-intent-${k}`}>{l}</button>)}</span>}
        </div>
        {warn.length > 0 && <ul className="rounded-input bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="mail-draft-warn">{warn.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
        {rec.length > 0 && (
          <div className="rounded-input bg-brand-50/60 px-3 py-2 text-sm" data-testid="mail-rec">
            <p className="mb-1 text-xs font-medium text-brand-700">AI 추천 자료 — 눌러서 첨부</p>
            <div className="flex flex-wrap gap-1.5">{rec.map((r) => <button key={r.id} type="button" onClick={() => attachRec(r)} className="rounded-full border border-brand-200 bg-white px-2.5 py-0.5 hover:bg-brand-50">+ {r.title} <span className="text-xs text-ink-3">{mb(r.size)}</span></button>)}</div>
          </div>
        )}
        {channel === 'kakao' ? (
          <div className="grid gap-2 text-sm" data-testid="kakao-pane">
            <p className="text-ink-2">카카오톡 친구를 골라 보냅니다(휴대폰은 카카오톡 앱, PC 는 공유 창·QR). 보낸 뒤 [보냈어요]를 누르면 보관함·업무 기록에 남습니다.</p>
            <Field label="카카오톡 내용"><textarea className={inputCls} rows={5} value={kakao} onChange={(e) => setKakao(e.target.value)} data-testid="kakao-body" /></Field>
          </div>
        ) : channel === 'sms' ? (
          <div className="grid gap-2 text-sm" data-testid="sms-pane">
            <p className="text-ink-2">내 휴대폰 문자앱으로 넘겨서 <b>내 번호로</b> 보냅니다. {attachOk ? '첨부는 합계 10MB까지 문자에 바로 붙이고, 넘는 파일만 14일 다운로드 링크로 들어갑니다.' : '첨부를 고르면 14일 다운로드 링크가 들어갑니다.'}{!initial?.complete && ' [예약]하면 그 시각에 알려 드리고, 그때 문자앱으로 넘겨 보냅니다(서버가 대신 보내지 않음).'}</p>
            <Field label="받는 사람 전화번호 (여러 명은 쉼표)"><SuggestInput value={sms.to} onChange={(v) => setSms({ ...sms, to: v })} kind="phone" multi taskId={taskId} testId="sms-to" placeholder="이름·회사·번호를 치면 회사 연락처에서 찾습니다" /></Field>
            <CandChips items={d.candidates?.phones ?? []} current={sms.to} onPick={(v) => setSms({ ...sms, to: [sms.to, v].filter((x) => x.trim()).join(', ') })} testId="sms-to-cand" />
            <Field label="문자 내용"><textarea className={inputCls} rows={4} value={sms.body} onChange={(e) => setSms({ ...sms, body: e.target.value })} data-testid="sms-body" /></Field>
            {(() => { const b = smsBytes([sms.body.trim(), smsLine].filter(Boolean).join('\n\n')); return (
              <p className={cx('-mt-1 flex flex-wrap items-center gap-2 text-xs', b > 2000 ? 'text-red-700' : 'text-ink-3')} data-testid="sms-bytes">
                {b}바이트 · {b <= 90 ? 'SMS(90바이트)' : b <= 2000 ? 'LMS(2,000바이트)' : '2,000바이트 넘음 — 줄여 주세요'}
                {b > 2000 && <button type="button" className="font-medium underline" onClick={() => setSms({ ...sms, body: fitBytes(sms.body, 2000 - smsBytes(smsLine) - 4) })} data-testid="sms-fit">요약본 넣기(앞부분만)</button>}
              </p>); })()}
            <p className="whitespace-pre-wrap rounded-input bg-slate-50 px-3 py-2 text-xs text-ink-2" data-testid="sms-preview">{[sms.body.trim() || '(내용)', fileCount && (!smsPlan || smsPlan.link.length) ? '자료 내려받기(14일): https://…/d/…' : '', smsLine].filter(Boolean).join('\n\n')}</p>
            {smsPlan && <p className="flex items-center gap-1 text-xs text-ink-2" data-testid="sms-attach-plan"><Paperclip className="size-3.5 shrink-0" />파일 {smsPlan.direct.length}개({mb(smsPlan.bytes)})를 문자에 바로 붙입니다{smsPlan.link.length > 0 && ` · ${smsPlan.link.length}개는 10MB를 넘어 내려받기 링크로`}</p>}
          </div>
        ) : (
        <div className="grid gap-2 text-sm">
          {/* 대표 지적(10/19): '보내는 주소'는 이름 <주소> 한 줄(길면 …), 설명·버튼은 그 아래 */}
          <div className="min-w-0 text-ink-2">
            <p className="flex min-w-0 items-baseline gap-2"><span className="shrink-0">보내는 주소</span><b className="min-w-0 truncate whitespace-nowrap text-ink" data-testid="mail-from-line" title={from ?? undefined}>{from ?? '연결 안 됨'}{d.account?.mine ? ' (내 메일 계정)' : ''}</b></p>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3">{d.channel === 'email:workin' && <span>워크인 발송 — 답장은 회신 주소로</span>}
              {d.channel && <button type="button" className="text-brand-700 underline" onClick={() => set({ more: !f.more })} data-testid="mail-more">{f.more ? '접기' : '보내는 이름·회신 주소·숨은 참조'}</button>}</p>
          </div>
          {f.more && (
            <div className="grid gap-2 rounded-input bg-slate-50 p-2 sm:grid-cols-2" data-testid="mail-more-fields">
              <Field label="보내는 이름"><input className={inputCls} value={f.fromName} onChange={(e) => set({ fromName: e.target.value })} maxLength={80} data-testid="mail-from-name" /></Field>
              <Field label="회신 주소(Reply-To) — 답장이 오는 곳"><input className={inputCls} type="email" value={f.replyTo} onChange={(e) => set({ replyTo: e.target.value })} disabled={d.replyToEditable === false} title={d.replyToEditable === false ? '회사 설정으로 바꿀 수 없습니다(관리자에게 요청)' : undefined} data-testid="mail-reply-to" /></Field>
              <Field label="숨은 참조"><AddrChips value={f.bcc} onChange={(v) => set({ bcc: v })} testId="mail-bcc" /></Field>
            </div>
          )}
          <CandChips items={d.candidates?.emails ?? []} current={f.to} onPick={(v) => set({ to: [f.to, v].filter((x) => x.trim()).join(', ') })} testId="mail-to-cand" />
          <Field label="받는 사람"><AddrChips value={f.to} onChange={(v) => set({ to: v })} placeholder="고객 메일 주소 — 이름·회사를 치면 회사 연락처에서 찾습니다" testId="mail-to" warn={!f.to.trim()} taskId={taskId} /></Field>
          {!f.to.trim() && <p className="-mt-1 flex items-center gap-1 text-xs font-medium text-amber-700" data-testid="mail-to-missing"><AlertTriangle className="size-3.5" />받는 사람 이메일이 없습니다{d.contact ? ' (문의에 이메일 없음)' : ''} — 고객 메일 주소를 입력해 주세요</p>}
          <Field label="참조"><AddrChips value={f.cc} onChange={(v) => set({ cc: v })} testId="mail-cc" /></Field>
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
          {lib && <LibraryPick onPicked={addLib} />}
          {libFiles.length > 0 && (
            <ul className="grid gap-1 sm:grid-cols-2" data-testid="mail-lib-files">
              {libFiles.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-input border border-brand-200 bg-brand-50/40 px-2 py-1 text-sm">
                  <Library className="size-3.5 shrink-0 text-brand-700" /><span className="min-w-0 flex-1 truncate">{a.name}</span><span className="text-xs tabular-nums text-ink-3">{mb(a.size)}</span>
                  <button type="button" onClick={() => setLibFiles((l) => l.filter((y) => y.id !== a.id))} className="text-xs text-ink-3 hover:text-ink" aria-label={`${a.name} 빼기`}>빼기</button></li>
              ))}
              <li className="text-xs text-ink-3 sm:col-span-2">자료실 파일은 이번 발송에만 담깁니다(업무 첨부로 남지 않음).</li>
            </ul>
          )}
          {d.attachments.length === 0 ? (!libFiles.length && <p className="text-xs text-ink-3">이 업무에 첨부가 없습니다.</p>) : (
            <ul className="grid gap-1 sm:grid-cols-2" data-testid="mail-files">
              {d.attachments.map((a) => (
                <li key={a.id} data-testid="mail-file" data-source={a.source ?? 'upload'} data-blocked={a.blocked ?? undefined}><label className={cx('flex items-center gap-2 rounded-input border border-line px-2 py-1 text-sm', a.blocked ? 'opacity-60' : 'hover:bg-slate-50')} title={a.blocked === 'confidential' ? '기밀 자료는 메일·문자로 보낼 수 없습니다(자료실 폴더·이름 규칙)' : a.blocked === 'deleted' ? '자료실에서 지워진 파일' : undefined}>
                  <input type="checkbox" checked={f.files.includes(a.id)} disabled={!!a.blocked} onChange={(e) => set({ files: e.target.checked ? [...f.files, a.id] : f.files.filter((x) => x !== a.id) })} />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>{a.source === 'library' && <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-ink-3">자료실</span>}{a.blocked && <span className="rounded-full bg-red-50 px-1.5 text-[10px] text-red-700">{a.blocked === 'confidential' ? '기밀 — 발송 불가' : '자료실에서 지워짐'}</span>}<span className="text-xs tabular-nums text-ink-3">{mb(a.size)}</span></label></li>
              ))}
            </ul>
          )}
          {asLink && <p className="text-xs text-amber-800" data-testid="mail-as-link">첨부 합계가 {mb(d.linkThresholdBytes)}를 넘어 메일에는 다운로드 링크(14일, 열람 기록)로 넣습니다.</p>}
        </div>
        {channel === 'email' && (!d.me.title || !d.me.phone || !d.me.workEmail) && (
          <div className="grid gap-2 rounded-input bg-slate-50 p-3 sm:grid-cols-2" data-testid="mail-me-ask">
            <p className="text-xs text-ink-2 sm:col-span-2">명함에 들어갈 내 {[!d.me.title && '직급', !d.me.phone && '휴대폰', !d.me.workEmail && '업무 이메일'].filter(Boolean).join('·')}이 비어 있습니다. 넣으면 프로필에 저장되어 다음부터 자동으로 들어갑니다.{!d.me.workEmail && ' 업무 이메일이 없으면 회사 메일 주소가 들어갑니다(로그인 이메일은 쓰지 않음).'}</p>
            {!d.me.title && <Field label="직급"><input className={inputCls} value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={50} data-testid="mail-me-title" /></Field>}
            {!d.me.phone && <Field label="휴대폰"><input className={inputCls} value={f.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={40} inputMode="tel" /></Field>}
            {!d.me.workEmail && <Field label="업무 이메일 (선택)"><input className={inputCls} type="email" value={f.workEmail} onChange={(e) => set({ workEmail: e.target.value })} placeholder={d.me.email || '회사 메일 주소'} data-testid="mail-me-work-email" /></Field>}
          </div>
        )}
        {channel === 'email' && <div>
          <p className="mb-1 text-xs text-ink-3">미리보기 — 받는 사람에게 이렇게 보입니다</p>
          <iframe title="메일 미리보기" className="h-80 w-full rounded-input border border-line bg-white" srcDoc={preview} data-testid="mail-preview" />
        </div>}
        {channel === 'sms' && smsOpen && (
          <div className="space-y-2 rounded-input border border-line p-3 text-sm" data-testid="sms-confirm">
            {smsOpen.qr && <div className="flex items-center gap-3"><img src={smsOpen.qr} alt="휴대폰으로 찍으면 문자앱이 열립니다" className="size-36" /><p className="text-xs text-ink-2">PC 에는 문자앱이 없습니다. 휴대폰 카메라로 QR 을 찍으면 같은 문자가 문자앱에 채워집니다.</p></div>}
            {smsOpen.files?.length ? <p className="text-xs text-ink-2" data-testid="sms-attached">파일 {smsOpen.files.length}개를 붙여 문자앱을 열었습니다.</p> : null}
            {!smsOpen.qr && <p className="text-xs text-ink-2">문자앱이 열리지 않으면 <a href={smsOpen.url} className="underline" onClick={() => setSmsOpen((s) => s && { ...s, files: undefined, share: s.fallbackShare ?? s.share })}>여기</a>를 누르세요{smsOpen.files?.length ? '(파일 대신 내려받기 링크)' : ''}.</p>}
            <p className="font-medium">문자를 보내셨나요?</p>
            <div className="flex gap-2"><Button size="sm" onClick={() => smsDone(true)} data-testid="sms-sent">보냈어요</Button><Button size="sm" variant="secondary" onClick={() => smsDone(false)}>안 보냄</Button></div>
          </div>
        )}
        {/* 로컬 실기기 83: 버튼 줄은 시트 아래에 붙어 있게(긴 시안을 내려도 보임) */}
        <div className="sticky bottom-0 z-10 -mx-5 -mb-[calc(var(--sab)+20px)] flex items-center justify-end gap-2 border-t border-line bg-white px-5 pb-[calc(var(--sab)+12px)] pt-3 sm:-mb-5 sm:pb-4" data-testid="compose-actions">
          <Button variant="secondary" onClick={onClose}>닫기</Button>
          {channel === 'email'
            ? <span className="relative flex items-center gap-1.5">
                {schedOpen && <SchedulePicker value={sched} onPick={(v) => { setSched(v); setSchedOpen(false); }} onClose={() => setSchedOpen(false)} />}
                <Button variant="secondary" onClick={() => setSchedOpen(!schedOpen)} disabled={busy || !d.channel || !d.canSend} aria-expanded={schedOpen} data-testid="mail-schedule-open">{sched ? `예약 ${fmtKst(sched)}` : '예약 ▾'}</Button>
                {sched && <button type="button" className="text-xs text-ink-3 underline" onClick={() => setSched(null)} data-testid="mail-schedule-clear">바로 보내기로</button>}
                <Button onClick={send} disabled={busy || !d.channel || !d.canSend} data-testid="mail-send"><Send />{busy ? '보관함에 넣는 중…' : sched ? '예약 보내기' : '바로 보내기'}</Button>
              </span>
            : channel === 'kakao' ? (kakao.trim() ? <KakaoSend taskId={taskId} body={kakao} onLogged={onSent} /> : <span className="text-xs text-ink-3">내용을 넣어 주세요</span>)
            : <span className="relative flex items-center gap-1.5">
                {!initial?.complete && <>
                  {schedOpen && <SchedulePicker value={sched} onPick={(v) => { setSched(v); setSchedOpen(false); }} onClose={() => setSchedOpen(false)} />}
                  <Button variant="secondary" onClick={() => setSchedOpen(!schedOpen)} disabled={busy || !d.canSend} aria-expanded={schedOpen} data-testid="sms-schedule-open">{sched ? `예약 ${fmtKst(sched)}` : '예약 ▾'}</Button>
                  {sched && <button type="button" className="text-xs text-ink-3 underline" onClick={() => setSched(null)} data-testid="sms-schedule-clear">지금 보내기로</button>}
                </>}
                {sched && !initial?.complete
                  ? <Button onClick={scheduleSmsSend} disabled={busy || !d.canSend} data-testid="sms-schedule-send"><Send />{busy ? '예약 중…' : '예약하기'}</Button>
                  : <Button onClick={openSms} disabled={busy || !d.canSend} data-testid="sms-open"><MessageSquare />{busy ? '파일을 붙이는 중…' : '문자앱으로 보내기'}</Button>}
              </span>}
        </div>
      </div>
    </Modal>
  );
}

/** 자료실 검색 → 고르면 이번 메일·문자 첨부에만 담는다(업무 첨부로 붙이지 않음). 권한 있는 자료만 보인다 */
function LibraryPick({ onPicked }: { onPicked: (f: { id: string; name: string; size: number }) => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const res = useApi<{ files: { id: string; title: string; file_name: string; folder: string; size_bytes: number }[] }>(`/api/library?limit=30&q=${encodeURIComponent(query)}`, [query]);
  function pick(x: { id: string; title: string; file_name: string; size_bytes: number }) {
    onPicked({ id: x.id, name: x.title || x.file_name, size: Number(x.size_bytes) }); toast.ok('메일 첨부에 넣었습니다');
  }
  return (
    <div className="space-y-1.5 rounded-input border border-line p-2" data-testid="mail-lib">
      <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="flex gap-1.5">
        <input className={cx(inputCls, 'py-1')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="회사소개서·제안서·견적서…" aria-label="자료 검색" />
        <Button size="sm" type="submit" variant="secondary"><Search />찾기</Button>
      </form>
      <ul className="max-h-48 overflow-y-auto text-sm">
        {(res.data?.files ?? []).map((x) => (
          <li key={x.id}><button type="button" onClick={() => pick(x)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-50">
            <span className="min-w-0 flex-1 truncate">{x.title || x.file_name}</span><span className="truncate text-xs text-ink-3">{x.folder}</span><span className="text-xs tabular-nums text-ink-3">{mb(Number(x.size_bytes))}</span></button></li>
        ))}
        {res.data && !res.data.files.length && <li className="px-2 py-1 text-xs text-ink-3">찾는 자료가 없습니다</li>}
      </ul>
    </div>
  );
}

/** V38 4: 이름 규칙상 기밀로 분류된 업무 첨부를 밖으로 보낼 때 경고 + 확인 한 번(서버가 409 confirm_confidential) — 취소하면 null */
async function withConfidentialConfirm<T>(run: (confirmed: boolean) => Promise<T>): Promise<T | null> {
  try { return await run(false); } catch (e: any) {
    if (e?.code !== 'confirm_confidential') throw e;
    if (!window.confirm(e.message)) return null;
    return await run(true);
  }
}

/** 예약 시각 고르기: 빠른 선택 3개 + 날짜·시각 직접(KST), 밤·주말이면 경고 */
function SchedulePicker({ value, onPick, onClose, down }: { value: string | null; onPick: (iso: string) => void; onClose: () => void; down?: boolean }) {
  const k0 = value ? kstParts(new Date(value)) : kstParts(new Date(Date.now() + 3600000));
  const [date, setDate] = useState(k0.date); const [hm, setHm] = useState(value ? k0.hm : `${k0.hm.slice(0, 2)}:00`);
  const iso = kstIso(date, hm); const warn = sendTimeWarning(iso); const past = Date.parse(iso) < Date.now() + 60000;
  return (
    <>
      <span className="fixed inset-0 z-40" onClick={onClose} />
      <span className={cx('absolute z-50 w-72', down ? 'left-0 top-5' : 'bottom-11 right-0')}><span className="block rounded-card border border-line bg-white p-3 text-sm shadow-pop" role="dialog" aria-label="예약 시각" data-testid="mail-schedule">
        <span className="mb-2 block font-semibold">예약 보내기 <span className="text-xs font-normal text-ink-3">(한국 시간)</span></span>
        <span className="flex flex-col gap-1">{quickSendTimes().map((q) => (
          <button key={q.label} type="button" className="rounded-input px-2 py-1.5 text-left hover:bg-slate-100" onClick={() => onPick(q.iso)} data-testid="mail-schedule-quick">{q.label}<span className="ml-2 text-xs text-ink-3">{fmtKst(q.iso)}</span>{sendTimeWarning(q.iso) && <span className="ml-1 text-xs text-amber-700">⚠</span>}</button>
        ))}</span>
        <span className="mt-2 flex items-center gap-1.5 border-t border-line pt-2">
          <input type="date" className={cx(inputCls, 'h-8 flex-1 px-2')} value={date} onChange={(e) => setDate(e.target.value)} aria-label="예약 날짜" />
          <input type="time" step={300} className={cx(inputCls, 'h-8 w-24 px-2')} value={hm} onChange={(e) => setHm(e.target.value)} aria-label="예약 시각" />
        </span>
        {warn && <span className="mt-1.5 block text-xs text-amber-800" data-testid="mail-schedule-warn">⚠ {warn} — 받는 분께 불편할 수 있어요</span>}
        {past && <span className="mt-1.5 block text-xs text-red-700">지금보다 뒤 시각을 골라 주세요</span>}
        <span className="mt-2 flex justify-end"><Button size="sm" disabled={past} onClick={() => onPick(iso)} data-testid="mail-schedule-set">이 시각으로</Button></span>
      </span></span>
    </>
  );
}
/** 보낸 기록의 예약 줄: 시각 바꾸기·취소 */
function ScheduleEdit({ at, onChange, onCancel }: { at: string; onChange: (iso: string) => void; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <p className="relative mt-1 flex flex-wrap items-center gap-2 text-xs text-violet-800" data-testid="mail-scheduled">
      {fmtKst(at)}에 보냅니다{sendTimeWarning(at) && <span className="text-amber-700">⚠ {sendTimeWarning(at)}</span>}
      <button type="button" className="font-medium underline" onClick={() => setOpen(!open)} data-testid="mail-reschedule">시간 바꾸기</button>
      <button type="button" className="font-medium underline" onClick={onCancel} data-testid="mail-schedule-cancel">예약 취소</button>
      {open && <SchedulePicker down value={at} onPick={(v) => { setOpen(false); onChange(v); }} onClose={() => setOpen(false)} />}
    </p>
  );
}

// ---- 대표 지적(10/19) 받는 사람 칩·문자 시안 ----
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
/** 문자 바이트(한글 등 2, 영문·숫자 1 — 통신사 SMS 90·LMS 2,000 기준) */
export const smsBytes = (s: string) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
/** 바이트 한도 안으로 앞부분만(문장 끝에서 자름) */
export function fitBytes(s: string, max: number) {
  let n = 0, out = '';
  for (const ch of s) { const w = ch.charCodeAt(0) > 127 ? 2 : 1; if (n + w > max) break; n += w; out += ch; }
  const cut = Math.max(out.lastIndexOf('.\n'), out.lastIndexOf('다.'), out.lastIndexOf('\n\n'));
  return (cut > out.length * 0.5 ? out.slice(0, cut + 2) : out).trim();
}
const plainOf = (html: string) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
/** 받는 사람 입력: 스페이스·엔터·쉼표·세미콜론·붙여넣기 → 칩, 칩마다 형식 검사(틀리면 빨강), 빈 칸에서 백스페이스 = 마지막 칩 지우기, 직원·고객 주소 자동 완성 */
/** 대표 05:20 ②: 자동 채움 후보(문의자·연락처·리드·업무 설명) — 아직 안 들어간 값만 칩으로, 누르면 받는 사람에 추가 */
function CandChips({ items, current, onPick, testId }: { items: Cand[]; current: string; onPick: (v: string) => void; testId: string }) {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9@.+]/g, '');
  const have = new Set(current.split(/[\s,;]+/).map(norm).filter(Boolean));
  const rest = items.filter((c) => !have.has(norm(c.value)));
  if (!rest.length) return null;
  const SRC: Record<Cand['source'], string> = { inquiry: '문의자', contact: '연락처', lead: '리드', description: '업무 설명' };
  return <div className="-mb-1 flex flex-wrap items-center gap-1 text-[11px]" data-testid={testId}><span className="text-ink-3">제안:</span>
    {rest.map((c) => <button key={c.value} type="button" onClick={() => onPick(c.value)} className="rounded-full border border-line bg-white px-2 py-0.5 hover:bg-slate-50" title={c.label} data-testid={`${testId}-chip`}>{c.value} <span className="text-ink-3">{c.source === 'description' ? SRC[c.source] : c.label.startsWith(SRC[c.source]) ? c.label : `${SRC[c.source]} ${c.label}`}</span></button>)}</div>;
}
function AddrChips({ value, onChange, testId, placeholder, warn, taskId }: { value: string; onChange: (v: string) => void; testId: string; placeholder?: string; warn?: boolean; taskId?: string | null }) {
  const [focus, setFocus] = useState(false);
  const [chips, setChips] = useState<string[]>(() => splitAddrs(value));
  const [draft, setDraft] = useState('');
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; setChips(splitAddrs(value)); setDraft(''); } }, [value]);
  const emit = (c: string[], d: string) => { const v = [...c, d.trim()].filter(Boolean).join(', '); last.current = v; onChange(v); };
  const commit = (text: string) => {
    const parts = text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...chips, ...parts.filter((p) => !chips.includes(p))]; setChips(next); setDraft(''); emit(next, '');
  };
  // V31 ② 회사 연락처·직원 자동 완성(이름·회사·이메일 일부)
  const sug = useRecipientSuggest(draft, 'email', taskId, focus && draft.trim().length >= 1);
  const pickSug = (s: { email: string | null }) => { if (!s.email) return; const next = chips.includes(s.email) ? chips : [...chips, s.email]; setChips(next); setDraft(''); emit(next, ''); };
  return (
    <div className={cx(inputCls, 'relative flex h-auto min-h-10 flex-wrap items-center gap-1 py-1', warn && 'border-amber-400 bg-amber-50/40')} data-testid={`${testId}-chips`}>
      {chips.map((c, i) => (
        <span key={c} className={cx('inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs', EMAIL_RE.test(c) ? 'bg-slate-100 text-ink' : 'bg-red-50 text-red-700 ring-1 ring-red-300')} data-testid="addr-chip" data-bad={EMAIL_RE.test(c) ? undefined : '1'} title={EMAIL_RE.test(c) ? c : '메일 주소 형식이 아닙니다'} onClick={(e) => e.preventDefault()}>
          <span className="truncate">{c}</span>
          <button type="button" className="text-ink-3 hover:text-ink" aria-label={`${c} 빼기`} onClick={() => { const next = chips.filter((_, k) => k !== i); setChips(next); emit(next, draft); }}>×</button>
        </span>
      ))}
      <input className="min-w-[8rem] flex-1 bg-transparent py-0.5 text-sm outline-none" value={draft} placeholder={chips.length ? '' : placeholder} data-testid={testId} inputMode="email" autoCapitalize="off" autoComplete="off"
        onFocus={() => setFocus(true)}
        onChange={(e) => { const v = e.target.value; if (/[\s,;]$/.test(v)) commit(v); else { setDraft(v); emit(chips, v); } }}
        onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { e.preventDefault(); commit(draft); } else if (e.key === 'Backspace' && !draft && chips.length) { const next = chips.slice(0, -1); setChips(next); emit(next, ''); } }}
        onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/[\s,;]/.test(t.trim())) { e.preventDefault(); commit(`${draft} ${t}`); } }}
        onBlur={() => { setTimeout(() => setFocus(false), 120); if (draft.trim()) commit(draft); }} />
      {focus && <SuggestList items={sug} kind="email" onPick={pickSug} testId={`${testId}-suggest`} />}
    </div>
  );
}
