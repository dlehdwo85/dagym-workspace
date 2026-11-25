'use client';
import { useState } from 'react';
import { api, useApi } from '../client';
import { Button, cx, fmtDateTime, inputCls, toast } from '../ui';

type Item = { id: string; tenant: string | null; tenant_name: string | null; test_company: boolean; source: string; title: string; body: string | null; category: string | null; status: string; owner_name: string | null; reply: string | null; created_at: string; companies: number; grouped: number };
type Data = { items: Item[]; testHidden: number; counts: Record<string, number>; labels: { category: Record<string, string>; status: Record<string, string>; source: Record<string, string> } };

/** #1175 고객 요청함(설계 COMMERCIAL_DESIGN_2026-11-26 C): 앱 문의·상담 신청 자동 + 운영자 메모·메일 — 분류·상태·답변 기록·같은 요청 묶기(요청 회사 n곳) */
export function CustomerRequests() {
  const [status, setStatus] = useState(''); const [withTest, setWithTest] = useState(false); // 로컬 11/26: 시험 회사 요청은 기본으로 숨김
  const qs = [status && `status=${status}`, withTest && 'test=1'].filter(Boolean).join('&');
  const { data, reload } = useApi<Data>(`/api/platform/customer-requests${qs ? `?${qs}` : ''}`, [status, withTest]);
  const [add, setAdd] = useState({ title: '', body: '', source: 'memo' }); const [open, setOpen] = useState<string | null>(null); const [reply, setReply] = useState(''); const [groupTo, setGroupTo] = useState('');
  if (!data) return null;
  const patch = async (id: string, body: Record<string, unknown>, ok: string) => { try { await api(`/api/platform/customer-requests/${id}`, { method: 'PATCH', body }); toast.ok(ok); reload(); } catch (e: any) { toast.error(e.message); } };
  const L = data.labels;
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="customer-requests">
      <h2 className="text-sm font-semibold">고객 요청함 <span className="text-xs font-normal text-ink-3">앱 문의·상담 신청은 자동으로 모입니다 · 같은 요청은 묶어 ‘요청 회사 n곳’으로 · 맞춤 개발은 ‘견적 후 진행’(금액은 쓰지 않음)</span></h2>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {[['', '진행 중'], ...Object.entries(L.status)].map(([k, v]) => (
          <button key={k || 'open'} type="button" onClick={() => setStatus(k)} className={cx('rounded-full border px-2.5 py-1', status === k ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-line')} data-testid={`req-filter-${k || 'open'}`}>{v}{k && data.counts[k] ? ` ${data.counts[k]}` : ''}</button>))}
        {(withTest || data.testHidden > 0) && <button type="button" onClick={() => setWithTest(!withTest)} className={cx('rounded-full border px-2.5 py-1', withTest ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-line text-ink-3')} data-testid="req-filter-test">{withTest ? '시험 회사 빼기' : `시험 회사 포함 ${data.testHidden}`}</button>}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_auto]" data-testid="req-add">
        <select className={cx(inputCls, 'h-9')} value={add.source} onChange={(e) => setAdd({ ...add, source: e.target.value })}><option value="memo">운영자 메모</option><option value="mail">메일</option></select>
        <input className={cx(inputCls, 'h-9')} value={add.title} onChange={(e) => setAdd({ ...add, title: e.target.value })} placeholder="요청 한 줄(예: 업무에 거래처 칸 추가)" data-testid="req-add-title" />
        <input className={cx(inputCls, 'h-9')} value={add.body} onChange={(e) => setAdd({ ...add, body: e.target.value })} placeholder="자세히(선택)" />
        <Button size="sm" disabled={add.title.trim().length < 2} onClick={async () => { try { await api('/api/platform/customer-requests', { body: { source: add.source, title: add.title.trim(), body: add.body.trim() || undefined } }); setAdd({ title: '', body: '', source: add.source }); toast.ok('넣었습니다'); reload(); } catch (e: any) { toast.error(e.message); } }} data-testid="req-add-go">넣기</Button>
      </div>
      {!data.items.length ? <p className="mt-2 text-xs text-ink-3">해당 요청이 없습니다.</p> : (
        <ul className="mt-2 divide-y divide-line text-sm">{data.items.map((r) => (
          <li key={r.id} className="py-2" data-testid="req-row">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{L.source[r.source] ?? r.source}</span>
              <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => { setOpen(open === r.id ? null : r.id); setReply(r.reply ?? ''); }}>{r.title}</button>
              {r.test_company && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800" data-testid="req-test">시험 회사</span>}
              {r.companies > 1 && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800" data-testid="req-companies">요청 회사 {r.companies}곳</span>}
              <span className="text-xs text-ink-3">{r.tenant_name ?? '회사 미정'} · {fmtDateTime(r.created_at)}</span>
              <div className="flex shrink-0 gap-1.5">
                <div className="w-44"><select className={cx(inputCls, 'h-8 py-0 text-xs')} value={r.category ?? ''} onChange={(e) => patch(r.id, { category: e.target.value || null }, '분류를 바꿨습니다')} aria-label="분류" data-testid="req-category"><option value="">분류 전</option>{Object.entries(L.category).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div className="w-24"><select className={cx(inputCls, 'h-8 py-0 text-xs')} value={r.status} onChange={(e) => patch(r.id, { status: e.target.value }, '상태를 바꿨습니다')} aria-label="상태" data-testid="req-status">{Object.entries(L.status).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              </div>
            </div>
            {open === r.id && (
              <div className="mt-2 space-y-2 rounded-input bg-slate-50 p-2 text-xs" data-testid="req-detail">
                {r.body && <p className="whitespace-pre-wrap text-ink-2">{r.body}</p>}
                <div className="flex flex-wrap items-end gap-2">
                  <textarea className={cx(inputCls, 'min-h-[60px] flex-1 text-xs')} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="고객에게 한 답변(기록)" data-testid="req-reply" />
                  <Button size="sm" variant="secondary" disabled={!reply.trim()} onClick={() => patch(r.id, { reply: reply.trim() }, '답변을 기록했습니다')} data-testid="req-reply-save">답변 기록</Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-full max-w-xs"><select className={cx(inputCls, 'h-8 py-0 text-xs')} value={groupTo} onChange={(e) => setGroupTo(e.target.value)} aria-label="같은 요청 고르기" data-testid="req-group-to"><option value="">같은 요청 고르기</option>{data.items.filter((x) => x.id !== r.id).map((x) => <option key={x.id} value={x.id}>{x.title.slice(0, 40)}</option>)}</select></div>
                  <Button size="sm" variant="secondary" disabled={!groupTo} onClick={() => { void patch(r.id, { groupInto: groupTo }, '같은 요청으로 묶었습니다'); setGroupTo(''); setOpen(null); }} data-testid="req-group-go">이 요청에 묶기</Button>
                  {r.reply && <span className="text-ink-3">답변 기록 있음</span>}
                </div>
              </div>
            )}
          </li>))}</ul>
      )}
    </section>
  );
}
