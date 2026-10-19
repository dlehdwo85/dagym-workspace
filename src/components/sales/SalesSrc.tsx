'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

/** V41 단계 2 영업 공간 화면(V39 B) — 옮긴 영업관리 원본, 전환일까지 읽기 전용(고치는 것은 영업관리에서, 매일 다시 가져옴) */
const C = '#2563EB';
const q = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
function Head({ title, meta, children }: { title: string; meta?: { syncedAt: string | null; imported: boolean; readOnly?: boolean }; children?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold" style={{ color: C }}>{title}</h1><span className="ml-auto flex flex-wrap gap-2">{children}</span></div>
      {meta && meta.readOnly === false ? <p className="text-[11px] text-ink-3" data-testid="sales-live">영업관리에서 옮긴 자료 · 이제 워크인에서 고칩니다(영업관리는 보기 전용)</p> : meta && <p className="text-[11px] text-ink-3" data-testid="sales-readonly">{meta.imported ? `영업관리에서 옮긴 자료 · ${meta.syncedAt ? fmtDateTime(meta.syncedAt) : ''} 기준 · 전환일까지 읽기 전용(고치는 것은 영업관리에서, 매일 다시 가져옴)` : '아직 영업관리 자료를 옮기지 않았습니다(플랫폼 운영 › 영업관리 이전).'}</p>}
    </div>
  );
}
function Search({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input className={cx(inputCls, 'h-8 w-48 py-1 text-sm')} value={value} onChange={(e) => onChange(e.target.value)} placeholder="찾기" aria-label="찾기" />;
}
function Raw({ row }: { row: any }) {
  return <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 text-xs">{Object.entries(row ?? {}).filter(([k]) => k !== '__id').flatMap(([k, v]) => [<dt key={k} className="truncate font-mono text-ink-3">{k}</dt>, <dd key={k + ':v'} className="break-all">{v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>])}</dl>;
}
const chip = (s: unknown) => s ? <span className="rounded-full bg-[#EFF6FF] px-1.5 text-[11px] text-[#1D4ED8]">{String(s)}</span> : null;

export function SalesHome() {
  const { data, error, reload } = useApi<any>('/api/sales/src?view=summary');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  const k = data.kpi;
  const cards: [string, number, string][] = [['리드', k.leads, '/s/sales/leads'], ['7일 안 연락', k.dueSoon, '/s/sales/leads'], ['연락 지남', k.overdue, '/s/sales/leads'], ['진행 중 입찰', k.bidsWorking, '/s/sales/bids?tab=working'], ['관련 공고', k.relatedNotices, '/s/sales/bids'], ['새 공고(7일)', k.newNotices7d, '/s/sales/bids']];
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="space-home-sales">
      <Head title="워크인 · 영업" meta={data} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{cards.map(([l, n, h]) => (
        <Link key={l} href={h} className="rounded-card border border-line bg-white p-3 shadow-card hover:border-blue-300" data-testid="sales-kpi"><div className="text-xs text-ink-2">{l}</div><div className={cx('mt-1 text-2xl font-bold tabular-nums', l === '연락 지남' && n ? 'text-red-600' : '')} style={l === '연락 지남' && n ? undefined : { color: C }}>{n}</div></Link>))}</div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-white p-3 shadow-card"><h2 className="mb-2 text-sm font-semibold">다가오는 연락</h2>
          <ul className="divide-y divide-line text-sm">{data.due.map((l: any) => <li key={l.id} className="flex items-center gap-2 py-1.5"><Link href={`/s/sales/leads?id=${encodeURIComponent(l.id)}`} className="min-w-0 flex-1 truncate hover:underline">{l.name}</Link>{chip(l.status)}<span className={cx('text-xs tabular-nums', l.next < new Date().toISOString().slice(0, 10) ? 'font-semibold text-red-600' : 'text-ink-2')}>{l.next}</span></li>)}
            {!data.due.length && <li className="py-2 text-xs text-ink-3">오늘부터 7일 안에 연락할 리드가 없습니다</li>}</ul></section>
        {!!data.overdueList?.length && <section className="rounded-card border border-red-200 bg-white p-3 shadow-card" data-testid="sales-overdue"><h2 className="mb-2 text-sm font-semibold text-red-700">연락 지남 <span className="font-normal text-ink-3">{data.kpi.overdue}</span></h2>
          <ul className="divide-y divide-line text-sm">{data.overdueList.map((l: any) => <li key={l.id} className="flex items-center gap-2 py-1.5"><Link href={`/s/sales/leads?id=${encodeURIComponent(l.id)}`} className="min-w-0 flex-1 truncate hover:underline">{l.name}</Link>{chip(l.status)}<span className="text-xs tabular-nums text-red-600">{l.next}</span></li>)}</ul></section>}
        <section className="rounded-card border border-line bg-white p-3 shadow-card"><h2 className="mb-2 text-sm font-semibold">단계 분포</h2>
          <ul className="space-y-1 text-sm">{data.statuses.map(([s, n]: [string, number]) => <li key={s} className="flex items-center gap-2"><span className="w-24 truncate text-xs">{s}</span><span className="h-2 rounded-full" style={{ width: `${Math.max(4, (n / Math.max(1, data.kpi.leads)) * 100)}%`, background: C }} /><span className="text-xs tabular-nums">{n}</span></li>)}</ul></section>
      </div>
    </div>
  );
}

/** 전환 뒤: 단계(보류·실패는 사유 필수)·다음 연락일·메모·담당(관리자) 고치기 + 상담 기록 추가 */
function LeadEdit({ id, data, onSaved }: { id: string; data: any; onSaved: () => void }) {
  const l = data.lead;
  const [f, setF] = useState({ status: l.status ?? '신규리드', reason: '', next: l.next ?? '', memo: l.memo ?? '', owner: l.ownerId ?? '' });
  const [act, setAct] = useState({ type: '전화', content: '' });
  const needReason = (f.status === '보류' || f.status === '실패') && f.status !== l.status;
  async function save() {
    try { await api(`/api/sales/leads/${id}`, { method: 'PATCH', body: { ...(f.status !== l.status ? { status: f.status, reason: f.reason || undefined } : {}), nextContactDate: f.next || null, memo: f.memo || null, ...(data.canAssign && f.owner !== (l.ownerId ?? '') ? { ownerId: f.owner || null } : {}) } });
      toast.ok('저장했습니다'); setF({ ...f, reason: '' }); onSaved(); } catch (e: any) { toast.error(e.message); }
  }
  async function addAct() { try { await api(`/api/sales/leads/${id}/activities`, { body: act }); setAct({ ...act, content: '' }); toast.ok('상담 기록을 남겼습니다'); onSaved(); } catch (e: any) { toast.error(e.message); } }
  return (
    <div className="space-y-2 rounded-input border border-blue-200 bg-blue-50/40 p-3 text-sm" data-testid="sales-lead-edit">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="단계"><select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="단계" data-testid="lead-status">{data.stages.map((s: string) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="다음 연락일"><input type="date" className={inputCls} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} aria-label="다음 연락일" data-testid="lead-next" /></Field>
        {data.canAssign && <Field label="담당"><select className={inputCls} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} aria-label="담당"><option value="">없음</option>{data.people.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
      </div>
      {needReason && <Field label={`${f.status} 사유(필수)`}><input className={inputCls} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={500} aria-label="사유" data-testid="lead-reason" /></Field>}
      <Field label="메모"><textarea className={inputCls} rows={2} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} maxLength={5000} aria-label="메모" /></Field>
      <div className="flex justify-end"><Button size="sm" onClick={save} disabled={needReason && !f.reason.trim()} data-testid="lead-save">저장</Button></div>
      <div className="flex flex-wrap items-end gap-2 border-t border-blue-100 pt-2">
        <select className={cx(inputCls, 'h-8 w-24 py-1')} value={act.type} onChange={(e) => setAct({ ...act, type: e.target.value })} aria-label="상담 종류">{['전화', '방문', '미팅', '메일', '문자', '기타'].map((x) => <option key={x}>{x}</option>)}</select>
        <input className={cx(inputCls, 'h-8 min-w-0 flex-1 py-1')} value={act.content} onChange={(e) => setAct({ ...act, content: e.target.value })} placeholder="상담 내용" aria-label="상담 내용" data-testid="lead-act" />
        <Button size="sm" variant="secondary" onClick={addAct} disabled={!act.content.trim()} data-testid="lead-act-add">상담 기록</Button>
      </div>
      {!!data.statusLog?.length && <ul className="space-y-0.5 text-[11px] text-ink-2">{data.statusLog.map((g: any, i: number) => <li key={i}>{fmtDateTime(g.changed_at)} · {g.by ?? ''} · {g.from_status ?? '—'} → {g.to_status}{g.reason ? ` (${g.reason})` : ''}</li>)}</ul>}
    </div>
  );
}

function LeadDetail({ id, onClose, onChange }: { id: string; onClose: () => void; onChange?: () => void }) {
  const { data, error, reload } = useApi<any>(`/api/sales/src?view=lead&id=${encodeURIComponent(id)}`);
  const [tab, setTab] = useState('info');
  const tabs: [string, string, any[] | null][] = data ? [['info', '정보', null], ['acts', `상담 ${data.activities.length}`, data.activities], ['timing', `시점 ${data.timing.length}`, data.timing], ['tasks', `업무 ${data.tasks.length}`, data.tasks],
    ['props', `제안 ${data.proposals.length}`, data.proposals], ['cons', `계약 ${data.contracts.length}`, data.contracts], ['work', `입찰 ${data.work.length}`, data.work], ['int', `관심사업 ${data.interests.length}`, data.interests]] : [];
  return (
    <Modal open onClose={onClose} title={data?.lead.name ?? '리드'} wide>
      {error ? <ErrorBox error={error} /> : !data ? <Skeleton rows={4} /> : (
        <div className="space-y-3" data-testid="sales-lead-detail">
          <div className="flex flex-wrap gap-1.5 text-xs">{chip(data.lead.status)}{chip(data.lead.priority)}{chip(data.lead.facility)}{chip(data.lead.region)}{data.lead.owner && <span className="text-ink-2">담당 {data.lead.owner}</span>}{data.lead.next && <span className="text-ink-2">다음 연락 {data.lead.next}</span>}</div>
          <div className="flex flex-wrap gap-1 border-b border-line">{tabs.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={cx('px-2 py-1 text-xs', tab === k ? 'border-b-2 font-semibold' : 'text-ink-2')} style={tab === k ? { borderColor: C, color: C } : undefined}>{l}</button>)}</div>
          {tab === 'info' ? <>{data.readOnly === false && <LeadEdit key={data.lead.status + (data.lead.next ?? '')} id={id} data={data} onSaved={() => { reload(); onChange?.(); }} />}<Raw row={data.raw} /></> : <ul className="space-y-2">{(tabs.find((t) => t[0] === tab)?.[2] ?? []).map((r: any) => <li key={r.__id} className="rounded-input border border-line p-2"><Raw row={r} /></li>)}
            {!(tabs.find((t) => t[0] === tab)?.[2] ?? []).length && <li className="text-xs text-ink-3">없음</li>}</ul>}
        </div>
      )}
    </Modal>
  );
}

export function Leads({ initialId }: { initialId?: string }) {
  const [s, setS] = useState(''); const [status, setStatus] = useState(''); const [open, setOpen] = useState<string | null>(initialId ?? null);
  const { data, error, reload } = useApi<any>(`/api/sales/src?${q({ view: 'leads', q: s, status })}`, [s, status]);
  // 로컬 검수 10/19: prompt() 는 브라우저·자동화 환경에서 막힐 수 있어 입력 창으로
  const [nl, setNl] = useState<{ name: string; region: string; contactName: string; phone: string } | null>(null);
  async function newLead(e: React.FormEvent) {
    e.preventDefault(); if (!nl?.name.trim()) return;
    try { const r = await api<{ id: string }>('/api/sales/leads', { body: { name: nl.name.trim(), region: nl.region || undefined, contactName: nl.contactName || undefined, phone: nl.phone || undefined } }); setNl(null); reload(); setOpen(r.id); } catch (er: any) { toast.error(er.message); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  const statuses = [...new Set((data?.leads ?? []).map((l: any) => String(l.status ?? '미정')))] as string[];
  return (
    <div className="space-y-3" data-testid="sales-leads">
      <Head title="리드·거래처" meta={data}>{data?.readOnly === false && <Button size="sm" onClick={() => setNl({ name: '', region: '', contactName: '', phone: '' })} data-testid="lead-new">새 리드</Button>}<Search value={s} onChange={setS} /><select className={cx(inputCls, 'h-8 w-32 py-1 text-sm')} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="단계"><option value="">전체 단계</option>{statuses.map((x) => <option key={x}>{x}</option>)}</select></Head>
      {!data ? <Skeleton rows={5} /> : (
        <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card"><table className="w-full min-w-[720px] text-sm"><thead className="bg-slate-50 text-left text-xs text-ink-2"><tr><th className="p-2">이름</th><th className="p-2">단계</th><th className="p-2">우선</th><th className="p-2">시설</th><th className="p-2">지역</th><th className="p-2">담당</th><th className="p-2">다음 연락</th></tr></thead>
          <tbody>{data.leads.map((l: any) => <tr key={l.id} className="cursor-pointer border-t border-line hover:bg-slate-50" onClick={() => setOpen(l.id)} data-testid="sales-lead-row"><td className="p-2 font-medium">{l.name}</td><td className="p-2">{chip(l.status)}</td><td className="p-2 text-xs">{l.priority ?? ''}</td><td className="p-2 text-xs">{l.facility ?? ''}</td><td className="p-2 text-xs">{l.region ?? ''}</td><td className="p-2 text-xs">{l.owner ?? ''}</td><td className="p-2 text-xs tabular-nums">{l.next ?? ''}</td></tr>)}
            {!data.leads.length && <tr><td colSpan={7} className="p-6 text-center text-ink-3">리드가 없습니다</td></tr>}</tbody></table></div>
      )}
      {open && <LeadDetail id={open} onClose={() => setOpen(null)} onChange={reload} />}
      {nl && (
        <Modal open onClose={() => setNl(null)} title="새 리드">
          <form onSubmit={newLead} className="grid gap-3 text-sm" data-testid="lead-new-form">
            <Field label="거래처(리드) 이름"><input className={inputCls} value={nl.name} onChange={(e) => setNl({ ...nl, name: e.target.value })} required maxLength={300} autoFocus aria-label="거래처 이름" data-testid="lead-new-name" /></Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="지역"><input className={inputCls} value={nl.region} onChange={(e) => setNl({ ...nl, region: e.target.value })} maxLength={50} aria-label="지역" /></Field>
              <Field label="담당자(고객)"><input className={inputCls} value={nl.contactName} onChange={(e) => setNl({ ...nl, contactName: e.target.value })} maxLength={100} aria-label="고객 담당자" /></Field>
              <Field label="연락처"><input className={inputCls} value={nl.phone} onChange={(e) => setNl({ ...nl, phone: e.target.value })} maxLength={40} inputMode="tel" aria-label="연락처" /></Field>
            </div>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setNl(null)}>취소</Button><Button type="submit" disabled={!nl.name.trim()} data-testid="lead-new-save">만들기</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function Pipeline() {
  const { data, error, reload } = useApi<any>('/api/sales/src?view=pipeline');
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="space-y-3" data-testid="sales-pipeline">
      <Head title="파이프라인" meta={data} />
      {!data ? <Skeleton rows={5} /> : <div className="flex gap-3 overflow-x-auto pb-2">{data.columns.map((c: any) => (
        <section key={c.status} className="w-60 shrink-0 rounded-card border border-line bg-slate-50 p-2"><h2 className="mb-2 text-xs font-semibold">{c.status} <span className="text-ink-3">{c.items.length}</span></h2>
          <ul className="space-y-1.5">{c.items.map((l: any) => <li key={l.id}><button type="button" onClick={() => setOpen(l.id)} className="w-full rounded-input border border-line bg-white p-2 text-left text-sm hover:border-blue-300"><span className="block truncate font-medium">{l.name}</span><span className="block truncate text-[11px] text-ink-2">{[l.owner, l.next && `연락 ${l.next}`].filter(Boolean).join(' · ')}</span></button></li>)}</ul></section>))}</div>}
      {open && <LeadDetail id={open} onClose={() => setOpen(null)} onChange={reload} />}
    </div>
  );
}

export function Deals() {
  const { data, error, reload } = useApi<any>('/api/sales/src?view=deals');
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="space-y-3" data-testid="sales-deals">
      <Head title="제안·계약" meta={data} />
      {!data ? <Skeleton rows={3} /> : (['proposals', 'contracts'] as const).map((k) => (
        <section key={k} className="rounded-card border border-line bg-white p-3 shadow-card"><h2 className="mb-2 text-sm font-semibold">{k === 'proposals' ? '제안·견적' : '계약'} <span className="text-ink-3">{data[k].length}</span></h2>
          <ul className="space-y-2">{data[k].map((r: any) => <li key={r.__id} className="rounded-input border border-line p-2"><Raw row={r} /></li>)}{!data[k].length && <li className="text-xs text-ink-3">아직 없습니다</li>}</ul></section>))}
    </div>
  );
}

export function Bids({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'open'); const [s, setS] = useState('');
  const { data, error, reload } = useApi<any>(`/api/sales/src?${q({ view: 'bids', tab, q: s })}`, [tab, s]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="space-y-3" data-testid="sales-bids">
      <Head title="입찰·공고 모니터링" meta={data}><Search value={s} onChange={setS} /></Head>
      <div className="flex gap-1.5">{[['open', '진행 중(마감 임박순)'], ['working', '진행 기록 있음'], ['all', '관련 전체']].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={cx('rounded-full border px-3 py-1 text-xs', tab === k ? 'border-transparent text-white' : 'border-line')} style={tab === k ? { background: C } : undefined}>{l}</button>)}{data && <span className="self-center text-xs text-ink-3">{data.items.length}{data.items.length === 300 ? '+(최근 300)' : ''} / 관련 {data.total}</span>}</div>
      {!data ? <Skeleton rows={6} /> : <ul className="space-y-1.5">{data.items.map((n: any) => (
        <li key={n.id} className="rounded-card border border-line bg-white p-3 text-sm" data-testid="sales-bid"><div className="flex flex-wrap items-center gap-2">{n.url ? <a href={n.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{n.title}</a> : <span className="font-medium">{n.title}</span>}{chip(n.work)}{chip(n.classification)}{n.fit !== null && n.fit !== undefined && <span className="text-[11px] text-ink-3">적합 {String(n.fit)}</span>}</div>
          <div className="mt-0.5 text-xs text-ink-2">{[n.agency, n.region, n.source, n.deadline && `마감 ${String(n.deadline).slice(0, 16).replace('T', ' ')}`, n.status].filter(Boolean).join(' · ')}</div>
          {n.judgment && <div className="mt-0.5 text-xs text-ink-2">판단: {n.judgment}</div>}
          {!!n.attachments?.length && <div className="mt-1 flex flex-wrap gap-2 text-[11px]">{n.attachments.slice(0, 5).map((a: any, k: number) => <a key={k} href={typeof a === 'string' ? a : a?.url} target="_blank" rel="noopener noreferrer" className="underline">첨부 {k + 1}</a>)}</div>}</li>))}
        {!data.items.length && <li className="text-sm text-ink-3">해당 공고가 없습니다</li>}</ul>}
    </div>
  );
}

export function Hub() {
  const [tab, setTab] = useState('buildings'); const [s, setS] = useState(''); const [raw, setRaw] = useState<any>(null);
  const { data, error, reload } = useApi<any>(`/api/sales/src?${q({ view: 'hub', tab, q: s })}`, [tab, s]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="space-y-3" data-testid="sales-hub">
      <Head title="영업기회 허브" meta={data}><Search value={s} onChange={setS} /><Link href="/s/sales/prospects" className="text-xs underline" style={{ color: C }}>공공데이터 영업기회 →</Link></Head>
      <div className="flex gap-1.5">{[['buildings', '신규단지'], ['facilities', '준공·입주 시설'], ['vendors', '협력사 등록']].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} data-testid={`sales-hub-${k}`} className={cx('rounded-full border px-3 py-1 text-xs', tab === k ? 'border-transparent text-white' : 'border-line')} style={tab === k ? { background: C } : undefined}>{l}</button>)}</div>
      {!data ? <Skeleton rows={6} /> : <ul className="grid gap-2 lg:grid-cols-2">{data.items.map((r: any) => (
        <li key={r.id}><button type="button" onClick={() => setRaw(r.raw)} className="w-full rounded-card border border-line bg-white p-3 text-left text-sm hover:border-blue-300" data-testid="sales-hub-item">
          <span className="block truncate font-medium">{r.name}</span>
          <span className="block truncate text-xs text-ink-2">{tab === 'buildings' ? [r.address, r.households && `${r.households}세대`, r.start && `공고 ${r.start}`, r.status].filter(Boolean).join(' · ')
            : tab === 'facilities' ? [r.lane, r.region, r.address, r.operating, r.score !== null && `점수 ${r.score}`, r.contact && `연락 ${r.contact}`, r.next && `다음 ${r.next}`].filter(Boolean).join(' · ')
            : [r.division, r.rank, r.notice, r.status && `진행 ${r.status}`, r.memo, r.next && `다음 ${r.next}`].filter(Boolean).join(' · ')}</span></button></li>))}
        {!data.items.length && <li className="text-sm text-ink-3">없습니다</li>}</ul>}
      {raw && <Modal open onClose={() => setRaw(null)} title="원본 정보" wide><Raw row={raw} /></Modal>}
    </div>
  );
}

export function Regions() {
  const { data, error, reload } = useApi<any>('/api/sales/src?view=regions');
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="space-y-3" data-testid="sales-regions">
      <Head title="지역별" meta={data} />
      {!data ? <Skeleton rows={4} /> : <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.regions.map((r: any) => (
        <li key={r.region} className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="sales-region"><div className="flex items-center"><span className="font-semibold">{r.region}</span><span className="ml-auto text-lg font-bold tabular-nums" style={{ color: C }}>{r.total}</span></div>
          <div className="mt-1 flex flex-wrap gap-1">{Object.entries(r.byStatus).map(([s, n]) => <span key={s} className="rounded-full bg-slate-100 px-1.5 text-[11px]">{s} {String(n)}</span>)}</div></li>))}</ul>}
    </div>
  );
}
