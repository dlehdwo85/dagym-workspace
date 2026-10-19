'use client';
// V19: AI 비서 제안 카드 — 문자 시안(draft_sms)·견적서 시안(draft_quote)은 일반 [확인]이 아니라 "사람이 보내기" 흐름:
// 문자 = 받는 번호·본문 고치기 → 휴대폰 문자앱(sms:) / PC 는 QR → "보내셨나요?" [보냈어요]일 때만 기록. 견적서 = 표·합계·[PDF 미리보기] → [견적서 만들기](자료실 PDF·업무 첨부) → 견적서 화면에서 보내기.
// AI 는 초안만 만들고, 발송은 언제나 사람이 누른다(docs/handoff/WORKIN_V19_SEND.md 원칙).
import { useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { Check, FileText, MessageSquare, X } from 'lucide-react';
import { SuggestInput } from './contacts/RecipientSuggest';
import { api } from './client';
import { Button, Modal, cx, inputCls, toast } from './ui';

export type ProposalLike = { id: string; kind?: string; summary: string; state?: 'done' | 'cancelled' | 'busy'; link?: string;
  preview?: { warnings?: string[]; moves?: string[]; folder?: string; sms?: { to: string[]; body: string; bytes: number; long: boolean; taskTitle?: string }; quote?: QuotePreview } & Record<string, any> };
export type QuotePreview = { company: string; companyName: string; to: { name: string; contact?: string; phone?: string; email?: string }; items: { name: string; spec?: string; qty: number; unitPrice: number; amount: number }[]; supply: number; vat: number; total: number; validUntil: string; overflow: boolean; template?: string | null };

export const smsBytes = (s: string) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
const won = (n: number) => n.toLocaleString('ko-KR');

/** 문자·견적서 시안이면 전용 카드, 아니면 null(호출한 쪽이 기본 [확인]/[취소]를 그린다) */
export function SpecialProposal({ p, onDecided }: { p: ProposalLike; onDecided: (accept: boolean, patch?: Record<string, unknown>) => Promise<void> }) {
  const pv = restorePreview(p);
  if (p.kind === 'draft_sms' && pv?.sms) return <SmsDraft p={p} sms={pv.sms} onDecided={onDecided} />;
  if (p.kind === 'draft_quote' && pv?.quote) return <QuoteDraft p={p} q={pv.quote} onDecided={onDecided} />;
  return <div className="mt-1.5 rounded-input border border-amber-200 bg-white p-2 text-sm text-ink">{p.summary}{p.state === 'done' && <span className="ml-1 text-xs text-green-700">✓ 반영됨 {p.link && <Link href={p.link} className="underline">열기</Link>}</span>}</div>;
}
/** 보관된 대화를 다시 열면 preview 대신 payload 가 오므로 카드 모양으로 되돌린다 */
function restorePreview(p: ProposalLike): ProposalLike['preview'] {
  const v: any = p.preview ?? {};
  if (p.kind === 'draft_sms' && !v.sms && typeof v.body === 'string') return { ...v, sms: { to: Array.isArray(v.to) ? v.to : [], body: v.body, bytes: smsBytes(v.body), long: smsBytes(v.body) > 90 } };
  if (p.kind === 'draft_quote' && !v.quote && Array.isArray(v.items)) return { ...v, quote: { company: v.company, companyName: v.companyName ?? v.company, to: v.to ?? { name: '' }, items: v.items, supply: v.supply ?? 0, vat: v.vat ?? 0, total: v.total ?? 0, validUntil: v.validUntil ?? '', overflow: false, template: null } };
  return p.preview;
}

function SmsDraft({ p, sms, onDecided }: { p: ProposalLike; sms: NonNullable<ProposalLike['preview']>['sms'] & {}; onDecided: (accept: boolean, patch?: Record<string, unknown>) => Promise<void> }) {
  const [to, setTo] = useState(sms.to.join(', '));
  const [body, setBody] = useState(sms.body);
  const [opened, setOpened] = useState<{ url: string; qr: string | null } | null>(null);
  const bytes = smsBytes(body);
  const done = p.state === 'done', cancelled = p.state === 'cancelled';
  async function open() {
    const nums = to.split(/[,;\s]+/).map((x) => x.replace(/[^0-9+]/g, '')).filter(Boolean);
    if (!nums.length) { toast.error('받는 사람 전화번호를 넣어 주세요 (AI 는 번호를 지어내지 않습니다)'); return; }
    if (!body.trim()) { toast.error('문자 내용을 넣어 주세요'); return; }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const url = `sms:${nums.join(',')}${ios ? '&' : '?'}body=${encodeURIComponent(body)}`;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const qr = touch ? null : await QRCode.toDataURL(`sms:${nums.join(',')}?body=${encodeURIComponent(body)}`, { margin: 1, width: 200 }).catch(() => null);
    setOpened({ url, qr });
    if (touch) window.location.href = url;
  }
  const sent = async (yes: boolean) => {
    if (!yes) { setOpened(null); return; }
    await onDecided(true, { to: to.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean), body });
    setOpened(null);
  };
  return (
    <div className="mt-1.5 rounded-input border border-sky-200 bg-white p-2 text-ink" data-testid="ai-sms-draft">
      <div className="flex items-center gap-1 text-xs font-semibold text-sky-700"><MessageSquare className="size-3.5" />문자 시안 — AI 는 초안만, 보내기는 내 휴대폰 문자앱에서</div>
      {sms.taskTitle && <div className="text-xs text-ink-3">업무: {sms.taskTitle}</div>}
      {done ? <div className="mt-1 text-sm">{body}</div> : <>
        <label className="mt-1 block text-[11px] text-ink-3">받는 번호(쉼표로 여러 명)
          <SuggestInput className="mt-0.5 py-1 text-sm" value={to} onChange={setTo} kind="phone" multi placeholder="010-0000-0000 · 이름을 치면 회사 연락처에서" disabled={cancelled} ariaLabel="문자 받는 번호" testId="ai-sms-to" /></label>
        <label className="mt-1 block text-[11px] text-ink-3">내용 <span className={cx('tabular-nums', bytes > 90 ? 'text-amber-700' : '')}>{bytes}바이트{bytes > 90 ? ' · 장문(LMS)' : ''}</span>
          <textarea className={cx(inputCls, 'mt-0.5 min-h-20 py-1 text-sm')} value={body} onChange={(e) => setBody(e.target.value)} disabled={cancelled} aria-label="문자 내용" data-testid="ai-sms-body" /></label>
      </>}
      {!!p.preview?.warnings?.length && <ul className="mt-1 rounded bg-amber-50 p-1.5 text-xs text-amber-800">{p.preview.warnings.map((w, k) => <li key={k}>⚠ {w}</li>)}</ul>}
      <p className="mt-1 text-[11px] text-ink-3">내 휴대폰 번호로 발송됩니다. [보냈어요]를 눌러야 업무·고객 기록에 남습니다.</p>
      {done ? <div className="mt-1 text-xs text-green-700">✓ 보낸 기록 남김 {p.link && <Link href={p.link} className="underline">열기</Link>}</div>
        : cancelled ? <div className="mt-1 text-xs text-ink-3">보내지 않음</div>
        : opened ? (
          <div className="mt-1.5 space-y-1.5" data-testid="ai-sms-confirm">
            {opened.qr && <div className="flex items-center gap-2 rounded bg-slate-50 p-2 text-xs text-ink-2"><img src={opened.qr} alt="문자 QR" className="size-24" /><span>PC 에는 문자앱이 없습니다. 휴대폰 카메라로 QR 을 찍으면 문자앱이 열립니다. 또는 <a href={opened.url} className="underline">문자앱 열기</a></span></div>}
            <div className="text-sm font-medium">문자를 보내셨나요?</div>
            <div className="flex gap-1.5"><Button size="sm" onClick={() => sent(true)} disabled={p.state === 'busy'} data-testid="ai-sms-sent"><Check />보냈어요</Button><Button size="sm" variant="secondary" onClick={() => sent(false)}>안 보냄</Button></div>
          </div>
        ) : (
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" onClick={open} disabled={p.state === 'busy'} data-testid="ai-sms-open"><MessageSquare />문자 보내기</Button>
            <Button size="sm" variant="secondary" onClick={() => onDecided(false)} disabled={p.state === 'busy'}><X />취소</Button>
          </div>
        )}
    </div>
  );
}

function QuoteDraft({ p, q, onDecided }: { p: ProposalLike; q: QuotePreview; onDecided: (accept: boolean, patch?: Record<string, unknown>) => Promise<void> }) {
  const [pdf, setPdf] = useState(false);
  const done = p.state === 'done', cancelled = p.state === 'cancelled';
  return (
    <div className="mt-1.5 rounded-input border border-emerald-200 bg-white p-2 text-ink" data-testid="ai-quote-draft">
      <div className="flex items-center gap-1 text-xs font-semibold text-emerald-700"><FileText className="size-3.5" />견적서 시안 — {q.companyName}{q.template ? ` · 양식 ${q.template}` : ' · 기본 양식'}</div>
      <div className="mt-1 text-sm"><b>{q.to.name}</b> 귀하{q.to.contact ? ` · ${q.to.contact}` : ''}{q.to.phone || q.to.email ? ` · ${[q.to.phone, q.to.email].filter(Boolean).join(' · ')}` : ''}</div>
      <table className="mt-1 w-full text-xs" data-testid="ai-quote-items">
        <thead><tr className="text-ink-3"><th className="text-left font-medium">품목</th><th className="text-right font-medium">수량</th><th className="text-right font-medium">단가</th><th className="text-right font-medium">공급가액</th></tr></thead>
        <tbody>{q.items.slice(0, 12).map((it, i) => <tr key={i}><td className="truncate pr-1">{it.name}{it.spec ? <span className="text-ink-3"> {it.spec}</span> : null}</td><td className="text-right tabular-nums">{won(it.qty)}</td><td className="text-right tabular-nums">{won(it.unitPrice)}</td><td className="text-right tabular-nums">{won(it.amount)}</td></tr>)}
          {q.items.length > 12 && <tr><td colSpan={4} className="text-ink-3">외 {q.items.length - 12}개</td></tr>}</tbody>
      </table>
      <div className="mt-1 text-right text-xs text-ink-2">공급가액 {won(q.supply)} · 부가세 {won(q.vat)} · <b className="text-sm text-ink">합계 {won(q.total)}원</b> (VAT 포함) · 유효 {q.validUntil}</div>
      {q.overflow && <div className="mt-1 rounded bg-red-50 p-1.5 text-xs text-red-700" data-testid="ai-quote-overflow">⚠ 1페이지 초과 — 품목을 묶어 주세요 (A4 한 장 고정, 2페이지로 넘기지 않습니다)</div>}
      {!!p.preview?.warnings?.length && <ul className="mt-1 rounded bg-amber-50 p-1.5 text-xs text-amber-800">{p.preview.warnings.map((w, k) => <li key={k}>⚠ {w}</li>)}</ul>}
      <p className="mt-1 text-[11px] text-ink-3">금액은 서버가 다시 계산했습니다. [견적서 만들기]를 누르면 PDF 가 자료실 &ldquo;견적서&rdquo; 폴더에 저장되고(업무가 있으면 첨부) 견적서 화면에서 공유·메일·문자로 보냅니다.</p>
      {done ? <div className="mt-1 text-xs text-green-700">✓ 견적서 만들었습니다 {p.link && <Link href={p.link} className="font-semibold underline" data-testid="ai-quote-open">열기 · 보내기</Link>}</div>
        : cancelled ? <div className="mt-1 text-xs text-ink-3">취소함</div> : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => onDecided(true)} disabled={p.state === 'busy' || q.overflow} data-testid="ai-quote-create"><Check />견적서 만들기</Button>
            {!q.overflow && <Button size="sm" variant="secondary" onClick={() => setPdf(true)} data-testid="ai-quote-preview"><FileText />PDF 미리보기</Button>}
            <Button size="sm" variant="secondary" onClick={() => onDecided(false)} disabled={p.state === 'busy'}><X />취소</Button>
          </div>
        )}
      {pdf && <Modal open onClose={() => setPdf(false)} title={`견적서 미리보기 — ${q.to.name}`} wide><iframe src={`/api/ai/proposals/${p.id}/quote-pdf`} title="견적서 미리보기" className="h-[70vh] w-full rounded-input border border-line" /></Modal>}
    </div>
  );
}
