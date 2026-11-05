'use client';
// 375차 #997(대표 11/06 "메일 보낸 것들만 따로 모아서 볼 수 있도록 사이드바에 만들어 주세요"): 보낸 메일 모아 보기
// 목록(보낸·예약 시각 · 받는 사람 · 제목 · 보낸 사람 · 방식 · 연결 업무 · 첨부 · 상태) · 거름(검색·기간·상태·종류) · 직원 = 내가 보낸 것, 대표·관리자 = 회사 전체·자동 메일 포함
// 줄을 누르면 본문·받는 사람 전체·첨부 · 실패면 [다시 보내기] · 예약이면 [예약 바꾸기·취소] · 업무 메일·문자는 [같은 내용으로 새로 쓰기]
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Paperclip, RefreshCw, Send } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Modal, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type Row = { id: string; kind: string; kindLabel: string; status: string; at: string; scheduledAt: string | null; to: string[]; toCount: number; subject: string | null; preview: string | null;
  sender: string; mine: boolean; via: string; files: number; asLink: boolean; task: { id: string; title: string } | null; error: string | null };
type List = { items: Row[]; more: boolean; offset: number; admin: boolean; scope: 'mine' | 'all'; system: boolean; kinds: { key: string; label: string }[] };
type Detail = { id: string; kind: string; kindLabel: string; status: string; via: string; to: string[]; cc: string[]; bcc: string[]; fromName: string | null; fromEmail: string | null; replyTo: string | null;
  subject: string | null; body: string; files: { name: string; size: number | null }[]; asLink: boolean; sender: string; sentAt: string | null; scheduledAt: string | null; createdAt: string; attempts: number;
  error: string | null; openedAt: string | null; task: { id: string; title: string } | null; can: { retry: boolean; reschedule: boolean; resend: boolean } };

const STATUS_LABEL: Record<string, [string, string]> = {
  sent: ['보냄', 'bg-emerald-50 text-emerald-700'], scheduled: ['예약', 'bg-sky-50 text-sky-700'], waiting: ['대기', 'bg-amber-50 text-amber-700'],
  failed: ['실패', 'bg-red-50 text-red-700'], canceled: ['취소됨', 'bg-slate-100 text-ink-2'],
};
const who = (to: string[], n: number) => (!to.length ? '—' : n > 1 ? `${to[0]} 외 ${n - 1}` : to[0]);
const kstLocal = (iso: string) => { const d = new Date(new Date(iso).getTime() + 9 * 3600_000); return d.toISOString().slice(0, 16); };

export default function SentMailPage() {
  const [f, setF] = useState({ q: '', from: '', to: '', status: '', kind: '', scope: 'mine', system: false });
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q })), 300); return () => clearTimeout(t); }, [q]);
  const qs = (offset = 0) => {
    const p = new URLSearchParams(); if (f.q) p.set('q', f.q); if (f.from) p.set('from', f.from); if (f.to) p.set('to', f.to); if (f.status) p.set('status', f.status); if (f.kind) p.set('kind', f.kind);
    if (f.scope === 'all') p.set('scope', 'all'); if (f.system) p.set('system', '1'); if (offset) p.set('offset', String(offset)); return p.toString();
  };
  const list = useApi<List>(`/api/mail/outbox?${qs()}`, [JSON.stringify(f)]);
  const [extra, setExtra] = useState<Row[]>([]); const [more, setMore] = useState<boolean | null>(null);
  useEffect(() => { setExtra([]); setMore(null); }, [list.data]);
  const rows = [...(list.data?.items ?? []), ...extra];
  async function loadMore() { try { const r = await api<List>(`/api/mail/outbox?${qs(rows.length)}`); setExtra((e) => [...e, ...r.items]); setMore(r.more); } catch (e: any) { toast.error(e.message); } }
  const [open, setOpen] = useState<string | null>(null);
  const admin = !!list.data?.admin;
  return (
    <div className="mx-auto max-w-5xl space-y-3" data-testid="sent-mail-page">
      <PageHeader title="보낸 메일" icon={Send} sub={f.scope === 'all' ? '회사 전체에서 보낸 메일·문자·견적' : '내가 보낸 메일·문자·견적'} />
      <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-white p-2.5 shadow-card" data-testid="sent-filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="받는 사람·제목·업무 이름" className={cx(inputCls, 'min-w-0 flex-1 basis-48')} data-testid="sent-q" aria-label="검색" />
        <label className="text-xs text-ink-2">부터<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className={cx(inputCls, 'block w-36')} data-testid="sent-from" /></label>
        <label className="text-xs text-ink-2">까지<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className={cx(inputCls, 'block w-36')} data-testid="sent-to" /></label>
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className={cx(inputCls, 'w-28')} aria-label="상태" data-testid="sent-status">
          <option value="">상태 전체</option>{Object.entries(STATUS_LABEL).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={cx(inputCls, 'w-32')} aria-label="종류" data-testid="sent-kind">
          <option value="">종류 전체</option>{(list.data?.kinds ?? []).filter((k) => k.key !== 'system' || f.system).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        {admin && (
          <div className="flex items-center gap-1" role="tablist" aria-label="범위">
            {[['mine', '내가 보낸 것'], ['all', '회사 전체']].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={f.scope === k} onClick={() => setF({ ...f, scope: k })} data-testid={`sent-scope-${k}`}
                className={cx('rounded-full border px-2.5 py-1 text-xs', f.scope === k ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line text-ink-2')}>{l}</button>
            ))}
            <label className="ml-1 flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" checked={f.system} onChange={(e) => setF({ ...f, system: e.target.checked, kind: !e.target.checked && f.kind === 'system' ? '' : f.kind })} data-testid="sent-system" />자동 메일 포함</label>
          </div>
        )}
      </div>
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Skeleton rows={6} />}
      {list.data && (
        <ul className="divide-y divide-line rounded-card border border-line bg-white shadow-card" data-testid="sent-list">
          {!rows.length && <li className="p-6 text-center text-sm text-ink-3">{f.q || f.from || f.to || f.status || f.kind ? '조건에 맞는 보낸 메일이 없습니다' : '아직 보낸 메일이 없습니다 — 업무 상세의 [메일·문자 보내기]로 보낸 것이 여기에 모입니다'}</li>}
          {rows.map((r) => {
            const [sl, st] = STATUS_LABEL[r.status] ?? [r.status, 'bg-slate-100 text-ink-2'];
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpen(r.id)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50" data-testid="sent-row" data-status={r.status} data-kind={r.kind}>
                  <div className="w-24 shrink-0 text-xs text-ink-2">{r.status === 'scheduled' ? <span className="text-sky-700">예약 {fmtDateTime(r.scheduledAt ?? r.at)}</span> : fmtDateTime(r.at)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span className={cx('rounded px-1.5 text-[11px] font-semibold', st)} data-testid="sent-status-badge">{sl}</span>
                      <span className="truncate font-medium">{r.subject || r.preview?.slice(0, 40) || '(제목 없음)'}</span>
                      {r.files > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-ink-2" aria-label={`첨부 ${r.files}개`}><Paperclip className="size-3" />{r.files}{r.asLink ? ' 링크' : ''}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-ink-3">
                      <span data-testid="sent-to-cell">받는 사람 {who(r.to, r.toCount)}</span>
                      <span>{r.kindLabel} · {r.via}</span>
                      {(f.scope === 'all' || !r.mine) && <span>보낸 사람 {r.sender}</span>}
                      {r.task && <span className="text-brand-700">업무: {r.task.title}</span>}
                    </div>
                    {r.error && <div className="mt-0.5 line-clamp-1 text-[11px] text-red-700">실패: {r.error}</div>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {(more ?? list.data?.more) && <div className="text-center"><Button variant="secondary" size="sm" onClick={loadMore} data-testid="sent-more">더 보기</Button></div>}
      {open && <SentDetail id={open} onClose={() => setOpen(null)} onChanged={() => list.reload()} />}
    </div>
  );
}

function SentDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const d = useApi<Detail>(`/api/mail/outbox/${id}`);
  const [at, setAt] = useState('');
  useEffect(() => { if (d.data?.scheduledAt) setAt(kstLocal(d.data.scheduledAt)); }, [d.data?.scheduledAt]);
  async function run(url: string, body: unknown, ok: string) { try { await api(url, { body }); toast.ok(ok); d.reload(); onChanged(); } catch (e: any) { toast.error(e.message); } }
  const x = d.data; const [sl, st] = x ? STATUS_LABEL[x.status] ?? [x.status, ''] : ['', ''];
  return (
    <Modal open onClose={onClose} title={x?.subject || '보낸 메일'} wide>
      {d.error && <ErrorBox error={d.error} retry={d.reload} />}
      {!x && !d.error && <Skeleton rows={4} />}
      {x && (
        <div className="space-y-3 text-sm" data-testid="sent-detail">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('rounded px-1.5 text-[11px] font-semibold', st)}>{sl}</span>
            <span className="text-xs text-ink-2">{x.kindLabel} · {x.via} · 보낸 사람 {x.sender}{x.fromName ? ` (${x.fromName})` : ''}</span>
          </div>
          <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 text-xs">
            <dt className="text-ink-3">받는 사람</dt><dd className="break-all" data-testid="sent-detail-to">{x.to.join(', ') || '—'}</dd>
            {x.cc.length > 0 && <><dt className="text-ink-3">참조</dt><dd className="break-all">{x.cc.join(', ')}</dd></>}
            {x.bcc.length > 0 && <><dt className="text-ink-3">숨은 참조</dt><dd className="break-all">{x.bcc.join(', ')}</dd></>}
            {x.replyTo && <><dt className="text-ink-3">회신 주소</dt><dd className="break-all">{x.replyTo}</dd></>}
            <dt className="text-ink-3">{x.status === 'scheduled' ? '예약 시각' : '보낸 시각'}</dt><dd>{fmtDateTime(x.status === 'scheduled' ? x.scheduledAt! : x.sentAt ?? x.createdAt)}</dd>
            {x.openedAt && <><dt className="text-ink-3">자료 열람</dt><dd>{fmtDateTime(x.openedAt)} 처음 열어 봄</dd></>}
            {x.task && <><dt className="text-ink-3">연결 업무</dt><dd><Link href={`/tasks/${x.task.id}`} className="text-brand-700 underline" data-testid="sent-detail-task">{x.task.title}</Link></dd></>}
          </dl>
          {x.files.length > 0 && (
            <div data-testid="sent-detail-files"><div className="text-xs font-semibold text-ink-2">첨부 {x.files.length}{x.asLink ? ' (크기가 커서 다운로드 링크로 보냄)' : ''}</div>
              <ul className="mt-1 space-y-0.5 text-xs">{x.files.map((f, i) => <li key={i} className="flex items-center gap-1"><Paperclip className="size-3 text-ink-3" />{f.name}{f.size ? ` · ${Math.max(1, Math.round(f.size / 1024))}KB` : ''}</li>)}</ul></div>
          )}
          {x.error && <div className="rounded-input bg-red-50 px-2.5 py-1.5 text-xs text-red-800" data-testid="sent-detail-error">실패 이유: {x.error}{x.attempts ? ` (시도 ${x.attempts}번)` : ''}</div>}
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-input border border-line bg-slate-50 p-2.5 font-sans text-[13px] leading-relaxed" data-testid="sent-detail-body">{x.body || '(본문 없음)'}</pre>
          <div className="flex flex-wrap items-center gap-2">
            {x.can.retry && <Button size="sm" onClick={() => run(`/api/mail/outbox/${x.id}/retry`, {}, '다시 보내기를 시작했습니다')} data-testid="sent-retry"><RefreshCw />다시 보내기</Button>}
            {x.can.reschedule && (
              <>
                <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={cx(inputCls, 'w-52')} aria-label="예약 시각" data-testid="sent-reschedule-at" />
                <Button size="sm" variant="secondary" disabled={!at} onClick={() => run(`/api/mail/outbox/${x.id}/schedule`, { sendAt: `${at}:00+09:00` }, '예약 시각을 바꿨습니다')} data-testid="sent-reschedule">예약 바꾸기</Button>
                <Button size="sm" variant="secondary" onClick={() => run(`/api/mail/outbox/${x.id}/schedule`, { cancel: true }, '예약을 취소했습니다')} data-testid="sent-cancel">예약 취소</Button>
              </>
            )}
            {x.can.resend && x.task && <Link href={`/tasks/${x.task.id}?resend=${x.id}`} data-full-task /* 업무 패널(?task=)로 가로채면 resend 가 빠짐 → 업무 화면 전체로 */ className="inline-flex items-center gap-1 rounded-input border border-line px-2.5 py-1 text-xs hover:bg-slate-50" data-testid="sent-resend">같은 내용으로 새로 쓰기</Link>}
            <Button size="sm" variant="secondary" onClick={() => { try { navigator.clipboard.writeText(x.body); toast.ok('본문을 복사했습니다'); } catch { toast.error('복사하지 못했습니다'); } }}>본문 복사</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
