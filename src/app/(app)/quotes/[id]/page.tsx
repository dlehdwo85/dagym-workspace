'use client';
// V19 2장: 견적서 한 장 — PDF 보기, 보내기는 사람이: (앱) 공유창 → "보내셨나요?" / (업무 연결) 메일 첨부 발송 / 문자 시안(14일 링크) → 휴대폰 문자앱 → [보냈어요]만 기록.
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { ArrowLeft, Download, Mail, MessageSquare, Share2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { shareServerFile } from '@/components/native';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type Q = { id: string; company_key: string; company_name: string; quote_no: string; to_name: string; to_contact: string | null; to_phone: string | null; to_email: string | null; items: { name: string; spec?: string; qty: number; unitPrice: number; amount: number }[];
  supply: string; vat: string; total: string; valid_until: string; note: string | null; task_id: string | null; task_title: string | null; file_id: string | null; status: string; sent_via: string | null; sent_to: string | null; sent_at: string | null; created_by_name: string; created_at: string };
const won = (n: number | string) => Number(n).toLocaleString('ko-KR');
const VIA: Record<string, string> = { share: '공유', mail: '메일', sms: '문자', download: '내려받기', kakao: '카카오톡' };

export default function QuotePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const st = useApi<{ quote: Q; canSend: boolean }>(`/api/quotes/${id}`);
  const [confirm, setConfirm] = useState<null | 'share' | 'download'>(null);
  const [mail, setMail] = useState(false);
  const [sms, setSms] = useState<null | { body: string; to: string; shareUrl: string | null }>(null);
  if (st.error) return <div className="p-4"><ErrorBox error={st.error} /></div>;
  if (!st.data) return <div className="p-4"><Skeleton rows={6} /></div>;
  const { quote: q, canSend } = st.data;
  const pdfPath = `/api/quotes/${id}/pdf`;
  const markSent = async (via: string, to?: string) => { try { await api(`/api/quotes/${id}/sent`, { body: { via, to } }); toast.ok('보낸 기록을 남겼습니다'); st.reload(); } catch (e: any) { toast.error(e.message); } };
  const share = async () => {
    try {
      const shared = await shareServerFile(`${pdfPath}?download=1`, `견적서 ${q.quote_no}`);
      if (shared) setConfirm('share');
      else { window.open(`${pdfPath}?download=1`, '_blank'); if (canSend) setConfirm('download'); }
    } catch (e: any) { toast.error(e.message); }
  };
  const smsDraft = async () => { try { setSms(await api(`/api/quotes/${id}/sms`, { body: {} })); } catch (e: any) { toast.error(e.message); } };
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-3 sm:p-4" data-testid="quote-page">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => router.push('/quotes')} className="inline-flex size-9 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="견적서 목록"><ArrowLeft className="size-5" /></button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold" data-testid="quote-title">{q.to_name} 귀하 · {q.quote_no}</h1>
          <p className="truncate text-xs text-ink-3">{q.company_name} · 합계 <b className="text-ink">{won(q.total)}원</b>(VAT 포함) · 유효 {q.valid_until} · {q.created_by_name} {fmtDateTime(q.created_at)}{q.task_id && <> · <Link href={`/tasks/${q.task_id}`} className="underline">업무: {q.task_title}</Link></>}</p>
        </div>
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', q.status === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-ink-2')} data-testid="quote-status">{q.status === 'sent' ? `보냄 · ${VIA[q.sent_via ?? ''] ?? q.sent_via}${q.sent_to ? ` → ${q.sent_to}` : ''} · ${fmtDateTime(q.sent_at!)}` : '초안(아직 안 보냄)'}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" onClick={share} data-testid="quote-share"><Share2 />{typeof navigator !== 'undefined' && /WorkInApp/.test(navigator.userAgent) ? '공유(카카오톡·문자…)' : 'PDF 내려받기'}</Button>
        <a href={`${pdfPath}?download=1`} className="inline-flex h-8 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-sm text-ink-2 hover:bg-slate-50" data-testid="quote-download"><Download className="size-4" />PDF</a>
        {canSend && q.task_id && <Button size="sm" variant="secondary" onClick={() => setMail(true)} data-testid="quote-mail"><Mail />메일로 보내기</Button>}
        {canSend && <Button size="sm" variant="secondary" onClick={smsDraft} data-testid="quote-sms"><MessageSquare />문자 시안</Button>}
        {!canSend && <span className="self-center text-xs text-ink-3">보내기는 외부 발송 권한(기본 대표)이 있어야 합니다 — PDF 는 내려받을 수 있습니다</span>}
      </div>
      {!q.task_id && canSend && <p className="text-xs text-ink-3">업무에 연결되지 않은 견적서라 메일 첨부 발송·문자 링크는 쓸 수 없습니다. PDF 를 내려받아(또는 앱에서 공유) 보내 주세요.</p>}
      <iframe src={pdfPath} title="견적서 PDF" className="h-[75vh] w-full rounded-card border border-line bg-white" data-testid="quote-pdf" />
      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title="견적서를 보내셨나요?">
          <p className="text-sm text-ink-2">{confirm === 'share' ? '공유창에서 카카오톡·문자 등으로 보냈으면 [보냈어요]를 눌러 기록을 남깁니다.' : '내려받은 PDF 를 보냈으면 [보냈어요]를 눌러 기록을 남깁니다.'}</p>
          <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirm(null)}>안 보냄</Button><Button onClick={() => { void markSent(confirm); setConfirm(null); }} data-testid="quote-sent-yes">보냈어요</Button></div>
        </Modal>
      )}
      {mail && <MailModal id={id} q={q} onClose={() => setMail(false)} onSent={() => { setMail(false); st.reload(); }} />}
      {sms && <SmsModal q={q} sms={sms} onClose={() => setSms(null)} onSent={async () => { if (q.task_id) await api('/api/mail/sms-log', { body: { taskId: q.task_id, to: sms.to.split(/[,;\s]+/).filter(Boolean), body: sms.body, shareUrl: sms.shareUrl ?? undefined } }).catch(() => null); await markSent('sms', sms.to); setSms(null); }} />}
    </div>
  );
}

function MailModal({ id, q, onClose, onSent }: { id: string; q: Q; onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState(q.to_email ?? '');
  const [subject, setSubject] = useState(`[${q.company_name}] 견적서 ${q.quote_no} — ${q.to_name}`);
  const [body, setBody] = useState(`안녕하세요, ${q.company_name}입니다.\n요청하신 견적서(${q.quote_no})를 첨부해 드립니다.\n합계 ${won(q.total)}원(부가세 포함), 유효기간은 ${q.valid_until} 까지입니다.\n확인 부탁드립니다.`);
  const [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); try { await api(`/api/quotes/${id}/mail`, { body: { to: to.trim(), subject, body } }); toast.ok('보관함에 넣었습니다 — 곧 발송됩니다(PDF 첨부)'); onSent(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  return (
    <Modal open onClose={onClose} title="견적서 메일로 보내기 (PDF 첨부)">
      <div className="space-y-2">
        <Field label="받는 사람"><input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" aria-label="받는 사람" data-testid="quote-mail-to" /></Field>
        <Field label="제목"><input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="제목" /></Field>
        <Field label="내용"><textarea className={cx(inputCls, 'min-h-32')} value={body} onChange={(e) => setBody(e.target.value)} aria-label="내용" /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={send} disabled={busy || !to.trim()} data-testid="quote-mail-send">보내기</Button></div>
      </div>
    </Modal>
  );
}

function SmsModal({ q, sms, onClose, onSent }: { q: Q; sms: { body: string; to: string; shareUrl: string | null }; onClose: () => void; onSent: () => Promise<void> }) {
  const [to, setTo] = useState(sms.to);
  const [body, setBody] = useState(sms.body);
  const [opened, setOpened] = useState<{ url: string; qr: string | null } | null>(null);
  const open = async () => {
    const nums = to.split(/[,;\s]+/).map((x) => x.replace(/[^0-9+]/g, '')).filter(Boolean);
    if (!nums.length) { toast.error('받는 번호를 넣어 주세요'); return; }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const url = `sms:${nums.join(',')}${ios ? '&' : '?'}body=${encodeURIComponent(body)}`;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const qr = touch ? null : await QRCode.toDataURL(`sms:${nums.join(',')}?body=${encodeURIComponent(body)}`, { margin: 1, width: 200 }).catch(() => null);
    setOpened({ url, qr }); if (touch) window.location.href = url;
  };
  return (
    <Modal open onClose={onClose} title={`문자 시안 — 견적서 ${q.quote_no}`}>
      <div className="space-y-2" data-testid="quote-sms-modal">
        <Field label="받는 번호"><input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} placeholder="010-0000-0000" aria-label="받는 번호" data-testid="quote-sms-to" /></Field>
        <Field label="내용" hint={sms.shareUrl ? '견적서 보기 링크(14일)가 들어 있습니다' : '업무에 연결되지 않아 링크 없이 보냅니다 — PDF 는 따로 전달'}><textarea className={cx(inputCls, 'min-h-28')} value={body} onChange={(e) => setBody(e.target.value)} aria-label="문자 내용" data-testid="quote-sms-body" /></Field>
        <p className="text-[11px] text-ink-3">내 휴대폰 번호로 발송됩니다. [보냈어요]를 눌러야 기록이 남습니다.</p>
        {opened ? (
          <div className="space-y-2">
            {opened.qr && <div className="flex items-center gap-2 rounded bg-slate-50 p-2 text-xs text-ink-2"><img src={opened.qr} alt="문자 QR" className="size-24" /><span>휴대폰 카메라로 QR 을 찍으면 문자앱이 열립니다. 또는 <a href={opened.url} className="underline">문자앱 열기</a></span></div>}
            <div className="text-sm font-medium">문자를 보내셨나요?</div>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>안 보냄</Button><Button onClick={() => onSent()} data-testid="quote-sms-sent">보냈어요</Button></div>
          </div>
        ) : <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={open} data-testid="quote-sms-open"><MessageSquare />문자 보내기</Button></div>}
      </div>
    </Modal>
  );
}
