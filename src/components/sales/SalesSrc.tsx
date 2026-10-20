'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download, ExternalLink, MessageSquare, Phone } from 'lucide-react';
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

/* 대표 검수 10/20 ② 앱 영업 공간 정리: 영문 키·id 숨김, 날짜 10. 20.(화) 형식, 전화·문자 줄, 홈페이지·원문·공고문 칩, 한국어 상세 + 관리자 원본 접힘 */
const digits = (p: unknown) => String(p).replace(/[^0-9+]/g, '');
const linkCls = 'inline-flex min-h-[32px] items-center gap-1 rounded-input border border-line bg-white px-2.5 text-xs font-medium';
/** 목록·상세 공통 연락 줄: [전화 번호][문자] + 링크 칩(홈페이지·원문·신청 등) */
function ContactRow({ phone, links, className }: { phone?: unknown; links?: [unknown, string][]; className?: string }) {
  const L = (links ?? []).filter(([u]) => u) as [string, string][];
  if (!phone && !L.length) return null;
  return (
    <div className={cx('flex flex-wrap items-center gap-1.5', className)} data-testid="contact-row">
      {phone ? <><a href={`tel:${digits(phone)}`} className={linkCls} style={{ color: C }} data-testid="contact-call"><Phone className="size-3.5" aria-hidden />전화 {String(phone)}</a>
        <a href={`sms:${digits(phone)}`} className={linkCls} data-testid="contact-sms"><MessageSquare className="size-3.5" aria-hidden />문자</a></> : null}
      {L.map(([u, l]) => <a key={l} href={u} target="_blank" rel="noopener noreferrer" className={cx(linkCls, 'text-ink-2')} data-testid="contact-link">{/내려받기/.test(l) ? <Download className="size-3.5" aria-hidden /> : <ExternalLink className="size-3.5" aria-hidden />}{l}</a>)}
    </div>
  );
}
const attUrl = (a: any) => (typeof a === 'string' ? a : a?.url ?? a?.href ?? '');
const attName = (a: any, i: number) => (typeof a === 'object' && a?.name ? String(a.name) : `공고문 ${i + 1} 내려받기`);
/** 한국어 칸 표(값 없는 칸은 숨김) */
function KoDl({ rows, testId }: { rows: [string, React.ReactNode][]; testId?: string }) {
  const R = rows.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false);
  return <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-sm" data-testid={testId}>{R.map(([k, v]) => [<dt key={k} className="text-ink-3">{k}</dt>, <dd key={k + ':v'} className="min-w-0 whitespace-pre-wrap break-words">{typeof v === 'string' || typeof v === 'number' ? String(v) : v}</dd>])}</dl>;
}
/* S1-2(로컬 10/20 최우선): 진행 기록 쓰기 — 원본 영업관리 상태 버튼 그대로(입찰·신규단지 2-10 / 시설 2-8 / 협력사 2-9) + 메모·다음 연락일 + [진행영업으로 넘기기](비슷한 리드 확인). 전환 전(readOnly)에는 안 보임 */
const WORK_STATUS: Record<string, string[]> = { bid: ['미검토', '검토중', '연락중', '보류', '미참여', '대상아님'], building: ['미검토', '검토중', '연락중', '보류', '대상아님'], facility: ['미연락', '연락중', '영업완료', '대상아님'], vendor: ['미등록', '신청 준비', '신청 완료', '등록 완료', '대상 아님'] };
const DONE_STATUS = new Set(['미참여', '대상아님', '영업완료', '등록 완료', '대상 아님']);
function WorkPanel({ kind, id, cur, onSaved }: { kind: 'bid' | 'building' | 'facility' | 'vendor'; id: string; cur: { status?: string | null; memo?: string | null; next?: string | null; leadId?: string | null }; onSaved: () => void }) {
  const [status, setStatus] = useState<string>(cur.status ?? WORK_STATUS[kind][0]);
  const [memo, setMemo] = useState(cur.memo ?? ''); const [next, setNext] = useState(cur.next ?? ''); const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<{ id: string; name: string; status: string | null }[] | null>(null);
  const converted = cur.status === '진행영업 전환' || !!cur.leadId;
  async function save(st = status) {
    setBusy(true);
    try { const r = await api<{ status: string }>('/api/sales/work', { body: { kind, id, status: st, memo: memo.trim() || null, nextDate: next || null } }); setStatus(r.status); toast.ok(DONE_STATUS.has(st) ? '완료 목록으로 옮깁니다' : '저장했습니다'); onSaved(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function convert(force = false) {
    setBusy(true);
    try { const r = await api<{ leadId?: string; similar?: { id: string; name: string; status: string | null }[] }>('/api/sales/work/convert', { body: { kind, id, force } });
      if (r.similar) { setSimilar(r.similar); return; }
      toast.ok('진행영업(리드)으로 넘겼습니다'); setSimilar(null); onSaved(); if (r.leadId) window.location.assign(`/s/sales/leads?id=${r.leadId}`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (converted) return <div className="rounded-input border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800" data-testid="work-converted">진행영업 전환됨{cur.leadId && <> · <Link href={`/s/sales/leads?id=${cur.leadId}`} className="underline">리드 열기</Link></>}</div>;
  return (
    <div className="space-y-2 rounded-input border border-blue-200 bg-blue-50/40 p-3 text-sm" data-testid="work-panel">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="진행 상태">{WORK_STATUS[kind].map((s) => (
        <button key={s} type="button" disabled={busy} onClick={() => { setStatus(s); void save(s); }} className={cx('rounded-full border px-2.5 py-1 text-xs', status === s ? 'border-transparent text-white' : 'border-line bg-white', DONE_STATUS.has(s) && status !== s && 'text-ink-3')} style={status === s ? { background: C } : undefined} data-testid={`work-status-${s}`}>{s}</button>))}</div>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <textarea className={cx(inputCls, 'min-h-[60px]')} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={2000} placeholder="메모 (처음 메모를 남기면 검토중으로)" aria-label="진행 메모" data-testid="work-memo" />
        <div className="flex flex-col gap-1.5"><input type="date" className={cx(inputCls, 'h-9')} value={next} onChange={(e) => setNext(e.target.value)} aria-label="다음 연락일" data-testid="work-next" />
          <Button size="sm" onClick={() => save()} disabled={busy} data-testid="work-save">저장</Button></div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-blue-100 pt-2">
        <Button size="sm" variant="secondary" onClick={() => convert(false)} disabled={busy} data-testid="work-convert">진행영업으로 넘기기</Button>
        <span className="text-[11px] text-ink-3">리드를 만들고 이 건을 연결합니다 (이름이 비슷한 거래처가 있으면 먼저 보여 줌)</span>
      </div>
      {similar && (
        <div className="rounded-input border border-amber-200 bg-amber-50 p-2 text-xs" data-testid="work-similar">
          <p className="mb-1 font-medium text-amber-900">이름이 비슷한 거래처가 있습니다</p>
          <ul className="space-y-0.5">{similar.map((s) => <li key={s.id}><Link href={`/s/sales/leads?id=${s.id}`} className="underline">{s.name}</Link>{s.status && <span className="ml-1 text-ink-3">{s.status}</span>}</li>)}</ul>
          <div className="mt-1.5 flex gap-1.5"><Button size="sm" onClick={() => convert(true)} disabled={busy} data-testid="work-convert-force">그래도 새로 만들기</Button><Button size="sm" variant="ghost" onClick={() => setSimilar(null)}>닫기</Button></div>
        </div>)}
    </div>
  );
}
/** S1-2 제안·계약 등록(전환 뒤): 리드 고르기 · 제목 · 금액 · 날짜 · 메모 */
function RecordForm({ kind, leads, onSaved }: { kind: 'proposals' | 'contracts'; leads: { id: string; name: string }[]; onSaved: () => void }) {
  const [f, setF] = useState({ leadId: '', title: '', amount: '', date: '', memo: '' }); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!f.leadId || !f.title.trim()) return; setBusy(true);
    try { await api(`/api/sales/leads/${f.leadId}/records`, { body: { kind, title: f.title.trim(), amount: f.amount ? Number(f.amount.replace(/[,\s]/g, '')) : null, date: f.date || null, memo: f.memo || undefined } }); toast.ok('등록했습니다'); setF({ leadId: '', title: '', amount: '', date: '', memo: '' }); onSaved(); } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="grid gap-2 rounded-input border border-blue-200 bg-blue-50/40 p-3 text-sm sm:grid-cols-[1fr_1fr_8rem_9rem_auto]" data-testid={`record-form-${kind}`}>
      <select className={inputCls} value={f.leadId} onChange={(e) => setF({ ...f, leadId: e.target.value })} aria-label="거래처(리드)" required data-testid="record-lead"><option value="">거래처(리드) 고르기</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      <input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={kind === 'proposals' ? '제안·견적 제목' : '계약 제목'} maxLength={300} required aria-label="제목" data-testid="record-title" />
      <input className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="금액(원)" inputMode="numeric" aria-label="금액" data-testid="record-amount" />
      <input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="날짜" />
      <Button size="sm" disabled={busy || !f.leadId || !f.title.trim()} data-testid="record-save">{kind === 'proposals' ? '제안 등록' : '계약 등록'}</Button>
    </form>
  );
}
/** 관리자만: 원본 키·값 전체(접힘) */
const RawFold = ({ row, admin, testId }: { row: any; admin?: boolean; testId?: string }) => admin ? <details className="text-xs" data-testid={testId}><summary className="cursor-pointer text-ink-3">원본 보기(관리자)</summary><div className="mt-1"><Raw row={row} /></div></details> : null;
const KEY_KO: Record<string, string> = { kind: '종류', type: '종류', activity_type: '종류', content: '내용', memo: '메모', note: '비고', notes: '비고', title: '제목', name: '이름', status: '상태', stage: '단계', amount: '금액', total_amount: '총액', price: '금액', created_at: '등록', updated_at: '수정', date: '날짜', activity_date: '일시', due_date: '마감', deadline: '마감', deadline_at: '마감', start_date: '시작', end_date: '종료', sent_at: '발송', signed_at: '체결', contract_date: '계약일', period: '기간', description: '설명', summary: '요약', result: '결과', next_action: '다음 조치', next_action_date: '다음 조치일', next_contact_date: '다음 연락', owner: '담당', owner_name: '담당', user_name: '작성자', author: '작성자', business: '사업', interest: '관심 사업', business_name: '관심 사업', priority: '우선순위', probability: '가능성', expected_close_date: '예상 체결', notice_title: '공고명', region: '지역', phone: '전화', contact_name: '담당자', url: '링크', file_url: '파일', attachment_url: '첨부', version: '버전', timing: '시점', expected_at: '예상 시점', reason: '사유', channel: '경로', lead_name: '거래처', proposal_date: '제안일', notice_id: '공고', source_id: '단지', source_type: '출처 종류', next_date: '다음 연락', last_note: '최근 기록', contact_status: '연락 상태', converted_at: '전환 시각' };
const HIDE_KEY = /(^|_)id$|^__|^tenant$|^scope$|^src$|^raw$/;
const fmtVal = (k: string, v: unknown) => { if (typeof v === 'object') return JSON.stringify(v); const s = String(v); if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return fmtDateTime(s); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return kd(s); if (/amount|price|revenue|total/.test(k) && Number(s)) return `${Number(s).toLocaleString('ko-KR')}원`; if (/^-?\d+\.\d+$/.test(s) && Number.isInteger(Number(s))) return String(Number(s)); return s; };
/** 원본 기록 한 건: 아는 칸은 한국어로, id·내부 키 숨김, 모르는 칸은 '그 밖' 접힘, 관리자는 원본 전체 접힘 */
function Rec({ row, admin }: { row: any; admin?: boolean }) {
  const known: [string, string][] = []; const rest: [string, string][] = [];
  for (const [k, v] of Object.entries(row ?? {})) {
    if (HIDE_KEY.test(k) || v === null || v === undefined || v === '') continue;
    const s = fmtVal(k, v); if (KEY_KO[k]) known.push([KEY_KO[k], s]); else rest.push([k.replace(/_/g, ' '), s]);
  }
  return (
    <div className="space-y-1" data-testid="sales-rec">
      {known.length ? <KoDl rows={known} /> : !rest.length ? <p className="text-xs text-ink-3">내용 없음</p> : null}
      {!!rest.length && !admin && <details className="text-xs"><summary className="cursor-pointer text-ink-3">그 밖 {rest.length}칸</summary><dl className="mt-1 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-0.5">{rest.map(([k, v]) => [<dt key={k} className="truncate text-ink-3">{k}</dt>, <dd key={k + ':v'} className="break-all">{v}</dd>])}</dl></details>}
      <RawFold row={row} admin={admin} />
    </div>
  );
}

/** 대표(10/19): 영업·마케팅 현황 맨 위 '오늘' 카드 줄 — 누르면 그 목록(필터 적용) */
export function TodayRow({ date, cards, color = C }: { date: string; cards: [string, number, string, string?][]; color?: string }) {
  return (
    <section className="rounded-card border bg-white p-3 shadow-card" style={{ borderColor: color }} data-testid="today-row">
      <h2 className="mb-2 text-sm font-semibold">오늘 <span className="font-normal text-ink-3">{date}</span></h2>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{cards.map(([l, n, h, sub]) => (
        <Link key={l} href={h} className="rounded-input border border-line p-2.5 hover:bg-slate-50" data-testid="today-card"><div className="text-xs text-ink-2">{l}</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums" style={{ color: n ? color : undefined }}>{n}</div>{sub && <div className="truncate text-[11px] text-ink-3">{sub}</div>}</Link>))}</div>
    </section>
  );
}

export function SalesHome() {
  const { data, error, reload } = useApi<any>('/api/sales/src?view=summary');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  const k = data.kpi;
  const bids = data.bidsOn !== false; // 입찰·공고 끈 회사는 입찰 카드 숨김
  const cards: [string, number, string][] = [['리드', k.leads, '/s/sales/leads'], ['7일 안 연락', k.dueSoon, '/s/sales/leads'], ['연락 지남', k.overdue, '/s/sales/leads'],
    ...(bids ? [['진행 중 입찰', k.bidsOpen ?? k.bidsWorking, '/s/sales/bids?tab=open'], ['작업 중 입찰', k.bidsWorking, '/s/sales/bids?tab=working'], ['관련 공고', k.relatedNotices, '/s/sales/bids'], ['최근 7일 공고(공고일)', k.newNotices7d, '/s/sales/bids?tab=all']] as [string, number, string][] : [])];
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="space-home-sales">
      <Head title="워크인 · 영업" meta={data} />
      {data.setupNeeded && (
        <section className="rounded-card border-2 border-[#93C5FD] bg-[#EFF6FF] p-4" data-testid="sales-setup-prompt">
          <h2 className="text-base font-bold text-[#1D4ED8]">영업 출처부터 고르세요</h2>
          <p className="mt-1 text-sm text-ink-2">회사 업종·지역·주력 상품을 보고 AI 가 맞는 출처(공공데이터·입찰 등)를 근거와 함께 추천합니다. 체크로 고르고, 목록 밖 사이트·키워드·엑셀도 직접 넣을 수 있어요.</p>
          <Link href="/s/sales/sources" className="mt-2 inline-block rounded-input bg-[#2563EB] px-4 py-2 text-sm font-medium text-white" data-testid="sales-setup-go">출처 추천받기</Link>
        </section>)}
      {data.today && <TodayRow date={data.today.date} cards={[
        ...(bids ? [['오늘 새 공고', data.today.newNotices, '/s/sales/bids?tab=today'] as [string, number, string]] : []),
        ['오늘 새 영업 DB', data.today.newDb.buildings + data.today.newDb.facilities + data.today.newDb.vendors, `/s/sales/hub?day=today&tab=${data.today.newDb.facilities >= data.today.newDb.buildings && data.today.newDb.facilities >= data.today.newDb.vendors ? 'facilities' : data.today.newDb.vendors > data.today.newDb.buildings ? 'vendors' : 'buildings'}`,
          `신규단지 ${data.today.newDb.buildings} · 시설 ${data.today.newDb.facilities} · 협력사 ${data.today.newDb.vendors}`],
        ['오늘 연락할 리드', data.today.contact, '/s/sales/leads?day=today'],
        ...(bids ? [['오늘 마감 입찰', data.today.closing, '/s/sales/bids?tab=closing'] as [string, number, string]] : [])]} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{cards.map(([l, n, h]) => (
        <Link key={l} href={h} className="rounded-card border border-line bg-white p-3 shadow-card hover:border-blue-300" data-testid="sales-kpi"><div className="text-xs text-ink-2">{l}</div><div className={cx('mt-1 text-2xl font-bold tabular-nums', l === '연락 지남' && n ? 'text-red-600' : '')} style={l === '연락 지남' && n ? undefined : { color: C }}>{n}</div></Link>))}</div>
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-white p-3 shadow-card"><h2 className="mb-2 text-sm font-semibold">다가오는 연락</h2>
          <ul className="divide-y divide-line text-sm">{data.due.map((l: any) => <li key={l.id} className="flex items-center gap-2 py-1.5"><Link href={`/s/sales/leads?id=${encodeURIComponent(l.id)}`} className="min-w-0 flex-1 truncate hover:underline">{l.name}</Link>{chip(l.status)}<span className={cx('text-xs tabular-nums', l.next < today() ? 'font-semibold text-red-600' : 'text-ink-2')}>{kd(l.next)}</span></li>)}
            {!data.due.length && <li className="py-2 text-xs text-ink-3">오늘부터 7일 안에 연락할 리드가 없습니다</li>}</ul></section>
        {!!data.overdueList?.length && <section className="rounded-card border border-red-200 bg-white p-3 shadow-card" data-testid="sales-overdue"><h2 className="mb-2 text-sm font-semibold text-red-700">연락 지남 <span className="font-normal text-ink-3">{data.kpi.overdue}</span></h2>
          <ul className="divide-y divide-line text-sm">{data.overdueList.map((l: any) => <li key={l.id} className="flex items-center gap-2 py-1.5"><Link href={`/s/sales/leads?id=${encodeURIComponent(l.id)}`} className="min-w-0 flex-1 truncate hover:underline">{l.name}</Link>{chip(l.status)}<span className="text-xs tabular-nums text-red-600">{kd(l.next)}</span></li>)}</ul></section>}
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
          <div className="flex flex-wrap gap-1.5 text-xs">{chip(data.lead.status)}{chip(data.lead.priority)}{chip(data.lead.facility)}{chip(data.lead.region)}{data.lead.owner && <span className="text-ink-2">담당 {data.lead.owner}</span>}{data.lead.next && <span className="text-ink-2">다음 연락 {kd(data.lead.next)}</span>}</div>
          <div className="flex flex-wrap gap-1 border-b border-line">{tabs.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={cx('px-2 py-1 text-xs', tab === k ? 'border-b-2 font-semibold' : 'text-ink-2')} style={tab === k ? { borderColor: C, color: C } : undefined}>{l}</button>)}</div>
          {tab === 'info' ? <>{data.readOnly === false && <LeadEdit key={data.lead.status + (data.lead.next ?? '')} id={id} data={data} onSaved={() => { reload(); onChange?.(); }} />}
            {/* 로컬 10/19: 사람이 보는 칸만 한국어로 — 내부 id·원본 키는 숨기고, 원본 전체는 관리자만 접힘 안에 */}
            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-sm" data-testid="lead-info">
              {([['거래처명', data.lead.name], ['단계', data.lead.status], ['우선순위', data.lead.priority], ['시설', data.lead.facility], ['지역', data.lead.region], ['담당', data.lead.owner], ['다음 연락', data.lead.next && kd(data.lead.next)],
                ['연락처', [data.lead.contact, data.lead.phone].filter(Boolean).join(' · ')], ['홈페이지', data.lead.homepage && <a href={data.lead.homepage} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: C }}>{String(data.lead.homepage).replace(/^https?:\/\//, '')}</a>], ['예상매출', won(data.lead.revenue)], ['최근 활동', data.lead.updated && kd(data.lead.updated)], ['메모', data.lead.memo]] as [string, unknown][])
                .filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [<dt key={k} className="text-ink-3">{k}</dt>, <dd key={k + ':v'} className="whitespace-pre-wrap break-words">{typeof v === 'string' || typeof v === 'number' ? String(v) : (v as React.ReactNode)}</dd>])}
            </dl>
            <ContactRow phone={data.lead.phone} />
            <RawFold row={data.raw} admin={data.canAssign} testId="lead-raw" /></> : <ul className="space-y-2">{(tabs.find((t) => t[0] === tab)?.[2] ?? []).map((r: any) => <li key={r.__id} className="rounded-input border border-line p-2"><Rec row={r} admin={data.canAssign} /></li>)}
            {!(tabs.find((t) => t[0] === tab)?.[2] ?? []).length && <li className="text-xs text-ink-3">없음</li>}</ul>}
        </div>
      )}
    </Modal>
  );
}

export function Leads({ initialId, initialDay }: { initialId?: string; initialDay?: string }) {
  const [s, setS] = useState(''); const [status, setStatus] = useState(''); const [open, setOpen] = useState<string | null>(initialId ?? null);
  const [day, setDay] = useState(initialDay === 'today' ? 'today' : ''); // 영업 현황 '오늘 연락할 리드'
  const { data, error, reload } = useApi<any>(`/api/sales/src?${q({ view: 'leads', q: s, status, day })}`, [s, status, day]);
  // 로컬 검수 10/19: prompt() 는 브라우저·자동화 환경에서 막힐 수 있어 입력 창으로
  const [nl, setNl] = useState<{ name: string; region: string; contactName: string; phone: string } | null>(null);
  // 앱 더보기 › 만들기 › 새 리드(?new=1): 쓰기 열린 회사면 입력 창 바로
  async function patchLead(id: string, body: Record<string, unknown>) {
    try { await api(`/api/sales/leads/${id}`, { method: 'PATCH', body }); toast.ok('저장했습니다'); reload(); } catch (e: any) { toast.error(e.message); reload(); }
  }
  useEffect(() => { if (data?.readOnly === false && new URLSearchParams(window.location.search).get('new') === '1') setNl({ name: '', region: '', contactName: '', phone: '' }); }, [data?.readOnly]);
  async function newLead(e: React.FormEvent) {
    e.preventDefault(); if (!nl?.name.trim()) return;
    try { const r = await api<{ id: string }>('/api/sales/leads', { body: { name: nl.name.trim(), region: nl.region || undefined, contactName: nl.contactName || undefined, phone: nl.phone || undefined } }); setNl(null); reload(); setOpen(r.id); } catch (er: any) { toast.error(er.message); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  const statuses = [...new Set((data?.leads ?? []).map((l: any) => String(l.status ?? '미정')))] as string[];
  return (
    <div className="space-y-3" data-testid="sales-leads">
      <Head title="리드·거래처" meta={data}>{data?.readOnly === false && <Button size="sm" onClick={() => setNl({ name: '', region: '', contactName: '', phone: '' })} data-testid="lead-new">새 리드</Button>}<Search value={s} onChange={setS} />{day === 'today' && <button type="button" onClick={() => setDay('')} className="rounded-full border px-2.5 py-0.5 text-xs" style={{ color: C, borderColor: C }} data-testid="leads-day-today">오늘 연락할 리드 ✕</button>}<select className={cx(inputCls, 'h-8 w-32 py-1 text-sm')} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="단계"><option value="">전체 단계</option>{statuses.map((x) => <option key={x}>{x}</option>)}</select></Head>
      {!data ? <Skeleton rows={5} /> : (
        <>
        {/* 영업관리 2-13 표 칸: 거래처명(담당·최근 활동·금액) · 관심 사업 · 시설 · 지역 · 단계 · 우선 · 예상매출 · 다음 연락 · 최근 활동 · 담당 — 휴대폰은 카드 */}
        <div className="hidden overflow-x-auto rounded-card border border-line bg-white shadow-card md:block"><table className="w-full min-w-[960px] text-sm"><thead className="bg-slate-50 text-left text-xs text-ink-2"><tr>{['거래처명', '관심 사업', '시설', '지역', '단계', '우선', '예상매출', '다음 연락', '최근 활동', '담당'].map((h) => <th key={h} className="whitespace-nowrap p-2">{h}</th>)}</tr></thead>
          <tbody>{data.leads.map((l: any) => { const ed = data.readOnly === false; return <tr key={l.id} className="cursor-pointer border-t border-line hover:bg-slate-50" onClick={(e) => { if (!(e.target as HTMLElement).closest('input,select,button')) setOpen(l.id); }} data-testid="sales-lead-row">
            {/* 대표 요청(영업관리 거래처 장): 표 안에서 바로 고치기 — 거래처명·단계·우선·다음 연락·담당(관리자). 바뀌면 바로 저장 */}
            <td className="p-2 font-medium">{ed ? <CellInput value={l.name} onSave={(v) => patchLead(l.id, { name: v })} label="거래처명" testId="cell-name" /> : l.name}{l.contact && <span className="block text-[11px] font-normal text-ink-3">{l.contact}{l.phone ? ` · ${l.phone}` : ''}</span>}</td>
            <td className="p-2">{interests(l.interests)}</td><td className="p-2 text-xs">{l.facility ?? ''}</td><td className="p-2 text-xs">{l.region ?? ''}</td>
            <td className="p-2">{ed ? <select className="rounded border border-line bg-white px-1 py-0.5 text-xs" value={l.status ?? ''} aria-label="단계" data-testid="cell-status" onChange={(e) => { const v = e.target.value; const reason = ['보류', '실패'].includes(v) ? prompt(`'${v}' 사유`) ?? '' : undefined; if (reason === '') return; void patchLead(l.id, { status: v, ...(reason ? { reason } : {}) }); }}>{(data.stages ?? []).map((s: string) => <option key={s}>{s}</option>)}</select> : chip(l.status)}</td>
            <td className="p-2 text-xs">{ed ? <select className="rounded border border-line bg-white px-1 py-0.5 text-xs" value={l.priorityCode ?? ''} aria-label="우선" data-testid="cell-priority" onChange={(e) => patchLead(l.id, { priority: e.target.value || null })}><option value="">—</option>{[['urgent', '긴급'], ['high', '높음'], ['medium', '보통'], ['low', '낮음']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> : l.priority ?? ''}</td>
            <td className="p-2 text-xs tabular-nums">{won(l.revenue) || '-'}</td>
            <td className={cx('p-2 text-xs tabular-nums', l.next && l.next < today() ? 'font-semibold text-red-600' : '')}>{ed ? <input type="date" className="rounded border border-line bg-white px-1 py-0.5 text-xs" defaultValue={l.next ?? ''} aria-label="다음 연락" data-testid="cell-next" onChange={(e) => patchLead(l.id, { nextContactDate: e.target.value || null })} /> : kd(l.next)}</td>
            <td className="p-2 text-xs tabular-nums text-ink-3">{kd(l.updated)}</td>
            <td className="p-2 text-xs">{ed && data.canAssign ? <select className="rounded border border-line bg-white px-1 py-0.5 text-xs" value={l.ownerId ?? ''} aria-label="담당" data-testid="cell-owner" onChange={(e) => patchLead(l.id, { ownerId: e.target.value || null })}><option value="">없음</option>{(data.people ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : l.owner ?? ''}</td></tr>; })}
            {!data.leads.length && <tr><td colSpan={10} className="p-6 text-center text-ink-3">리드가 없습니다</td></tr>}</tbody></table></div>
        {/* 대표 검수 10/20 ②: 전화·문자 줄과 홈페이지 칩을 카드 안에(전에는 카드 밖에 전화만 떠 있었음), 날짜 10. 22.(목) */}
        <ul className="space-y-2 md:hidden" data-testid="sales-lead-cards">{data.leads.map((l: any) => (
          <li key={l.id} className="rounded-card border border-line bg-white p-3 text-sm" data-testid="sales-lead-card"><button type="button" onClick={() => setOpen(l.id)} className="block w-full text-left" data-testid="sales-lead-open">
            <span className="flex flex-wrap items-center gap-1.5"><b>{l.name}</b>{chip(l.status)}{l.priority && <span className="text-[11px] text-ink-2">{l.priority}</span>}</span>
            <span className="mt-0.5 block text-xs text-ink-2">{[l.facility, l.region, l.contact, l.owner && `담당 ${l.owner}`].filter(Boolean).join(' · ')}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">{interests(l.interests)}{l.next && <span className={l.next < today() ? 'font-semibold text-red-600' : 'text-ink-2'}>다음 연락 {kd(l.next)}</span>}{l.revenue ? <span className="text-ink-3">{won(l.revenue)}</span> : null}</span>
          </button><ContactRow phone={l.phone} links={[[l.homepage, '홈페이지']]} className="mt-2" /></li>))}
          {!data.leads.length && <li className="text-sm text-ink-3">리드가 없습니다</li>}</ul>
        </>
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
  const [stage, setStage] = useState(''); // 앱 단계 칩
  if (error) return <ErrorBox error={error} retry={reload} />;
  const cols: any[] = data?.columns ?? []; const used = cols.filter((c) => c.items.length); const total = used.reduce((n, c) => n + c.items.length, 0);
  const shown = stage ? cols.filter((c) => c.status === stage) : used;
  return (
    <div className="space-y-3" data-testid="sales-pipeline">
      <Head title="파이프라인" meta={data} />
      {!data ? <Skeleton rows={5} /> : <>
        {/* 대표 검수 10/20 ②: 휴대폰은 가로 칸반(빈 칸 많고 좁음) 대신 단계 칩 + 목록, PC 는 칸반 그대로 */}
        <div className="md:hidden" data-testid="pipeline-list">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">{([['', `전체 ${total}`], ...used.map((c) => [c.status, `${c.status} ${c.items.length}`])] as [string, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setStage(k)} className={cx('shrink-0 rounded-full border px-3 py-1 text-xs', stage === k ? 'border-transparent text-white' : 'border-line bg-white')} style={stage === k ? { background: C } : undefined} data-testid="pipeline-stage">{l}</button>))}</div>
          <ul className="mt-2 space-y-2">{shown.flatMap((c) => c.items.map((l: any) => <li key={l.id}><button type="button" onClick={() => setOpen(l.id)} className="w-full rounded-card border border-line bg-white p-3 text-left text-sm" data-testid="pipeline-item">
            <span className="flex flex-wrap items-center gap-1.5"><b>{l.name}</b>{chip(c.status)}</span>
            <span className="mt-0.5 block text-xs text-ink-2">{[l.owner && `담당 ${l.owner}`, l.next && `다음 연락 ${kd(l.next)}`].filter(Boolean).join(' · ')}</span></button></li>))}
            {!shown.some((c) => c.items.length) && <li className="text-sm text-ink-3">리드가 없습니다</li>}</ul>
        </div>
        <div className="hidden gap-3 overflow-x-auto pb-2 md:flex">{cols.map((c: any) => (
          <section key={c.status} className="w-60 shrink-0 rounded-card border border-line bg-slate-50 p-2"><h2 className="mb-2 text-xs font-semibold">{c.status} <span className="text-ink-3">{c.items.length}</span></h2>
            <ul className="space-y-1.5">{c.items.map((l: any) => <li key={l.id}><button type="button" onClick={() => setOpen(l.id)} className="w-full rounded-input border border-line bg-white p-2 text-left text-sm hover:border-blue-300"><span className="block truncate font-medium">{l.name}</span><span className="block truncate text-[11px] text-ink-2">{[l.owner, l.next && `연락 ${kd(l.next)}`].filter(Boolean).join(' · ')}</span></button></li>)}</ul></section>))}</div>
      </>}
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
          {data.readOnly === false && <div className="mb-2"><RecordForm kind={k} leads={data.leads ?? []} onSaved={reload} /></div>}
          <ul className="space-y-2">{data[k].map((r: any) => <li key={r.__id} className="rounded-input border border-line p-2"><Rec row={r} admin={data.canAssign} /></li>)}{!data[k].length && <li className="text-xs text-ink-3">아직 없습니다</li>}</ul></section>))}
    </div>
  );
}

export function Bids({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'open'); const [s, setS] = useState(''); const [open, setOpen] = useState<any>(null);
  const { data, error, reload } = useApi<any>(`/api/sales/src?${q({ view: 'bids', tab, q: s })}`, [tab, s]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="space-y-3" data-testid="sales-bids">
      <Head title="입찰·공고 모니터링" meta={data}><Search value={s} onChange={setS} /></Head>
      <div className="flex flex-wrap gap-1.5">{[['open', '진행 중(마감 임박순)'], ['working', '진행 기록 있음'], ['all', '관련 전체'], ['today', '오늘 새 공고'], ['closing', '오늘 마감']].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={cx('rounded-full border px-3 py-1 text-xs', tab === k ? 'border-transparent text-white' : 'border-line')} style={tab === k ? { background: C } : undefined}>{l}</button>)}{data && <span className="self-center text-xs text-ink-3">{data.items.length}{data.items.length === 300 ? '+(최근 300)' : ''} / 관련 {data.total}</span>}</div>
      {!data ? <Skeleton rows={6} /> : <ul className="space-y-1.5">{data.items.map((n: any) => <BidCard key={n.id} n={n} onOpen={() => setOpen(n)} />)}
        {!data.items.length && <li className="text-sm text-ink-3">해당 공고가 없습니다</li>}</ul>}
      {open && <BidDetail n={data?.items.find((x: any) => x.id === open.id) ?? open} admin={data?.canAssign} canWrite={data?.readOnly === false} onChange={reload} onClose={() => setOpen(null)} />}
    </div>
  );
}
/** 대표 검수 10/20 ②: 입찰 상세 — 한국어 칸만(공고명·단지·발주처·마감·예산·문서·연락처·상태·메모·다음 조치), 관리자 '원본 보기' 접힘 */
function BidDetail({ n, admin, canWrite, onChange, onClose }: { n: any; admin?: boolean; canWrite?: boolean; onChange?: () => void; onClose: () => void }) {
  const docs = [n.url && <a key="u" href={n.url} target="_blank" rel="noopener noreferrer" className={cx(linkCls, 'text-ink-2')} data-testid="bid-doc-url"><ExternalLink className="size-3.5" aria-hidden />원문 보기</a>,
    ...(n.attachments ?? []).map((a: any, i: number) => attUrl(a) && <a key={i} href={attUrl(a)} target="_blank" rel="noopener noreferrer" className={cx(linkCls, 'text-ink-2')} data-testid="bid-doc-file"><Download className="size-3.5" aria-hidden />{attName(a, i)}</a>)].filter(Boolean);
  return (
    <Modal open onClose={onClose} title={n.title} wide>
      <div className="space-y-3" data-testid="bid-detail">
        <KoDl rows={[['공고명', n.title], ['단지', n.complex], ['발주처', n.agency], ['지역', n.region], ['마감', n.deadline ? kdt(n.deadline) : '미확인'], ['예산', won(n.amount) || (n.amount ? String(n.amount) : null)],
          ['공고일', n.noticeDate && kd(n.noticeDate)], ['DB 등록', n.posted && kd(n.posted)], ['출처', n.sourceLabel], ['분류', n.classification ?? n.category], ['판단', n.judgment], ['세대수', n.households && `${n.households}세대`], ['업종', n.industry], ['키워드', n.keywords],
          ['낙찰', n.winner && [n.winner, won(n.awardAmount), n.awardDate && kd(n.awardDate)].filter(Boolean).join(' · ')],
          ['문서', docs.length ? <span className="flex flex-wrap gap-1.5">{docs}</span> : null], ['연락처', n.phone && <ContactRow phone={n.phone} />],
          ['상태', n.work], ['메모', n.workMemo], ['다음 조치', n.workNext && kd(n.workNext)]]} />
        {canWrite && <WorkPanel kind="bid" id={String(n.id)} cur={{ status: n.work, memo: n.workMemo, next: n.workNext, leadId: n.workLeadId }} onSaved={() => onChange?.()} />}
        <RawFold row={n.raw} admin={admin} testId="bid-raw" />
      </div>
    </Modal>
  );
}

export function Hub({ initialTab, initialDay }: { initialTab?: string; initialDay?: string }) {
  const [tab, setTab] = useState(['buildings', 'facilities', 'vendors'].includes(initialTab ?? '') ? initialTab! : 'buildings'); const [s, setS] = useState(''); const [detail, setDetail] = useState<any>(null);
  const [day, setDay] = useState(initialDay === 'today' ? 'today' : ''); // 영업 현황 '오늘 새 영업 DB'
  const { data, error, reload } = useApi<any>(`/api/sales/src?${q({ view: 'hub', tab, q: s, day })}`, [tab, s, day]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="space-y-3" data-testid="sales-hub">
      <Head title="영업기회 허브" meta={data}><Search value={s} onChange={setS} /><Link href="/s/sales/prospects" className="text-xs underline" style={{ color: C }}>공공데이터 영업기회 →</Link>
        {day === 'today' && <button type="button" onClick={() => setDay('')} className="rounded-full border px-2.5 py-0.5 text-xs" style={{ color: C, borderColor: C }} data-testid="hub-day-today">오늘 새로 들어온 것만 ✕</button>}</Head>
      <div className="flex gap-1.5">{[['buildings', '신규단지'], ['facilities', '준공·입주 시설'], ['vendors', '협력사 등록']].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} data-testid={`sales-hub-${k}`} className={cx('rounded-full border px-3 py-1 text-xs', tab === k ? 'border-transparent text-white' : 'border-line')} style={tab === k ? { background: C } : undefined}>{l}</button>)}</div>
      {!data ? <Skeleton rows={6} /> : <ul className="grid gap-2 lg:grid-cols-2">{data.items.map((r: any) => (
        <li key={r.id}><HubCard tab={tab} r={r} onRaw={() => setDetail({ tab, r })} /></li>))}
        {!data.items.length && <li className="text-sm text-ink-3">없습니다</li>}</ul>}
      {detail && <HubDetail tab={detail.tab} r={data?.items.find((x: any) => x.id === detail.r.id) ?? detail.r} admin={data?.canAssign} canWrite={data?.readOnly === false} onChange={reload} onClose={() => setDetail(null)} />}
    </div>
  );
}
/** 대표 검수 10/20 ②: 허브 상세 — 원본 키 덤프 대신 한국어 칸(값 없는 칸은 '미확인'), 관리자 '원본 보기' 접힘 */
function HubDetail({ tab, r, admin, canWrite, onChange, onClose }: { tab: string; r: any; admin?: boolean; canWrite?: boolean; onChange?: () => void; onClose: () => void }) {
  const rows: [string, React.ReactNode][] = tab === 'buildings'
    ? [['단지명', r.name], ['상태', r.status], ['유형', r.kind], ['우선순위', r.priority], ['지역', r.region], ['주소', r.address], ...(r.dates ?? []).map(([k, v]: [string, unknown]) => [k, k === '세대수' ? (D(v) ? `${D(v)}세대` : UNK) : (D(v) ? kd(D(v)) : UNK)] as [string, React.ReactNode]), ['DB 등록', r.firstSeen && kd(r.firstSeen)]]
    : tab === 'facilities'
      ? [['시설명', r.name], ['판정', r.verdict], ['연락 상태', r.contact], ['유형', r.lane], ['지역', r.region], ['세대수', r.households && `${r.households}세대`], ['규모', r.scale], ['현 위탁사', r.operator], ['주소', r.address], ['관리사무소', r.phone ? <ContactRow phone={r.phone} /> : UNK],
        ['부대시설', r.amenities && String(r.amenities)], ['준공(사용승인)', r.date && kd(r.date)], ['입주', r.moveIn && kd(r.moveIn)], ['DB 등록', r.firstSeen && kd(r.firstSeen)], ['다음 연락', r.next && kd(r.next)], ['최근 기록', r.lastNote], ['다음 조치', r.nextAction]]
      : [['회사', r.name], ['구분', r.division], ['순위', r.rank && `${r.rank}위`], ['상태', r.status], ['모집 공지', r.open != null && (r.open === true || r.open === 'true' ? '공개' : '비공개')], ['모집 시기', r.period], ['등록 요건', r.requirement], ['공동인증서', r.cert], ['비고', r.note], ['공지', r.notice],
        ['링크', <ContactRow key="l" links={[[r.url, '공지 원문'], [r.applyUrl, '등록 신청'], [r.portalUrl, '협력사 포털'], [r.homepage, '홈페이지']]} />], ['메모', r.memo], ['다음', r.next && kd(r.next)], ['DB 등록', r.firstSeen && kd(r.firstSeen)]];
  return (
    <Modal open onClose={onClose} title={r.name} wide>
      <div className="space-y-3" data-testid="hub-detail"><KoDl rows={rows} />
        {canWrite && (tab === 'buildings' ? <WorkPanel kind="building" id={String(r.id)} cur={{ status: r.work?.status, memo: r.work?.memo, next: r.work?.next, leadId: r.work?.leadId }} onSaved={() => onChange?.()} />
          : tab === 'facilities' ? <WorkPanel kind="facility" id={String(r.id)} cur={{ status: r.contact, memo: r.lastNote, next: r.next, leadId: r.leadId }} onSaved={() => onChange?.()} />
            : <WorkPanel kind="vendor" id={String(r.id)} cur={{ status: r.status, memo: r.memo, next: r.next, leadId: r.leadId }} onSaved={() => onChange?.()} />)}
        <RawFold row={r.raw} admin={admin} testId="hub-raw" /></div>
    </Modal>
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

// 로컬 10/19: 예상매출 0.00 → 빈칸('-'), 날짜는 10. 9.(수) 형식
const won = (v: unknown) => (v == null || v === '' || Number(v) === 0 ? '' : Number(v) ? `${Number(v).toLocaleString('ko-KR')}원` : String(v));
const kd = (v: unknown) => { const s = String(v ?? ''); if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s; const d = new Date(`${s.slice(0, 10)}T00:00:00Z`); const y = d.getUTCFullYear() !== Number(today().slice(0, 4)) ? `${d.getUTCFullYear()}. ` : ''; return `${y}${d.getUTCMonth() + 1}. ${d.getUTCDate()}.(${'일월화수목금토'[d.getUTCDay()]})`; }; // 올해가 아니면 연도 앞에(2024. 5. 13.(월))
/** 날짜+시각: 10. 25.(토) 10:00 (시각 없거나 00:00 이면 날짜만) */
const kdt = (v: unknown) => { const s = String(v ?? ''); if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s; const t = s.slice(11, 16); return kd(s) + (/^\d\d:\d\d$/.test(t) && t !== '00:00' ? ` ${t}` : ''); };
/** 표 칸 글 고치기: 엔터·밖 누르면 저장, Esc 취소 */
function CellInput({ value, onSave, label, testId }: { value: string; onSave: (v: string) => void; label: string; testId: string }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  return <input className="w-full min-w-[8rem] rounded border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-line focus:border-line focus:bg-white" value={v} aria-label={label} data-testid={testId}
    onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(value ?? ''); }}
    onBlur={() => { if (v.trim() && v.trim() !== value) onSave(v.trim()); else setV(value ?? ''); }} />;
}
const interests = (a?: string[]) => (a?.length ? <span className="inline-flex flex-wrap gap-1">{a.slice(0, 2).map((x) => <span key={x} className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-800">{x}</span>)}{a.length > 2 && <span className="text-[10px] text-ink-3">+{a.length - 2}</span>}</span> : null);
const D = (v: unknown) => (v == null || v === '' ? null : String(v));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const BIZ: Record<string, [string, string]> = { dagym: ['다짐', 'bg-purple-600'], hilink: ['하이링크', 'bg-blue-600'], both: ['다짐·하이링크', 'bg-blue-900'] };
const CAT_CLS: Record<string, string> = { '즉시 검토': 'bg-rose-50 text-rose-800', '협력사 필요': 'bg-amber-50 text-amber-800' };
/** 입찰 카드(영업관리 2-5, PC·휴대폰 같음): 상태 → 사업 → 분류 → 출처 → 단지·공고명 → 기관·지역·세대·업종 → 낙찰 → 공고·DB 등록(오늘 등록) → 키워드 → [전화][원문][첨부]·마감 */
function BidCard({ n, onOpen }: { n: any; onOpen?: () => void }) {
  const td = today();
  const dd = n.close ? Math.round((Date.parse(n.close) - Date.parse(td)) / 864e5) : null;
  const st = /정정/.test(String(n.status ?? '')) ? ['정정 전 공고', 'bg-slate-100 text-ink-2'] : /낙찰/.test(String(n.status ?? '')) ? ['낙찰', 'bg-emerald-50 text-emerald-800'] : /사전|예정/.test(String(n.status ?? '')) ? ['입찰 예정', 'bg-sky-50 text-sky-800']
    : /취소|마감/.test(String(n.status ?? '')) || (dd !== null && dd < 0) ? ['마감·취소', 'bg-slate-100 text-ink-3'] : dd === 0 ? [`오늘 마감 ${String(n.deadline ?? '').slice(11, 16)}`, 'bg-red-600 text-white'] : dd !== null ? [`D-${dd}`, dd <= 3 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-ink-2'] : ['진행중', 'bg-slate-100 text-ink-2'];
  const biz = n.business ? BIZ[n.business] : null;
  const cat = n.classification ?? n.category;
  return (
    <li className="rounded-card border border-line bg-white p-3 text-sm" data-testid="sales-bid">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', st[1])} data-testid="bid-status">{st[0]}</span>
        {biz && <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold text-white', biz[1])} data-testid="bid-business">{biz[0]}</span>}
        {cat && <span className={cx('hidden rounded-full px-2 py-0.5 text-[11px] font-medium md:inline', CAT_CLS[String(cat)] ?? 'bg-slate-100 text-ink-2')}>{String(cat)}</span>}
        {n.sourceLabel && <span className="hidden rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2 md:inline">{String(n.sourceLabel)}</span>}
        {n.work && chip(n.work)}
        {n.fit !== null && n.fit !== undefined && <span className="hidden text-[11px] text-ink-3 md:inline">적합 {String(n.fit)}</span>}
      </div>
      {/* 대표 검수 10/20 ②: 제목을 누르면 한국어 상세(원문은 칩으로), 예산·원문·공고문 내려받기는 휴대폰에도, 날짜 10. 25.(토) 10:00 */}
      <div className="mt-1"><button type="button" onClick={onOpen} className="text-left font-medium hover:underline" data-testid="bid-open">{n.complex && <b className="mr-1">{n.complex}</b>}{n.title}</button></div>
      <div className="mt-0.5 text-xs text-ink-2">{[n.agency, n.region, n.households && `${n.households}세대`, n.industry].filter(Boolean).join(' · ')}</div>
      {(won(n.amount) || n.winner) && <div className="mt-0.5 text-xs text-ink-2">{won(n.amount) && <>예산 {won(n.amount)}</>}{n.winner && <>{won(n.amount) ? ' · ' : ''}낙찰 {n.winner}{won(n.awardAmount) ? ` · ${won(n.awardAmount)}` : ''}{n.awardDate ? ` (${kd(n.awardDate)})` : ''}</>}</div>}
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3" data-testid="bid-dates"><span className="hidden md:inline">{[n.noticeDate && `공고 ${kd(n.noticeDate)}`, n.posted && `DB 등록 ${kd(n.posted)}`].filter(Boolean).join(' · ')}</span>{n.todayNew && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white" data-testid="bid-today">오늘 등록</span>}</div>
      {n.keywords && <div className="mt-0.5 hidden text-xs text-ink-3 md:block">키워드: {n.keywords}</div>}
      {n.judgment && <div className="mt-0.5 hidden text-xs text-ink-2 md:block">판단: {n.judgment}</div>}
      <div className="mt-1.5 flex flex-wrap items-end gap-1.5 text-xs">
        <ContactRow phone={n.phone} links={[[n.url, '원문'], [attUrl(n.attachments?.[0]), n.attachments?.length > 1 ? `공고문 내려받기 ${n.attachments.length}건` : '공고문 내려받기']]} />
        <span className="ml-auto font-medium text-ink" data-testid="bid-deadline">{n.deadline ? `마감 ${kdt(n.deadline)}` : '마감일 미확인'}</span>
      </div>
    </li>
  );
}
const UNK = <span className="text-ink-3">미확인 · 후속조사</span>;
const keyDates = (dates?: [string, unknown][]) => { const has = (dates ?? []).filter(([, v]) => D(v));
  const pick3 = [...has.filter(([k]) => /준공|세대|입주/.test(k)), ...has.filter(([k]) => !/준공|세대|입주/.test(k))].slice(0, 3);
  return pick3.map(([k, v]) => (k === '세대수' ? `${D(v)}세대` : `${k.replace('(예정)', '')} ${D(v)}`)).join(' · '); };
/** 허브 카드(영업관리 2-7 신규단지 · 2-8 준공·입주 시설 · 2-9 협력사) — 칸 순서 그대로 */
function HubCard({ tab, r, onRaw }: { tab: string; r: any; onRaw: () => void }) {
  const today0 = today();
  return (
    <div className="rounded-card border border-line bg-white p-3 text-sm" data-testid="sales-hub-item">
      {tab === 'buildings' ? (<>
        <div className="flex flex-wrap items-center gap-1.5">{r.status && chip(r.status)}{r.kind && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">{r.kind}</span>}{r.priority && !/보통|medium/i.test(r.priority) && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">{r.priority}</span>}</div>
        <button type="button" onClick={onRaw} className="mt-1 block text-left font-semibold hover:underline">{r.name}</button>
        <p className="text-xs text-ink-2">{(r.address && r.region && String(r.address).startsWith(String(r.region)) ? [r.address] : [r.region, r.address]).filter(Boolean).join(' · ')}</p>
        {/* 대표(10/19 앱): 휴대폰 카드는 값이 있는 핵심 2~3개만(준공·세대수·입주 먼저), 빈 값('미확인')은 숨김 — 전체 10칸은 PC·상세 */}
        <p className="mt-0.5 text-xs text-ink-2 md:hidden" data-testid="hub-key">{keyDates(r.dates)}</p>
        <dl className="mt-1 hidden grid-cols-2 gap-x-3 gap-y-0.5 text-xs md:grid md:grid-cols-5">{(r.dates ?? []).map(([k, v]: [string, unknown]) => <div key={k}><dt className="text-ink-3">{k}</dt><dd>{D(v) ?? UNK}</dd></div>)}</dl>
      </>) : tab === 'facilities' ? (<>
        <div className="flex flex-wrap items-center gap-1.5"><button type="button" onClick={onRaw} className="text-left font-semibold hover:underline">{r.name}</button>{r.verdict && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-800">{r.verdict}</span>}{r.contact && chip(r.contact)}</div>
        <p className="text-xs text-ink-2">{[r.lane, r.region, r.households && `${r.households}세대`, r.scale, r.operator && `현 위탁 ${r.operator}`].filter(Boolean).join(' · ')}</p>
        {r.address && <p className="hidden text-xs text-ink-3 md:block">{r.address}</p>}
        {/* 대표 검수 10/20 ②: 관리사무소 전화 → 전화·문자 줄, 앞에 '·' 가 붙던 준공·입주 줄 정리, 날짜 한국어 */}
        {r.phone ? <ContactRow phone={r.phone} className="mt-1.5" /> : <p className="mt-0.5 hidden text-xs text-ink-3 md:block">관리사무소 번호 미확인</p>}
        {r.amenities && <p className="hidden text-xs text-ink-3 md:block">부대시설: {String(r.amenities)}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3"><span>{[r.firstSeen && `DB 등록 ${kd(r.firstSeen)}`, r.date && `준공(사용승인) ${kd(r.date)}`, r.moveIn && `입주 ${kd(r.moveIn)}`].filter(Boolean).join(' · ')}</span>{r.firstSeen === today0 && <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">오늘 등록</span>}</p>
        {r.next && <p className="text-xs">다음 연락 {kd(r.next)}</p>}{r.lastNote && <p className="hidden text-xs text-ink-2 md:block">최근 기록: {r.lastNote}</p>}{r.nextAction && <p className="hidden text-xs text-ink-2 md:block">다음 조치: {r.nextAction}</p>}
      </>) : (<>
        <div className="flex flex-wrap items-center gap-1.5">{r.division && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">{r.division}</span>}<button type="button" onClick={onRaw} className="text-left font-semibold hover:underline">{r.name}</button>{r.rank && <span className="text-xs text-ink-3">{r.rank}위</span>}{r.status && chip(r.status)}</div>
        <p className="text-xs text-ink-2">{[r.open != null && `모집 공지 ${r.open === true || r.open === 'true' ? '공개' : '비공개'}`, r.period && `모집 ${r.period}`, r.requirement && `요건 ${r.requirement}`, r.cert && `공동인증서 ${r.cert}`, r.note].filter(Boolean).join(' · ') }</p>
        {r.notice && <p className="hidden text-xs md:block">공지: {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline">{r.notice}</a> : r.notice}</p>}
        {/* 대표 검수 10/20 ②: 신청·포털·홈페이지 칩은 휴대폰에도(공지 원문은 휴대폰에서 칩으로) */}
        <ContactRow links={[[r.applyUrl, '등록 신청'], [r.portalUrl, '협력사 포털'], [r.homepage, '홈페이지'], [r.url, '공지 원문']]} className="mt-1.5" />
        {(r.memo || r.next) && <p className="mt-1 text-xs text-ink-2">{[r.memo, r.next && `다음 ${kd(r.next)}`].filter(Boolean).join(' · ')}</p>}
      </>)}
    </div>
  );
}
