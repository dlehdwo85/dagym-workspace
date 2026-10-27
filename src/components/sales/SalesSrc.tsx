'use client';
import { useBackClose } from '@/components/backClose';
import { replaceUrl, useUrlState } from '@/components/urlState';
import { useSearchParams } from 'next/navigation';
import { AiAsk, AI_ASK_EXAMPLES } from '@/components/AiAsk';
import { RevenueGoal } from '@/components/marketing/RevenueGoal';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Copy, Download, ExternalLink, MessageSquare, Phone } from 'lucide-react';
import type { SearchHint } from '@/lib/sales/sourceLink';
import { api, useApi } from '@/components/client';
import { useSalesTerms, useSession } from '@/components/session';
import { Prospects } from '@/components/sales/Prospects';
import { CollectorAlerts } from '@/components/sales/Collectors';
import { BulkLeadDialog, LeadQuickDialog, StageMoveDialog, type BulkResult } from '@/components/sales/LeadFollowUp';
import { LeadImportDialog, type ImportRows } from '@/components/sales/LeadImport';
import { LeadMergeBox } from '@/components/sales/LeadMerge';
import { StageChip, useStages } from '@/components/sales/stages';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

/** V41 단계 2 영업 공간 화면(V39 B) — 옮긴 영업관리 원본, 전환일까지 읽기 전용(고치는 것은 영업관리에서, 매일 다시 가져옴) */
const C = '#2563EB';
const q = (o: Record<string, string | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
function Head({ title, meta, children }: { title: string; meta?: { syncedAt: string | null; imported: boolean; readOnly?: boolean }; children?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-bold" style={{ color: C }}>{title}</h1><span className="ml-auto flex flex-wrap gap-2">{children}</span></div>
      {meta && meta.readOnly === false ? (meta.imported ? <p className="text-[11px] text-ink-3" data-testid="sales-live">영업관리에서 옮긴 자료 · 이제 워크인에서 고칩니다(영업관리는 보기 전용)</p> : null) : meta && <p className="text-[11px] text-ink-3" data-testid="sales-readonly">{meta.imported ? `영업관리에서 옮긴 자료 · ${meta.syncedAt ? fmtDateTime(meta.syncedAt) : ''} 기준 · 전환일까지 읽기 전용(고치는 것은 영업관리에서, 매일 다시 가져옴)` : '아직 영업관리 자료를 옮기지 않았습니다(플랫폼 운영 › 영업관리 이전).'}</p>}
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
/** #543 바로 가는 공고 주소가 없는 원천(온비드·국방·LH 첫 화면, 옛 사전규격 주소) — [원문] 대신 '○○에서 공고번호 ○○ 검색' + [번호 복사] */
function SearchHintChip({ h }: { h: SearchHint }) {
  const copy = () => navigator.clipboard?.writeText(h.no).then(() => toast.ok(`${h.label}를 복사했습니다 — ${h.site}에서 붙여 넣어 검색하세요`), () => toast.error('복사하지 못했습니다'));
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-ink-2" data-testid="bid-search-hint">
      <span><a href={h.home} target="_blank" rel="noopener noreferrer" className="underline">{h.site}</a>에서 {h.label} <b className="select-all text-ink">{h.no}</b> 검색</span>
      <button type="button" onClick={copy} className={cx(linkCls, 'text-ink-2')} data-testid="bid-search-copy"><Copy className="size-3.5" aria-hidden />번호 복사</button>
    </span>
  );
}
const attUrl = (a: any) => (typeof a === 'string' ? a : a?.url ?? a?.href ?? '');
/** Meta 인스턴트 양식 기본 질문 키 → 한글(그 밖의 질문은 양식에 적힌 이름 그대로) */
const META_Q: Record<string, string> = { full_name: '이름', first_name: '이름', last_name: '성', phone_number: '전화번호', email: '이메일', city: '도시', state: '시·도', province: '시·도', country: '국가',
  zip_code: '우편번호', post_code: '우편번호', street_address: '주소', company_name: '회사명', job_title: '직함', work_email: '회사 이메일', work_phone_number: '회사 전화', date_of_birth: '생년월일', gender: '성별' };
/** 광고 2차 ①: 메타 리드 광고로 들어온 리드 — 양식·광고·신청 시각·질문 답 + [전화][문자](누르면 리드 광고 '첫 연락' 시각으로 기록) */
function MetaLeadBox({ id, raw, phone }: { id: string; raw: any; phone?: string | null }) {
  const touch = (via: 'tel' | 'sms') => { api(`/api/sales/leads/${id}/touch`, { body: { via } }).catch(() => {}); };
  const answers: { q: string; a: string }[] = Array.isArray(raw?.answers) ? raw.answers : [];
  return (
    <div className="rounded-input border border-sky-200 bg-sky-50 px-3 py-2 text-xs" data-testid="lead-meta-box">
      <div className="flex flex-wrap items-center gap-2"><b className="text-sky-900">리드 광고(메타)</b>{raw?.test && <span className="rounded-full bg-white px-1.5 text-[10px] text-ink-2">시험</span>}
        <span className="text-ink-2">{[raw?.formName && `양식 ${raw.formName}`, raw?.adName && `광고 ${raw.adName}`, raw?.createdTime && `신청 ${fmtDateTime(raw.createdTime)}`].filter(Boolean).join(' · ')}</span></div>
      {phone ? <div className="mt-1.5 flex flex-wrap gap-1.5"><a href={`tel:${digits(phone)}`} onClick={() => touch('tel')} className={linkCls} style={{ color: C }} data-testid="lead-meta-call"><Phone className="size-3.5" aria-hidden />전화 {String(phone)}</a>
        <a href={`sms:${digits(phone)}`} onClick={() => touch('sms')} className={linkCls} data-testid="lead-meta-sms"><MessageSquare className="size-3.5" aria-hidden />문자</a></div> : null}
      {answers.length > 0 && <dl className="mt-1.5 grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-3 gap-y-0.5" data-testid="lead-meta-answers">{answers.map((x, k) => [<dt key={`q${k}`} className="text-ink-3">{META_Q[String(x.q).toLowerCase()] ?? String(x.q).replace(/_/g, ' ')}</dt>,
        <dd key={`a${k}`} className="break-words">{x.a || '—'}</dd>])}</dl>}
    </div>
  );
}
/** 대표 10/21 12:00 영업 재편 1): 행마다 [영업 진행으로 넘기기] — 담당자 선택 → 리드·'영업 중'·담당 업무·일정·알림 (전화·문자 옆, 체크 선택과 별개) */
function HandoffButton({ kind, id, name, onDone, compact }: { kind: 'bid' | 'building' | 'facility' | 'vendor'; id: string; name: string; onDone?: () => void; compact?: boolean }) {
  const bid = kind === 'bid'; // 결정 15-35: 입찰은 업무로(리드 없음), 현장 영업은 영업 진행(리드)
  const [open, setOpen] = useState(false); const [sel, setSel] = useState<string[]>([]); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const people = useApi<{ people: { id: string; name: string; role: string; title: string | null }[]; me: string; suggested?: string | null }>(open ? `/api/sales/work/handoff?kind=${kind}` : (null as unknown as string), [open, kind]);
  useEffect(() => { if (people.data && !sel.length) setSel([people.data.suggested ?? people.data.me]); }, [people.data, sel.length]); // #100 원천별 담당 규칙이 있으면 그 사람이 기본
  async function go() {
    setBusy(true);
    try { const r = await api<{ leadId: string | null; taskIds: string[]; eventIds: string[]; eventErrors: string[]; due: string }>('/api/sales/work/handoff', { body: { kind, id, assigneeIds: sel, note: note || undefined } });
      const tail = `${r.eventIds.length ? ` · 일정 ${r.eventIds.length}건` : ''}${r.eventErrors.length ? ` · 일정 못 만듦 ${r.eventErrors.length}` : ''}`;
      toast.ok(bid ? `입찰 업무로 넘겼습니다 — 업무 1건(기한 ${r.due}${sel.length > 1 ? ` · 공동 담당 ${sel.length}명` : ''})${tail}` : `영업 진행으로 넘겼습니다 — 업무 ${r.taskIds.length}건(마감 ${r.due})${tail}`);
      setOpen(false); onDone?.(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (<>
    <button type="button" onClick={() => setOpen(true)} className={cx(linkCls, 'border-brand-600 text-brand-700')} data-testid="sales-handoff"><ArrowRight className="size-3.5" aria-hidden />{compact ? '넘기기' : bid ? '입찰 업무로 넘기기' : '영업 진행으로 넘기기'}</button>
    {open && <Modal open onClose={() => setOpen(false)} title={bid ? '입찰 업무로 넘기기' : '영업 진행으로 넘기기'}>
      <div className="space-y-3 text-sm" data-testid="sales-handoff-dialog">
        {bid ? <p className="text-xs text-ink-2" data-testid="sales-handoff-bid-note"><b>{name}</b> — 담당자를 고르면 입찰 업무 1건을 만듭니다(처음 고른 사람이 주 담당, 나머지는 공동 담당). 기한은 참가신청·입찰 마감에 맞춰 자동으로 바뀌고, 공고가 취소되면 업무도 함께 취소됩니다. 현장설명회·참가신청·입찰 마감·개찰 일정은 회사 캘린더에 넣고 알립니다. 리드는 만들지 않습니다.</p>
        : <p className="text-xs text-ink-2"><b>{name}</b> — 담당자를 고르면 리드를 만들고 이 건은 ‘영업 중’이 됩니다. 담당자마다 ‘검토·첫 연락’ 업무(마감 = 참가신청/입찰 마감 전날)를 만들고, 공고에 현장설명회·참가신청·개찰·마감 일정이 있으면 회사 캘린더에 넣고 알립니다.</p>}
        {!people.data ? <Skeleton rows={2} /> : <div className="flex flex-wrap gap-1.5" data-testid="sales-handoff-people">{people.data.people.map((p) => <label key={p.id} className={cx('inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs', sel.includes(p.id) ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800' : 'border-line bg-white')}>
          <input type="checkbox" className="sr-only" checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />{p.name}{p.id === people.data!.me ? ' (나)' : ''}{p.title ? <span className="text-ink-3"> {p.title}</span> : null}</label>)}</div>}
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={bid ? '메모(선택) — 입찰 업무에 남습니다' : '메모(선택) — 담당자 업무·리드에 남습니다'} aria-label="메모" maxLength={500} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>취소</Button><Button disabled={busy || !sel.length} onClick={go} data-testid="sales-handoff-go">{busy ? '넘기는 중…' : `담당 ${sel.length}명에게 넘기기`}</Button></div>
      </div>
    </Modal>}
  </>);
}
const attName = (a: any, i: number) => (typeof a === 'object' && a?.name ? String(a.name) : `공고문 ${i + 1} 내려받기`);
/** S1-4: 공공 사이트 첨부는 같은 도메인 중계(/api/bids/file, K-apt 는 /api/bids/kapt-file)로 — 앱 WebView 에서도 내려받기, 30MB·허용 사이트만 */
const FILE_HOSTS = ['g2b.go.kr', 'ebid.lh.or.kr', 'apply.lh.or.kr', 'onbid.co.kr', 'nuri.go.kr', 'd2b.go.kr', 'k-apt.go.kr', 'bizinfo.go.kr', 'k-startup.go.kr'];
/** #507 후속: f = 이름을 못 읽을 때 '<공고명 앞 30자> 첨부 n', o = 원문(웹페이지가 오면 안내 화면의 [원문 열기]), bid = K-apt 공고번호(세션 열기) */
type AttCtx = { title?: string | null; origin?: string | null; bid?: string | null };
const fileHref = (url: string, name?: string, c: AttCtx & { i?: number } = {}) => { try { const h = new URL(url).hostname.toLowerCase(); if (!FILE_HOSTS.some((d) => h === d || h.endsWith('.' + d))) return url;
  const kapt = h.endsWith('k-apt.go.kr'); const q = new URLSearchParams({ u: url }); if (name) q.set('n', name); if (c.title) q.set('f', `${c.title.slice(0, 30).trim()} 첨부 ${(c.i ?? 0) + 1}`);
  if (c.origin) q.set('o', c.origin); if (kapt && c.bid) q.set('bid', c.bid); return `${kapt ? '/api/bids/kapt-file' : '/api/bids/file'}?${q}`; } catch { return url; } };
const attHref = (a: any, i: number, c: AttCtx = {}) => fileHref(attUrl(a), typeof a === 'object' && a?.name ? String(a.name) : undefined, { ...c, i }) || attUrl(a);
/** 공고 행 → 첨부 링크 맥락(공고명·원문·K-apt 공고번호) */
const bidCtx = (n: any): AttCtx => ({ title: `${n.complex ? `${n.complex} ` : ''}${n.title ?? ''}`.trim() || null, origin: n.url ?? null, bid: String(n.source ?? '') === 'kapt_bid' ? String(n.noticeNo ?? '') || null : null });
const UNK2 = '후속조사 필요';
/** 한국어 칸 표(값 없는 칸은 숨김) */
function KoDl({ rows, testId }: { rows: [string, React.ReactNode][]; testId?: string }) {
  const R = rows.filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false);
  return <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-sm" data-testid={testId}>{R.map(([k, v]) => [<dt key={k} className="text-ink-3">{k}</dt>, <dd key={k + ':v'} className="min-w-0 whitespace-pre-wrap break-words">{typeof v === 'string' || typeof v === 'number' ? String(v) : v}</dd>])}</dl>;
}
/* S1-2(로컬 10/20 최우선): 진행 기록 쓰기 — 원본 영업관리 상태 버튼 그대로(입찰·신규단지 2-10 / 시설 2-8 / 협력사 2-9) + 메모·다음 연락일 + [진행영업으로 넘기기](비슷한 리드 확인). 전환 전(readOnly)에는 안 보임 */
const WORK_STATUS: Record<string, string[]> = { bid: ['미검토', '검토중', '연락중', '보류', '미참여', '대상아님'], building: ['미검토', '검토중', '연락중', '보류', '대상아님'], facility: ['미연락', '연락중', '영업완료', '대상아님'], vendor: ['미등록', '신청 준비', '신청 완료', '등록 완료', '대상 아님'] };
const DONE_STATUS = new Set(['미참여', '대상아님', '영업완료', '등록 완료', '대상 아님']);
/** 대표 10/24 추가 ②: '대상 아님' — 사유(선택)를 묻고 넘김, 입찰은 모든 목록·당일 메일에서 빠지고 [대상 아님] 탭에만, [되돌리기] = 넘기기 전 상태 */
const SKIP_ST = /^대상\s?아님$/;
function WorkPanel({ kind, id, cur, onSaved }: { kind: 'bid' | 'building' | 'facility' | 'vendor'; id: string; cur: { status?: string | null; memo?: string | null; next?: string | null; leadId?: string | null }; onSaved: () => void }) {
  const [status, setStatus] = useState<string>(cur.status ?? WORK_STATUS[kind][0]);
  const [memo, setMemo] = useState(cur.memo ?? ''); const [next, setNext] = useState(cur.next ?? ''); const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<{ id: string; name: string; status: string | null }[] | null>(null);
  const [ask, setAsk] = useState<string | null>(null); const [why, setWhy] = useState(''); // 대표 10/24 추가 ②: '대상 아님' 사유(선택)
  const converted = cur.status === '진행영업 전환' || !!cur.leadId;
  async function save(st = status, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try { const r = await api<{ status: string }>('/api/sales/work', { body: { kind, id, status: st, memo: memo.trim() || null, nextDate: next || null, ...extra } }); setStatus(r.status);
      toast.ok(kind === 'bid' && SKIP_ST.test(r.status) && !SKIP_ST.test(status) ? '대상 아님으로 넘겼습니다 — 목록·당일 메일에서 빠지고 [대상 아님] 탭에서 볼 수 있습니다' : DONE_STATUS.has(st) ? '완료 목록으로 옮깁니다' : '저장했습니다'); onSaved(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function restore() {
    setBusy(true);
    try { const r = await api<{ status: string }>('/api/sales/work', { body: { kind, id, restore: true } }); setStatus(r.status); toast.ok(`되돌렸습니다 — '${r.status}'`); onSaved(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
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
        <button key={s} type="button" disabled={busy} onClick={() => { if (SKIP_ST.test(s) && !SKIP_ST.test(status)) { setAsk(s); return; } setStatus(s); void save(s); }} className={cx('rounded-full border px-2.5 py-1 text-xs', status === s ? 'border-transparent text-white' : 'border-line bg-white', DONE_STATUS.has(s) && status !== s && 'text-ink-3')} style={status === s ? { background: C } : undefined} data-testid={`work-status-${s}`}>{s}</button>))}</div>
      {ask && <div className="flex flex-wrap items-center gap-1.5 rounded-input border border-line bg-white p-2" data-testid="work-skip-ask">
        <input className={cx(inputCls, 'h-8 min-w-0 flex-1 py-1 text-xs')} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} placeholder="사유(선택) — 예: 취소 공고 확인, 우리 업종 아님" aria-label="대상 아님 사유" data-testid="work-skip-reason" />
        <Button size="sm" disabled={busy} onClick={() => { const s = ask; setAsk(null); setStatus(s); void save(s, { reason: why.trim() || null }); setWhy(''); }} data-testid="work-skip-go">대상 아님으로 넘기기</Button>
        <Button size="sm" variant="ghost" onClick={() => setAsk(null)}>취소</Button></div>}
      {SKIP_ST.test(status) && <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2" data-testid="work-skipped">{kind === 'bid' ? '목록·당일 메일에서 빠진 공고입니다' : '대상 아님으로 넘긴 건입니다'}<Button size="sm" variant="secondary" disabled={busy} onClick={restore} data-testid="work-restore">되돌리기</Button></div>}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <textarea className={cx(inputCls, 'min-h-[60px]')} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={2000} placeholder="메모 (처음 메모를 남기면 검토중으로)" aria-label="진행 메모" data-testid="work-memo" />
        <div className="flex flex-col gap-1.5"><input type="date" className={cx(inputCls, 'h-9')} value={next} onChange={(e) => setNext(e.target.value)} aria-label="다음 연락일" data-testid="work-next" />
          <Button size="sm" onClick={() => save()} disabled={busy} data-testid="work-save">저장</Button></div>
      </div>
      {kind !== 'bid' ? <div className="flex flex-wrap items-center gap-2 border-t border-blue-100 pt-2">
        <Button size="sm" variant="secondary" onClick={() => convert(false)} disabled={busy} data-testid="work-convert">진행영업으로 넘기기</Button>
        <span className="text-[11px] text-ink-3">리드를 만들고 이 건을 연결합니다 (이름이 비슷한 거래처가 있으면 먼저 보여 줌)</span>
      </div> : <p className="border-t border-blue-100 pt-2 text-[11px] text-ink-3" data-testid="work-bid-note">입찰 공고는 리드로 넘기지 않고 카드의 [넘기기]로 입찰 업무를 만듭니다(기한·취소·결과가 공고를 따라감).</p>}
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
/** S2 2차(감사 1-16): 제안 = 제목·버전·제안금액·최종금액·월 운영비·제안일·계약 예상일·상태·사업·메모 / 계약 = 제목·금액·계약일·시작·종료·PM·재계약 단계·상태·사업·메모 */
const REC_EMPTY = { leadId: '', title: '', amount: '', date: '', memo: '', version: 'v1', finalAmount: '', monthlyFee: '', expectedContractDate: '', startDate: '', endDate: '', pm: '', renewStage: '', business: '', status: '' };
const PROPOSAL_STATUS = ['제안', '검토중', '수정 요청', '채택', '탈락'];
const CONTRACT_STATUS = ['계약', '진행중', '종료', '해지'];
const RENEW_STAGE = ['영업 전', '영업 시작', '제안', '재입찰', '종료'];
const numOf = (v: string) => (v.trim() ? Number(v.replace(/[,\s원]/g, '')) : null);
function RecordForm({ kind, leads, onSaved, leadId }: { kind: 'proposals' | 'contracts'; leads: { id: string; name: string }[]; onSaved: () => void; leadId?: string }) {
  const T = useSalesTerms(); // #408 업종 템플릿 예시 문구
  const [f, setF] = useState({ ...REC_EMPTY, leadId: leadId ?? '' }); const [busy, setBusy] = useState(false); const [more, setMore] = useState(false);
  const set = (k: keyof typeof REC_EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!f.leadId || !f.title.trim()) return; setBusy(true);
    const base = { kind, title: f.title.trim(), amount: numOf(f.amount), date: f.date || null, memo: f.memo || undefined, status: f.status || undefined, business: f.business || undefined };
    const body = kind === 'proposals' ? { ...base, version: f.version || undefined, finalAmount: numOf(f.finalAmount), monthlyFee: numOf(f.monthlyFee), expectedContractDate: f.expectedContractDate || null }
      : { ...base, startDate: f.startDate || null, endDate: f.endDate || null, pm: f.pm || undefined, renewStage: f.renewStage || undefined };
    try { await api(`/api/sales/leads/${f.leadId}/records`, { body }); toast.ok('등록했습니다'); setF({ ...REC_EMPTY, leadId: leadId ?? '' }); onSaved(); } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  const P = kind === 'proposals';
  return (
    <form onSubmit={submit} className="grid gap-2 rounded-input border border-blue-200 bg-blue-50/40 p-3 text-sm" data-testid={`record-form-${kind}`}>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem_9rem_auto]">
        {leadId ? null : <select className={inputCls} value={f.leadId} onChange={set('leadId')} aria-label="거래처(리드)" required data-testid="record-lead"><option value="">거래처(리드) 고르기</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
        <input className={inputCls} value={f.title} onChange={set('title')} placeholder={P ? '제안·견적 제목' : '계약 제목'} maxLength={300} required aria-label="제목" data-testid="record-title" />
        <input className={inputCls} value={f.amount} onChange={set('amount')} placeholder={P ? '제안 금액(원)' : '계약 금액(원)'} inputMode="numeric" aria-label="금액" data-testid="record-amount" />
        <input type="date" className={inputCls} value={f.date} onChange={set('date')} aria-label={P ? '제안일' : '계약일'} />
        <div className="flex gap-1"><Button size="sm" disabled={busy || !f.leadId || !f.title.trim()} data-testid="record-save">{P ? '제안 등록' : '계약 등록'}</Button><Button type="button" size="sm" variant="secondary" onClick={() => setMore(!more)} data-testid="record-more">{more ? '간단히' : '칸 더'}</Button></div>
      </div>
      {more && <div className="grid gap-2 sm:grid-cols-4" data-testid="record-more-fields">
        {P ? <>
          <Field label="버전"><input className={inputCls} value={f.version} onChange={set('version')} maxLength={20} aria-label="버전" /></Field>
          <Field label="최종 금액(원)"><input className={inputCls} value={f.finalAmount} onChange={set('finalAmount')} inputMode="numeric" aria-label="최종 금액" data-testid="record-final" /></Field>
          <Field label="월 운영비(원)"><input className={inputCls} value={f.monthlyFee} onChange={set('monthlyFee')} inputMode="numeric" aria-label="월 운영비" /></Field>
          <Field label="계약 예상일"><input type="date" className={inputCls} value={f.expectedContractDate} onChange={set('expectedContractDate')} aria-label="계약 예상일" /></Field>
        </> : <>
          <Field label="시작일"><input type="date" className={inputCls} value={f.startDate} onChange={set('startDate')} aria-label="시작일" /></Field>
          <Field label="종료일"><input type="date" className={inputCls} value={f.endDate} onChange={set('endDate')} aria-label="종료일" data-testid="record-end" /></Field>
          <Field label="PM(담당)"><input className={inputCls} value={f.pm} onChange={set('pm')} maxLength={60} aria-label="PM" /></Field>
          <Field label="재계약 단계"><select className={inputCls} value={f.renewStage} onChange={set('renewStage')} aria-label="재계약 단계"><option value="">—</option>{RENEW_STAGE.map((x) => <option key={x}>{x}</option>)}</select></Field>
        </>}
        <Field label="상태"><select className={inputCls} value={f.status} onChange={set('status')} aria-label="상태">{(P ? PROPOSAL_STATUS : CONTRACT_STATUS).map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="사업"><input className={inputCls} value={f.business} onChange={set('business')} maxLength={60} placeholder={T.examples.business} aria-label="사업" /></Field>
        <Field label="메모" className="sm:col-span-2"><input className={inputCls} value={f.memo} onChange={set('memo')} maxLength={2000} aria-label="메모" /></Field>
      </div>}
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
  const T = useSalesTerms(); // #408 업종 중립 문구 — 메뉴·타일·묶음 이름은 회사 업종 템플릿
  const { data, error, reload } = useApi<any>('/api/sales/src?view=summary');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  const k = data.kpi;
  const bids = data.bidsOn !== false; // 입찰·공고 끈 회사는 입찰 카드 숨김
  const cards: [string, number, string][] = [['리드', k.leads, '/s/sales/leads'], ['7일 안 연락', k.dueSoon, '/s/sales/leads'], ['연락 지남', k.overdue, '/s/sales/leads'],
    ...(bids ? [['진행 중 입찰', k.bidsOpen ?? k.bidsWorking, '/s/sales/hub?tab=bids&bt=open'], ['작업 중 입찰', k.bidsWorking, '/s/sales/hub?tab=bids&bt=working'], ['관련 공고', k.relatedNotices, '/s/sales/hub?tab=bids&bt=all'], ['최근 7일 공고(공고일)', k.newNotices7d, '/s/sales/hub?tab=bids&bt=all']] as [string, number, string][] : []),
    ...(data.support ? [['마감 임박 지원사업', data.support.closing, '/s/sales/support?tab=closing']] as [string, number, string][] : [])]; // #450 7일 안 마감(관심·준비 + 맞춤)
  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="space-home-sales">
      <Head title="워크인 · 영업" meta={data} />
      {/* #522 영업 DB 누락 점검: 원천이 24시간 넘게 성공 없음·2회 연속 실패 */}
      {!!data.collectorAlerts?.length && <CollectorAlerts alerts={data.collectorAlerts} link />}
      {data.setupNeeded && (
        <section className="rounded-card border-2 border-[#93C5FD] bg-[#EFF6FF] p-4" data-testid="sales-setup-prompt">
          <h2 className="text-base font-bold text-[#1D4ED8]">영업 출처부터 고르세요</h2>
          <p className="mt-1 text-sm text-ink-2">회사 업종·지역·주력 상품을 보고 AI 가 맞는 출처(공공데이터·입찰 등)를 근거와 함께 추천합니다. 체크로 고르고, 목록 밖 사이트·키워드·엑셀도 직접 넣을 수 있어요.</p>
          <Link href="/s/sales/sources" className="mt-2 inline-block rounded-input bg-[#2563EB] px-4 py-2 text-sm font-medium text-white" data-testid="sales-setup-go">출처 추천받기</Link>
          {/* #408 온보딩 업종 템플릿: 업종을 고르면 영업 화면 용어가 따라옴 — 데이터 설정에서 바꿀 수 있음 */}
          <p className="mt-2 text-xs text-ink-2" data-testid="sales-setup-template">업종 템플릿: <b>{T.label}</b> — 화면 용어({T.kind.building}·{T.kind.facility}·{T.kind.vendor})를 업종에 맞춥니다. <Link href="/s/sales/sources#template" className={linkCls}>바꾸기</Link></p>
        </section>)}
      {/* #647(대표 10/25 22:20): 앱에서 지원사업이 잘 안 보여서 — 홈 상단 고정 카드 '이번 주 맞는 지원사업 n건'(7일 안 마감 맞춤) + 허브 '지원사업' 탭 */}
      {data.support && <Link href="/s/sales/support?tab=fit" className="flex items-center gap-3 rounded-card border-2 border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 shadow-card hover:border-blue-400" data-testid="sales-support-pin">
        <div className="min-w-0 flex-1"><div className="text-sm font-semibold text-[#1D4ED8]">이번 주 맞는 지원사업 <span className="text-lg tabular-nums" data-testid="sales-support-pin-n">{data.support.fit}</span>건</div>
          <div className="truncate text-[11px] text-ink-2">7일 안 마감 기준 · 신청할 수 있는 맞춤 {data.support.fitOpen ?? 0}건 · 관심·준비 중 {data.support.mineOpen ?? data.support.mine}건{data.support.pending ? ` · AI 확인 중 ${data.support.pending}건` : ''}</div></div>
        <span className="shrink-0 text-xs font-medium text-[#1D4ED8]">지원사업 보기 →</span>
      </Link>}
      {data.today && <TodayRow date={data.today.date} cards={[
        ...(bids ? [['오늘 새 공고', data.today.newNotices, '/s/sales/hub?tab=bids&sub=today'] as [string, number, string]] : []), // #537 영업기회 › 입찰 › 오늘 새 공고
        ['오늘 새 영업 DB', data.today.newDb.buildings + data.today.newDb.facilities + data.today.newDb.vendors, `/s/sales/hub?day=today&tab=${data.today.newDb.facilities >= data.today.newDb.buildings && data.today.newDb.facilities >= data.today.newDb.vendors ? 'facilities' : data.today.newDb.vendors > data.today.newDb.buildings ? 'vendors' : 'buildings'}`,
          `${T.kind.building} ${data.today.newDb.buildings} · ${T.kind.facility} ${data.today.newDb.facilities} · ${T.kind.vendor} ${data.today.newDb.vendors}`],
        ['오늘 연락할 리드', data.today.contact, '/s/sales/leads?day=today'],
        ...(bids ? [['오늘 마감 입찰', data.today.closing, '/s/sales/hub?tab=bids&bt=closing'] as [string, number, string]] : [])]} />}
      {/* 대표 10/20 20:00 ③ 월 매출 목표 vs 실적(계약 등록 금액) — 마케팅 홈과 같은 막대 */}
      <RevenueGoal color={C} canEdit={!!data.canEdit} />
      {/* S2-5 오늘 할 일 7묶음(영업관리 2-2) — 업무 공간과 같은 업무 표(자동 업무 포함), 누르면 그 화면으로 */}
      {data.todo && <TodoGroups todo={data.todo} bids={bids} />}
      {/* S2-6 영업기회 요약 타일 6 + 목록별 진행 현황표 */}
      {data.tiles && <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="sales-tiles">
        <h2 className="mb-2 text-sm font-semibold">영업기회 요약</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 text-center">{([['지금 영업할 곳', data.tiles.nowSales, '/s/sales/hub?tab=bids&bt=working'], ...(bids ? [['진행 중 입찰', data.tiles.bidsOpen, '/s/sales/hub?tab=bids&bt=open'], ['계약만료·재입찰', data.tiles.contracts, '/s/sales/contracts']] : []), [T.kind.building, data.tiles.buildings, '/s/sales/hub?tab=buildings'], [T.facilitiesTab, data.tiles.facilities, '/s/sales/hub?tab=facilities'], [T.vendorsTab, data.tiles.vendors, '/s/sales/hub?tab=vendors']] as [string, number, string][]).map(([l, n, h]) => (
          <Link key={l} href={h} className="rounded-input border border-line p-2 hover:border-blue-300" data-testid="sales-tile"><div className="text-[11px] text-ink-2">{l}</div><div className="text-lg font-bold tabular-nums" style={{ color: C }}>{n}</div></Link>))}</div>
        {data.progress && <div className="mt-2 hidden overflow-x-auto md:block" data-testid="sales-progress"><table className="w-full text-xs"><thead><tr className="text-left text-ink-3"><th className="py-1 pr-2">목록</th>{PROG_COLS.map((c) => <th key={c} className="py-1 pr-2 text-right">{c}</th>)}</tr></thead>
          <tbody>{(data.progress as [string, Record<string, number>][]).map(([name, m]) => <tr key={name} className="border-t border-line"><td className="py-1 pr-2 font-medium">{name}</td>{PROG_COLS.map((c) => <td key={c} className="py-1 pr-2 text-right tabular-nums">{Object.entries(m).filter(([k]) => PROG_MATCH[c].test(k)).reduce((a, [, v]) => a + v, 0) || ''}</td>)}</tr>)}</tbody></table></div>}
      </section>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{cards.map(([l, n, h]) => (
        <Link key={l} href={h} className="rounded-card border border-line bg-white p-3 shadow-card hover:border-blue-300" data-testid={l === '마감 임박 지원사업' ? 'sales-kpi-support' : 'sales-kpi'}><div className="text-xs text-ink-2">{l}</div><div className={cx('mt-1 text-2xl font-bold tabular-nums', l === '연락 지남' && n ? 'text-red-600' : '')} style={l === '연락 지남' && n ? undefined : { color: C }}>{n}</div>
          {l === '마감 임박 지원사업' && data.support && <div className="truncate text-[11px] text-ink-3">관심·준비 {data.support.mine} · 맞춤 {data.support.fit}</div>}</Link>))}</div>
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

const PROG_COLS = ['미검토·미연락', '검토중', '연락중', '신청', '보류', '완료·전환', '대상아님'];
const PROG_MATCH: Record<string, RegExp> = { '미검토·미연락': /미검토|미연락|미등록/, '검토중': /검토중/, '연락중': /연락중/, '신청': /신청/, '보류': /보류/, '완료·전환': /완료|전환/, '대상아님': /대상|미참여/ };
/** #408: 묶음 이름은 회사 업종 템플릿(terms.todo) */
const todoGroups = (T: ReturnType<typeof useSalesTerms>): [string, string, string][] => [['followUp', T.todo.followUp, '후속 기한이 오늘이거나 지난 건'], ['facilities', T.todo.facilities, `다음 연락일이 오늘이거나 지난 ${T.kind.facility}`], ['vendors', T.todo.vendors, '등록 신청 기한'],
  ['pastTasks', '지난 영업 업무', '마감이 지난 영업 업무(자동 업무 포함)'], ['nowSales', '지금 영업할 곳 상위 5', '작업 중 입찰, 마감 임박순'], ['leads', '리드 연락', '연락 지남·오늘 연락'], ['closingSoon', '입찰 오늘·내일 마감', '즉시 검토·검토중·연락중']];
/** S2-5 오늘 할 일 7묶음 — 묶음마다 건수·목록(5개 접힘), [순서대로 시작]은 첫 항목으로 */
function TodoGroups({ todo, bids }: { todo: Record<string, any[]>; bids: boolean }) {
  const [openK, setOpenK] = useState<string | null>(null); const T = useSalesTerms();
  const groups = todoGroups(T).filter(([k]) => bids || !['nowSales', 'closingSoon'].includes(k));
  const total = groups.reduce((n, [k]) => n + (todo[k]?.length ?? 0), 0);
  const first = groups.map(([k]) => todo[k]?.[0]).find(Boolean);
  const hrefOf = (x: any) => (x.sales_ref || x.title ? `/tasks/${x.id}` : x.href);
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="sales-todo">
      <div className="mb-2 flex items-center gap-2"><h2 className="text-sm font-semibold">오늘 할 일 <span className="font-normal text-ink-3">{total}건</span></h2>
        {first && <Link href={hrefOf(first)} className="ml-auto rounded-input px-2.5 py-1 text-xs font-medium text-white" style={{ background: C }} data-testid="sales-todo-start">순서대로 시작 →</Link>}</div>
      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">{groups.map(([k, label, hint]) => { const items: any[] = todo[k] ?? []; const open = openK === k;
        return <li key={k} className={cx('rounded-input border p-2', items.length ? 'border-line' : 'border-dashed border-line/70 text-ink-3')} data-testid={`sales-todo-${k}`}>
          <button type="button" className="flex w-full items-center gap-1.5 text-left text-sm" onClick={() => setOpenK(open ? null : k)} title={hint} aria-expanded={open}><span className="min-w-0 flex-1 truncate">{label}</span><b className={cx('tabular-nums', items.length ? '' : 'font-normal')} style={items.length ? { color: C } : undefined}>{items.length}</b></button>
          {open && items.length > 0 && <ul className="mt-1.5 space-y-1 border-t border-line pt-1.5 text-xs">{items.slice(0, 8).map((x: any) => <li key={x.id} className="flex items-center gap-1.5"><Link href={hrefOf(x)} className="min-w-0 flex-1 truncate hover:underline">{x.name ?? x.title}</Link>{(x.status) && chip(x.status)}<span className="shrink-0 tabular-nums text-ink-3">{kd(x.next ?? x.due_date)}{x.memo ? ` ${x.memo}` : ''}</span></li>)}
            {items.length > 8 && <li className="text-ink-3">외 {items.length - 8}건</li>}</ul>}
        </li>; })}</ul>
    </section>
  );
}
/** S2-6 계약만료·재입찰(영업관리 2-6): 타 업체 계약 종료일 역산 — 영업 시작(−12/−9개월)·제안(−6)·재입찰(−3), 단계 5, 요약 4, 표 */
export function Contracts() {
  const [s, setS] = useUrlState('cq', ''); const [stage, setStage] = useUrlState('cs', ''); // #242 2단계: 검색어·단계는 주소에(허브 안에서도 겹치지 않게 cq·cs)
  const { data, error, reload } = useApi<any>(`/api/sales/src?${q({ view: 'contracts', q: s })}`, [s]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  const items: any[] = (data?.items ?? []).filter((x: any) => !stage || x.stage === stage);
  return (
    <div className="space-y-3" data-testid="sales-contracts">
      <Head title="계약만료·재입찰" meta={data}><Search value={s} onChange={setS} /></Head>
      {!data ? <Skeleton rows={5} /> : <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{([['90일 내 종료', data.summary.d90], ['180일 내', data.summary.d180], ['365일 내', data.summary.d365], ['이미 지남', data.summary.past]] as [string, number][]).map(([l, n]) => <div key={l} className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="contracts-kpi"><div className="text-xs text-ink-2">{l}</div><div className="text-2xl font-bold tabular-nums" style={{ color: C }}>{n}</div></div>)}</div>
        <div className="flex flex-wrap gap-1.5">{[['', `전체 ${data.items.length}`], ...(data.stages as [string, number][]).map(([k, n]) => [k, `${k} ${n}`])].map(([k, l]) => <button key={k} type="button" onClick={() => setStage(k)} className={cx('rounded-full border px-3 py-1 text-xs', stage === k ? 'border-transparent text-white' : 'border-line bg-white')} style={stage === k ? { background: C } : undefined} data-testid={`contracts-stage-${k || 'all'}`}>{l}</button>)}</div>
        <p className="text-xs text-ink-3">타 업체 계약 종료일에서 역산: 영업 시작 = 12·9개월 전 · 제안 = 6개월 전 · 재입찰 = 3개월 전. 공고에 계약 종료일 칸이 있는 건만 나옵니다.</p>
        <ul className="space-y-1.5">{items.map((x: any) => <li key={x.id} className="rounded-card border border-line bg-white p-3 text-sm" data-testid="contracts-item">
          <div className="flex flex-wrap items-center gap-1.5">{chip(x.stage)}<Link href={x.href} className="font-semibold hover:underline">{x.name}</Link>{x.work && <span className="text-[11px] text-ink-2">진행 {x.work}</span>}<span className={cx('ml-auto text-xs tabular-nums', x.daysLeft < 0 ? 'text-ink-3' : x.daysLeft <= 90 ? 'font-semibold text-red-600' : 'text-ink-2')}>종료 {kd(x.end)}{x.daysLeft >= 0 ? ` (D-${x.daysLeft})` : ' (지남)'}</span></div>
          <p className="mt-0.5 text-xs text-ink-2">{[x.agency, x.region, x.winner && `현 업체 ${x.winner}`, won(x.amount)].filter(Boolean).join(' · ')}</p>
          <p className="mt-0.5 hidden text-xs text-ink-3 md:block">영업 시작 {kd(x.start)} · {kd(x.start2)} → 제안 {kd(x.propose)} → 재입찰 {kd(x.rebid)}</p>
        </li>)}{!items.length && <li className="text-sm text-ink-3">해당 공고가 없습니다</li>}</ul>
      </>}
    </div>
  );
}
/** 대표 10/20 14:15 ④ 일괄: 체크한 건을 한 번에 '영업 진행(연락중)' 등으로 → 업무 n건 */
function BulkBar({ kind, ids, onDone, onClear }: { kind: 'bid' | 'building' | 'facility' | 'vendor'; ids: string[]; onDone: () => void; onClear: () => void }) {
  const [busy, setBusy] = useState(false); const [next, setNext] = useState('');
  const progress = kind === 'facility' ? '연락중' : kind === 'vendor' ? '신청 준비' : '연락중';
  async function go(status: string) {
    setBusy(true);
    try { const r = await api<{ tasks: number; results: { ok: boolean }[] }>('/api/sales/work/bulk', { body: { kind, ids, status, nextDate: next || null } }); toast.ok(`${r.results.filter((x) => x.ok).length}건을 '${status}'(으)로 — 업무 ${r.tasks}건 만들었습니다`); onDone(); onClear(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (!ids.length) return null;
  return (
    <div className="sticky bottom-[calc(4rem+var(--sab))] z-20 flex flex-wrap items-center gap-2 rounded-card border border-blue-200 bg-blue-50 p-2 text-sm shadow-pop sm:bottom-2" data-testid="sales-bulk">
      <b>{ids.length}건 선택</b>
      <input type="date" className={cx(inputCls, 'h-8 !w-auto')} value={next} onChange={(e) => setNext(e.target.value)} aria-label="다음 연락일" />
      <Button size="sm" disabled={busy} onClick={() => go(progress)} data-testid="sales-bulk-go">영업 진행으로({progress}) · 업무 만들기</Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => go(kind === 'facility' || kind === 'vendor' ? '대상아님' : '대상아님')}>대상아님</Button>
      <button type="button" className="text-xs text-ink-2 underline" onClick={onClear}>선택 해제</button>
    </div>
  );
}
/** 전환 뒤: 단계(보류·실패는 사유 필수)·다음 연락일·메모·담당(관리자) 고치기 + 상담 기록 추가 */
function LeadEdit({ id, data, onSaved }: { id: string; data: any; onSaved: () => void }) {
  const l = data.lead; const ST = useStages(); // 207차: 단계 이름은 회사 설정
  const [f, setF] = useState({ status: l.status ?? '신규리드', reason: '', next: l.next ?? '', memo: l.memo ?? '', owner: l.ownerId ?? '',
    facility: l.facility ?? '', region: l.region ?? '', scale: l.scale ?? '', revenue: l.revenue ? String(l.revenue) : '', contact: l.contact ?? '', phone: l.phone ?? '', email: l.email ?? '', homepage: l.homepage ?? '', biz: l.bizNo ?? '' });
  const needReason = (f.status === '보류' || f.status === '실패') && f.status !== l.status;
  const S = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    try { await api(`/api/sales/leads/${id}`, { method: 'PATCH', body: { ...(f.status !== l.status ? { status: f.status, reason: f.reason || undefined } : {}), nextContactDate: f.next || null, memo: f.memo || null, ...(data.canAssign && f.owner !== (l.ownerId ?? '') ? { ownerId: f.owner || null } : {}),
      facilityType: f.facility || null, region: f.region || null, scale: f.scale || null, expectedRevenue: numOf(f.revenue), contactName: f.contact || null, phone: f.phone || null, email: f.email || null, homepage: f.homepage || null, bizNo: f.biz || null } });
      toast.ok('저장했습니다'); setF({ ...f, reason: '' }); onSaved(); } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="space-y-2 rounded-input border border-blue-200 bg-blue-50/40 p-3 text-sm" data-testid="sales-lead-edit">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="단계"><select className={inputCls} value={f.status} onChange={S('status')} aria-label="단계" data-testid="lead-status">{ST.pickable(data.stages, l.status).map((s: string) => <option key={s} value={s}>{ST.name(s)}</option>)}</select></Field>
        <Field label="다음 연락일"><input type="date" className={inputCls} value={f.next} onChange={S('next')} aria-label="다음 연락일" data-testid="lead-next" /></Field>
        {data.canAssign && <Field label="담당"><select className={inputCls} value={f.owner} onChange={S('owner')} aria-label="담당" data-testid="lead-owner"><option value="">없음</option>{data.people.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
      </div>
      {needReason && <Field label={`${ST.name(f.status)} 사유(필수)`}><input className={inputCls} value={f.reason} onChange={S('reason')} maxLength={500} aria-label="사유" data-testid="lead-reason" /></Field>}
      {/* S2 2차(감사 1-13): 리드 폼 칸 — 시설·지역·규모·예상매출·고객 담당자·연락처·이메일·홈페이지 */}
      <details className="rounded-input border border-blue-100 bg-white/60 p-2" data-testid="lead-info-edit"><summary className="cursor-pointer text-xs text-ink-2">정보 수정 — 시설·지역·규모·예상매출·연락처·이메일·홈페이지·사업자번호</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <Field label="시설 유형"><input className={inputCls} value={f.facility} onChange={S('facility')} maxLength={100} aria-label="시설 유형" data-testid="lead-facility" /></Field>
          <Field label="지역"><input className={inputCls} value={f.region} onChange={S('region')} maxLength={50} aria-label="지역" /></Field>
          <Field label="규모"><input className={inputCls} value={f.scale} onChange={S('scale')} maxLength={60} placeholder="예: 1,200세대" aria-label="규모" data-testid="lead-scale" /></Field>
          <Field label="예상매출(원)"><input className={inputCls} value={f.revenue} onChange={S('revenue')} inputMode="numeric" aria-label="예상매출" data-testid="lead-revenue" /></Field>
          <Field label="고객 담당자"><input className={inputCls} value={f.contact} onChange={S('contact')} maxLength={100} aria-label="고객 담당자" /></Field>
          <Field label="연락처"><input className={inputCls} value={f.phone} onChange={S('phone')} maxLength={40} inputMode="tel" aria-label="연락처" /></Field>
          <Field label="이메일"><input className={inputCls} value={f.email} onChange={S('email')} maxLength={200} inputMode="email" aria-label="이메일" data-testid="lead-email" /></Field>
          <Field label="홈페이지"><input className={inputCls} value={f.homepage} onChange={S('homepage')} maxLength={300} inputMode="url" aria-label="홈페이지" /></Field>
          <Field label="사업자번호"><input className={inputCls} value={f.biz} onChange={S('biz')} maxLength={20} inputMode="numeric" placeholder="123-45-67890" aria-label="사업자번호" data-testid="lead-biz" /></Field>
        </div></details>
      <Field label="메모"><textarea className={inputCls} rows={2} value={f.memo} onChange={S('memo')} maxLength={5000} aria-label="메모" /></Field>
      <div className="flex justify-end"><Button size="sm" onClick={save} disabled={needReason && !f.reason.trim()} data-testid="lead-save">저장</Button></div>
      {!!data.statusLog?.length && <ul className="space-y-0.5 text-[11px] text-ink-2">{data.statusLog.map((g: any, i: number) => <li key={i}>{fmtDateTime(g.changed_at)} · {g.by ?? ''} · {g.from_status ? ST.name(g.from_status) : '—'} → {ST.name(g.to_status)}{g.reason ? ` (${g.reason})` : ''}</li>)}</ul>}
    </div>
  );
}

const TL_ICON: Record<string, string> = { act: '💬', status: '🔁', task: '✅', proposal: '📄', contract: '🤝', event: '📅', comment: '🗨️', file: '📎' };
/** 197차(#460): 타임라인 종류 거르기 — 업무 댓글·첨부도 거래처 이력에 */
const TL_KINDS: [string, string, string[]][] = [['', '전체', []], ['act', '상담', ['act']], ['task', '업무', ['task', 'comment', 'file']], ['status', '단계', ['status']], ['event', '일정', ['event']], ['deal', '제안·계약', ['proposal', 'contract']]];
function LeadTimeline({ items }: { items: any[] }) {
  const [k, setK] = useState('');
  const kinds = TL_KINDS.find(([x]) => x === k)?.[2] ?? [];
  const shown = kinds.length ? items.filter((x) => kinds.includes(x.kind)) : items;
  return (
    <div className="space-y-2" data-testid="lead-timeline-box">
      <div className="flex flex-wrap gap-1 text-xs" role="group" aria-label="종류">{TL_KINDS.map(([x, lb, ks]) => { const n = ks.length ? items.filter((y) => ks.includes(y.kind)).length : items.length; return <button key={x} type="button" onClick={() => setK(x)} className={chipCls(k === x)} aria-pressed={k === x} data-testid={`lead-tl-kind-${x || 'all'}`}>{lb} {n}</button>; })}</div>
      <ol className="space-y-1.5 text-sm" data-testid="lead-timeline">{shown.map((x: any) => <li key={x.kind + x.id} className="flex gap-2 rounded-input border border-line p-2" data-testid={`lead-tl-${x.kind}`}><span aria-hidden>{TL_ICON[x.kind] ?? '•'}</span><span className="min-w-0 flex-1">{x.href ? <Link href={x.href} className="underline">{x.title}</Link> : x.title}{x.task && <span className="ml-1 text-xs text-ink-3">· {x.task}</span>}{x.by && <span className="ml-1 text-xs text-ink-3">{x.by}</span>}</span><span className="shrink-0 text-xs tabular-nums text-ink-3">{kdt(x.at)}</span></li>)}{!shown.length && <li className="text-xs text-ink-3">아직 기록이 없습니다</li>}</ol>
    </div>
  );
}
/** S2 2차: 업무 탭 — 워크인 업무(lead_id) 목록 + 추가, 아래에 옮겨 온 원본 업무 */
function LeadTasks({ id, data, onSaved }: { id: string; data: any; onSaved: () => void }) {
  const [t, setT] = useState({ title: '', due: '', assignee: '' });
  async function add(e: React.FormEvent) {
    e.preventDefault(); if (!t.title.trim()) return;
    try { await api(`/api/sales/leads/${id}/tasks`, { body: { title: t.title.trim(), dueDate: t.due || null, assigneeId: t.assignee || undefined } }); setT({ title: '', due: '', assignee: '' }); toast.ok('업무를 만들었습니다'); onSaved(); } catch (er: any) { toast.error(er.message); }
  }
  return (
    <div className="space-y-2" data-testid="lead-tasks">
      {data.readOnly === false && <form onSubmit={add} className="grid gap-2 rounded-input border border-blue-200 bg-blue-50/40 p-2 text-sm sm:grid-cols-[1fr_9rem_8rem_auto]">
        <input className={cx(inputCls, 'h-8 py-1')} value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} placeholder="업무 제목(예: 제안서 보내기)" maxLength={200} aria-label="업무 제목" data-testid="lead-task-title" />
        <input type="date" className={cx(inputCls, 'h-8 py-1 text-xs')} value={t.due} onChange={(e) => setT({ ...t, due: e.target.value })} aria-label="마감" />
        {data.canAssign ? <select className={cx(inputCls, 'h-8 py-1 text-xs')} value={t.assignee} onChange={(e) => setT({ ...t, assignee: e.target.value })} aria-label="담당"><option value="">담당(리드 담당)</option>{data.people.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : <span />}
        <Button size="sm" disabled={!t.title.trim()} data-testid="lead-task-add">업무 추가</Button>
      </form>}
      <ul className="divide-y divide-line rounded-input border border-line text-sm">{(data.wTasks ?? []).map((x: any) => <li key={x.id} className="flex flex-wrap items-center gap-2 p-2" data-testid="lead-task">
        <Link href={`/tasks/${x.id}`} className={cx('min-w-0 flex-1 truncate font-medium', x.status === 'done' && 'text-ink-3 line-through')}>{x.title}</Link>
        {x.sales_ref?.manual ? null : <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-ink-2">자동</span>}
        <span className="text-xs text-ink-2">{x.assignee ?? ''}</span><span className={cx('text-xs tabular-nums', x.status !== 'done' && x.due_date && x.due_date < today() ? 'font-semibold text-red-600' : 'text-ink-3')}>{kd(x.due_date)}</span>
        <span className="text-[11px] text-ink-3">{x.status === 'done' ? '완료' : x.status === 'on_hold' ? '보류' : x.status === 'in_progress' ? '진행' : '할 일'}</span></li>)}
        {!(data.wTasks ?? []).length && <li className="p-3 text-xs text-ink-3">아직 업무가 없습니다 — 상태를 바꾸거나 다음 연락일을 적으면 자동으로 생깁니다</li>}</ul>
      {!!data.tasks?.length && <details className="text-xs"><summary className="cursor-pointer text-ink-3">옮겨 온 원본 업무 {data.tasks.length}</summary><ul className="mt-1 space-y-2">{data.tasks.map((r: any) => <li key={r.__id} className="rounded-input border border-line p-2"><Rec row={r} admin={data.canAssign} /></li>)}</ul></details>}
    </div>
  );
}


/** 영업 재편 5): 상담 입력 폼(진행 탭) — 종류·내용 + 다음 연락 예정일·다음 액션·고객 요청 → 다음 연락일·영업 업무 마감이 같이 바뀜 */
function ActForm({ id, onSaved }: { id: string; onSaved: () => void }) {
  const [act, setAct] = useState({ type: '전화', content: '', nextDate: '', nextAction: '', request: '' });
  async function addAct() {
    try { await api(`/api/sales/leads/${id}/activities`, { body: { type: act.type, content: act.content, nextDate: act.nextDate || null, nextAction: act.nextAction || undefined, request: act.request || undefined } }); setAct({ type: act.type, content: '', nextDate: '', nextAction: '', request: '' }); toast.ok(act.nextDate ? '상담을 기록하고 다음 연락일을 맞췄습니다' : '상담을 기록했습니다'); onSaved(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="space-y-1.5" data-testid="lead-act-form">
      <div className="flex flex-wrap items-end gap-2">
        <select className={cx(inputCls, 'h-8 w-24 py-1')} value={act.type} onChange={(e) => setAct({ ...act, type: e.target.value })} aria-label="상담 종류">{['전화', '방문', '미팅', '메일', '문자', '기타'].map((x) => <option key={x}>{x}</option>)}</select>
        <input className={cx(inputCls, 'h-8 min-w-0 flex-1 py-1')} value={act.content} onChange={(e) => setAct({ ...act, content: e.target.value })} placeholder="상담 내용" aria-label="상담 내용" data-testid="lead-act" />
        <Button size="sm" variant="secondary" onClick={addAct} disabled={!act.content.trim()} data-testid="lead-act-add">상담 기록</Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <input type="date" className={cx(inputCls, 'h-8 py-1 text-xs')} value={act.nextDate} onChange={(e) => setAct({ ...act, nextDate: e.target.value })} aria-label="다음 연락 예정일" title="다음 연락 예정일" data-testid="lead-act-next" />
        <input className={cx(inputCls, 'h-8 py-1 text-xs')} value={act.nextAction} onChange={(e) => setAct({ ...act, nextAction: e.target.value })} placeholder="다음 액션(예: 제안서 발송)" maxLength={200} aria-label="다음 액션" data-testid="lead-act-action" />
        <input className={cx(inputCls, 'h-8 py-1 text-xs')} value={act.request} onChange={(e) => setAct({ ...act, request: e.target.value })} placeholder="고객 요청 사항" maxLength={2000} aria-label="고객 요청" />
      </div>
    </div>
  );
}
const CLOSED_STAGES = ['보류', '실패', '되돌림'];
const plusDays = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.parse(`${today()}T12:00:00+09:00`) + n * 864e5)); // 197차: 서울 날짜로(예전 식은 UTC 로 잘라 하루 일렀음 — '내일' 칩이 오늘)
const fmtEv = (e: any) => { const d = new Date(e.start_at); const day = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short' }).format(d); return e.all_day ? day : `${day} ${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)}`; };
/**
 * 영업 재편 5) 리드·거래처 '진행' 탭 — 파이프라인 메뉴에서 빠진 단계 이동을 흡수해 한 화면에: 단계 띠(누르면 이동, 보류·실패는 사유) · 다음 연락(날짜 + 오늘/내일/3일/1주 칩) · 메모 · 상담 기록 ·
 * 열린 업무 · 다가오는 일정(+ 추가). 정보 수정은 '정보' 탭, 전체 목록은 상담·업무·일정 탭.
 */
function LeadProgress({ id, data, onSaved, go }: { id: string; data: any; onSaved: () => void; go: (tab: string) => void }) {
  const l = data.lead; const ed = data.readOnly === false; const ST = useStages();
  const [pending, setPending] = useState<string | null>(null); const [reason, setReason] = useState(''); const [revisit, setRevisit] = useState(''); // 197차: 보류·실패 '다시 볼 날'(선택)
  const [next, setNext] = useState(l.next ?? ''); const [nact, setNact] = useState(l.nextAction ?? ''); const [memo, setMemo] = useState(l.memo ?? ''); const [ev, setEv] = useState({ title: '', date: '', time: '' });
  const patch = async (body: Record<string, unknown>, msg: string) => { try { await api(`/api/sales/leads/${id}`, { method: 'PATCH', body }); toast.ok(msg); onSaved(); } catch (e: any) { toast.error(e.message); } };
  const move = (st: string) => { if (st === l.status) return; if (st === '보류' || st === '실패') { setPending(st); setReason(''); setRevisit(''); return; } void patch({ status: st }, `${ST.name(st)}(으)로 옮겼습니다`); };
  async function addEvent(e: React.FormEvent) {
    e.preventDefault(); if (!ev.title.trim() || !ev.date) return;
    try { await api(`/api/sales/leads/${id}/events`, { body: { title: ev.title.trim(), date: ev.date, time: ev.time || null } }); setEv({ title: '', date: '', time: '' }); toast.ok('일정을 만들었습니다'); onSaved(); } catch (er: any) { toast.error(er.message); }
  }
  const open = (data.wTasks ?? []).filter((x: any) => x.status !== 'done'); const td = today();
  const upcoming = (data.events ?? []).filter((x: any) => new Date(x.end_at ?? x.start_at).getTime() >= Date.now() - 86400000).sort((a: any, b: any) => String(a.start_at).localeCompare(String(b.start_at)));
  const stages: string[] = ST.pickable((data.stages ?? []).filter((x: string) => !CLOSED_STAGES.includes(x)), l.status); const idx = stages.indexOf(l.status);
  const prevRaw = (data.statusLog ?? []).find((g: any) => g.to_status === l.status)?.from_status; const prevStage = prevRaw && !CLOSED_STAGES.includes(prevRaw) ? prevRaw : '신규리드';
  return (
    <div className="space-y-3 text-sm" data-testid="lead-progress">
      {/* 단계 띠: 지난 단계 채움, 현재 강조, 누르면 이동 */}
      <div className="rounded-input border border-line p-2">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="group" aria-label="단계 이동" data-testid="lead-stage-strip">
          {stages.map((st, i) => <button key={st} type="button" disabled={!ed} onClick={() => move(st)} className={cx('shrink-0 rounded-full border px-2.5 py-1 text-xs', st === l.status ? 'border-transparent font-semibold text-white' : i < idx ? 'border-transparent bg-blue-100 text-blue-900' : 'border-line bg-white text-ink-2 hover:border-blue-300')} style={st === l.status ? { background: C } : undefined} aria-pressed={st === l.status} data-testid={`lead-stage-${st}`}>{ST.name(st)}</button>)}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-3">현재 <b className="text-ink">{l.status ? ST.name(l.status) : '미정'}</b>{idx >= 0 && ` · ${idx + 1}/${stages.length} 단계`}</span>
          {ed && CLOSED_STAGES.filter((x) => x !== '되돌림').map((st) => <button key={st} type="button" onClick={() => move(st)} className={cx('rounded-full border px-2 py-0.5', l.status === st ? 'border-red-300 bg-red-50 font-semibold text-red-700' : 'border-line text-ink-3 hover:text-red-700')} data-testid={`lead-stage-${st}`}>{ST.name(st)}</button>)}
          {l.status === '되돌림' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-ink-2">{ST.name('되돌림')}</span>}
          {/* 로컬 10/25 20:00 ①: 보관함(보류·실패·되돌림) 리드는 상세에서도 [되돌리기] — 마지막 기록의 이전 단계(그것도 보류·실패면 신규리드) */}
          {ed && CLOSED_STAGES.includes(String(l.status)) && <button type="button" onClick={() => void patch({ status: prevStage, reason: '보관함에서 되돌림' }, `되돌렸습니다 — '${ST.name(prevStage)}'`)} className="rounded-full border border-line bg-white px-2 py-0.5 font-semibold text-brand-700 hover:bg-brand-50" data-testid="lead-detail-restore">되돌리기 → {ST.name(prevStage)}</button>}
        </div>
        {pending && <div className="mt-2 flex flex-wrap items-center gap-2 rounded-input bg-amber-50 p-2 text-xs" data-testid="lead-stage-reason-box">
          <span className="text-amber-900">{ST.name(pending)} 사유(필수)</span><input className={cx(inputCls, 'h-8 min-w-0 flex-1 py-1')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label="사유" data-testid="lead-stage-reason" />
          <label className="flex items-center gap-1 text-amber-900">다시 볼 날<input type="date" min={plusDays(1)} className={cx(inputCls, 'h-8 w-auto py-1 text-xs')} value={revisit} onChange={(e) => setRevisit(e.target.value)} aria-label="다시 볼 날(선택)" data-testid="lead-stage-revisit" /></label>
          <button type="button" onClick={() => setRevisit(revisit === plusDays(182) ? '' : plusDays(182))} className={cx('rounded-full border px-2 py-0.5', revisit === plusDays(182) ? 'border-amber-500 bg-white font-semibold' : 'border-amber-200')} data-testid="lead-stage-revisit-6m">6개월 뒤</button>
          <Button size="sm" disabled={!reason.trim()} onClick={() => { void patch({ status: pending, reason: reason.trim(), ...(revisit ? { revisitDate: revisit } : {}) }, `${ST.name(pending)}(으)로 옮겼습니다${revisit ? ` — 다시 볼 날 ${kd(revisit)}` : ''}`); setPending(null); }} data-testid="lead-stage-reason-go">옮기기</Button><Button size="sm" variant="secondary" onClick={() => setPending(null)}>취소</Button></div>}
        {l.revisit && CLOSED_STAGES.includes(String(l.status)) && <p className="mt-1.5 text-xs text-ink-2" data-testid="lead-revisit-note">다시 볼 날 {kd(l.revisit)} — 그날 담당자에게 ‘다시 연락(재접촉 검토)’ 업무가 생깁니다</p>}
      </div>
      {/* 다음 연락 + 메모 */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-input border border-line p-2" data-testid="lead-next-box">
          <div className="flex flex-wrap items-center gap-1.5 text-xs"><span className="font-semibold">다음 행동</span>{l.next ? <span className={l.next < td ? 'font-semibold text-red-600' : 'text-ink-2'}>{kd(l.next)}{l.next < td ? ' · 지남' : ''}{l.nextAction ? ` · ${l.nextAction}` : ''}</span> : !CLOSED_STAGES.includes(String(l.status)) && l.status !== '계약완료' && <span className="font-semibold text-red-600" data-testid="lead-next-missing">⚠ 다음 행동 없음</span>}</div>
          {ed && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <input type="date" className={cx(inputCls, 'h-8 w-auto py-1 text-xs')} value={next} onChange={(e) => setNext(e.target.value)} aria-label="다음 연락일" data-testid="lead-next-date" />
            {([['오늘', 0], ['내일', 1], ['3일 뒤', 3], ['1주 뒤', 7]] as [string, number][]).map(([lb, n]) => <button key={lb} type="button" onClick={() => { setNext(plusDays(n)); void patch({ nextContactDate: plusDays(n) }, `다음 연락 ${lb}`); }} className="rounded-full border border-line px-2 py-0.5 text-xs hover:border-blue-300" data-testid={`lead-next-chip-${n}`}>{lb}</button>)}
            <span className="flex w-full gap-1.5"><input className={cx(inputCls, 'h-8 min-w-0 flex-1 py-1 text-xs')} value={nact} onChange={(e) => setNact(e.target.value)} maxLength={200} placeholder="다음 할 일(예: 견적서 보내기)" aria-label="다음 할 일" data-testid="lead-next-action" />
            <Button size="sm" variant="secondary" disabled={(next || '') === (l.next ?? '') && nact.trim() === (l.nextAction ?? '')} onClick={() => patch({ nextContactDate: next || null, ...(next ? { nextAction: nact.trim() || null } : {}) }, next ? '다음 행동을 저장했습니다' : '다음 연락일을 지웠습니다')} data-testid="lead-next-save">저장</Button></span>
          </div>}
        </div>
        <div className="rounded-input border border-line p-2" data-testid="lead-memo-box">
          <div className="text-xs font-semibold">메모</div>
          {ed ? <><textarea className={cx(inputCls, 'mt-1 text-xs')} rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={5000} aria-label="메모" data-testid="lead-memo" />
            <div className="mt-1 flex justify-end"><Button size="sm" variant="secondary" disabled={memo === (l.memo ?? '')} onClick={() => patch({ memo: memo || null }, '메모를 저장했습니다')} data-testid="lead-memo-save">저장</Button></div></>
            : <p className="mt-1 whitespace-pre-wrap text-xs text-ink-2">{l.memo || '없음'}</p>}
        </div>
      </div>
      {ed && <div className="rounded-input border border-blue-200 bg-blue-50/40 p-2"><ActForm id={id} onSaved={onSaved} /></div>}
      {/* 업무 · 일정 요약(열린 것·다가오는 것) */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-input border border-line p-2" data-testid="lead-progress-tasks">
          <div className="flex items-center justify-between text-xs"><span className="font-semibold">열린 업무 {open.length}</span><button type="button" onClick={() => go('tasks')} className="underline" style={{ color: C }}>전체·추가</button></div>
          <ul className="mt-1 space-y-1 text-xs">{open.slice(0, 5).map((x: any) => <li key={x.id} className="flex items-center gap-2"><Link href={`/tasks/${x.id}`} className="min-w-0 flex-1 truncate">{x.title}</Link><span className={cx('tabular-nums', x.due_date && x.due_date < td ? 'font-semibold text-red-600' : 'text-ink-3')}>{kd(x.due_date)}</span></li>)}{!open.length && <li className="text-ink-3">열린 업무 없음</li>}</ul>
        </div>
        <div className="rounded-input border border-line p-2" data-testid="lead-progress-events">
          <div className="flex items-center justify-between text-xs"><span className="font-semibold">다가오는 일정 {upcoming.length}</span><button type="button" onClick={() => go('events')} className="underline" style={{ color: C }}>전체</button></div>
          <ul className="mt-1 space-y-1 text-xs">{upcoming.slice(0, 5).map((x: any) => <li key={x.id} className="flex items-center gap-2"><Link href={`/calendar?event=${x.id}`} className="min-w-0 flex-1 truncate">{x.title}</Link><span className="tabular-nums text-ink-3">{fmtEv(x)}</span></li>)}{!upcoming.length && <li className="text-ink-3">다가오는 일정 없음</li>}</ul>
          {ed && <form onSubmit={addEvent} className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <input className={cx(inputCls, 'h-8 min-w-0 flex-1 py-1 text-xs')} value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} placeholder="일정(예: 현장 미팅)" maxLength={200} aria-label="일정 제목" data-testid="lead-event-title" />
            <input type="date" className={cx(inputCls, 'h-8 w-auto py-1 text-xs')} value={ev.date} onChange={(e) => setEv({ ...ev, date: e.target.value })} aria-label="일정 날짜" data-testid="lead-event-date" />
            <input type="time" className={cx(inputCls, 'h-8 w-auto py-1 text-xs')} value={ev.time} onChange={(e) => setEv({ ...ev, time: e.target.value })} aria-label="시각(비우면 종일)" data-testid="lead-event-time" />
            <Button size="sm" variant="secondary" disabled={!ev.title.trim() || !ev.date} data-testid="lead-event-add">일정 추가</Button>
          </form>}
        </div>
      </div>
    </div>
  );
}
/** 영업 재편 5): 일정 탭 — 리드에 연결된 일정 전체(넘기기 자동 일정 포함) */
function LeadEvents({ data }: { data: any }) {
  const evs: any[] = data.events ?? []; const now = Date.now();
  return (
    <ul className="divide-y divide-line rounded-input border border-line text-sm" data-testid="lead-events">
      {evs.map((x) => <li key={x.id} className={cx('flex flex-wrap items-center gap-2 p-2', new Date(x.end_at ?? x.start_at).getTime() < now && 'text-ink-3')} data-testid="lead-event"><Link href={`/calendar?event=${x.id}`} className="min-w-0 flex-1 truncate font-medium">{x.title}</Link><span className="text-xs text-ink-3">{x.calendar}</span><span className="text-xs tabular-nums">{fmtEv(x)}</span></li>)}
      {!evs.length && <li className="p-3 text-xs text-ink-3">연결된 일정이 없습니다 — 진행 탭에서 추가하거나, 공고를 넘기면 현장설명회·입찰 일정이 자동으로 들어옵니다</li>}
    </ul>
  );
}

function LeadDetail({ id, onClose, onChange, onOpen }: { id: string; onClose: () => void; onChange?: () => void; onOpen?: (id: string) => void }) {
  useBackClose(true, onClose, ['id', id]); // #535: 휴대폰 뒤로가기 = 상세만 닫힘(주소 ?id= 로 새로 고침·공유해도 같은 상세)
  const { data, error, reload } = useApi<any>(`/api/sales/src?view=lead&id=${encodeURIComponent(id)}`); const stageLabel = useStages().name;
  const merged: string | undefined = data?.mergedInto; // 206차: 합쳐서 빠진 거래처(예전 링크) → 남긴 거래처로
  useEffect(() => { if (!merged) return; toast.ok('합쳐진 거래처로 옮겼습니다'); if (onOpen) onOpen(merged); else onClose(); }, [merged]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useUrlState('lt', 'progress'); // 영업 재편 5): 진행 탭이 첫 화면. #242 2단계: 탭은 주소(?lt=)에 — 업무·일정을 열었다 뒤로 와도 같은 탭
  useEffect(() => () => { const p = new URLSearchParams(location.search); if (p.has('lt')) { p.delete('lt'); replaceUrl(`${location.pathname}${p.size ? `?${p}` : ''}`); } }, []); // 닫으면 탭 값은 지움
  const [del, setDel] = useState<string | null>(null);
  const [rv, setRv] = useState<string | null>(null); // 영업 재편 2) 되돌리기 사유
  async function revert() {
    try { const r = await api<{ tasks: number; events: number }>('/api/sales/work/handoff/revert', { body: { leadId: id, reason: rv?.trim() || undefined } }); toast.ok(`배정 이전으로 되돌렸습니다 — 업무 ${r.tasks}건·일정 ${r.events}건 취소`); setRv(null); reload(); onChange?.(); }
    catch (e: any) { toast.error(e.message); }
  }
  const handoffSrc = data?.raw?.handoff ? data.raw : null; /* 리드 view 의 raw 는 src jsonb 가 펼쳐져 있음 */ const canRevert = !!handoffSrc?.handoff && data?.lead?.status !== '되돌림' && data?.readOnly === false && (data.canAssign || data.me === data.lead?.ownerId || handoffSrc?.by === data.me || (handoffSrc?.assignees ?? []).includes(data.me));
  const tabs: [string, string, any[] | null][] = data && !merged ? [['progress', '진행', null], ['info', '정보', null], ['acts', `상담 ${data.activities.length}`, data.activities], ['tasks', `업무 ${(data.wTasks ?? []).length + data.tasks.length}`, null], ['events', `일정 ${(data.events ?? []).length}`, null], ['timeline', `타임라인 ${(data.timeline ?? []).length}`, null],
    ['props', `제안 ${data.proposals.length}`, data.proposals], ['cons', `계약 ${data.contracts.length}`, data.contracts], ['timing', `시점 ${data.timing.length}`, data.timing], ['work', `입찰 ${data.work.length}`, data.work], ['int', `관심사업 ${data.interests.length}`, data.interests]] : [];
  async function remove() {
    if (!del?.trim()) return;
    try { await api(`/api/sales/leads/${id}`, { method: 'DELETE', body: { reason: del.trim() } }); toast.ok('리드를 지웠습니다'); onChange?.(); onClose(); } catch (e: any) { toast.error(e.message); }
  }
  const list = tabs.find((t) => t[0] === tab)?.[2];
  return (
    <Modal open onClose={onClose} title={data?.lead?.name ?? '리드'} wide>
      {error ? <ErrorBox error={error} /> : !data || merged ? <Skeleton rows={4} /> : (
        <div className="space-y-3" data-testid="sales-lead-detail">
          <AiAsk space="sales" examples={AI_ASK_EXAMPLES.salesLead} subject={`거래처 ${data.lead.name}`} compact testId="ai-ask-lead" />
          {handoffSrc?.handoff && <div className="flex flex-wrap items-center gap-2 rounded-input bg-slate-50 px-3 py-2 text-xs" data-testid="lead-handoff-box"><span className="text-ink-2">{data.lead.status === '되돌림' ? `배정 이전으로 되돌린 리드입니다${handoffSrc.reverted?.reason ? ` — ${handoffSrc.reverted.reason}` : ''}` : `넘기기로 만든 리드 — 담당 ${(handoffSrc.assignees ?? []).length}명, 업무 ${(handoffSrc.taskIds ?? []).length}건·일정 ${(handoffSrc.eventIds ?? []).length}건`}</span>
            {canRevert && (rv === null ? <Button size="sm" variant="secondary" onClick={() => setRv('')} data-testid="lead-revert">배정 이전으로 되돌리기</Button>
              : <span className="flex flex-1 flex-wrap items-center gap-1.5"><input className={cx(inputCls, 'h-8 min-w-40 flex-1 py-1 text-xs')} value={rv} onChange={(e) => setRv(e.target.value)} placeholder="사유(선택)" aria-label="되돌리기 사유" maxLength={300} data-testid="lead-revert-reason" /><Button size="sm" onClick={revert} data-testid="lead-revert-go">되돌리기</Button><Button size="sm" variant="secondary" onClick={() => setRv(null)}>취소</Button></span>)}</div>}
          {data.raw?.from === 'meta_lead' && <MetaLeadBox id={id} raw={data.raw} phone={data.lead.phone} />}
          <div className="flex flex-wrap gap-1.5 text-xs"><StageChip k={data.lead.status} />{chip(data.lead.priority)}{chip(data.lead.facility)}{chip(data.lead.region)}{data.lead.owner && <span className="text-ink-2">담당 {data.lead.owner}</span>}{data.lead.next && <span className="text-ink-2">다음 연락 {kd(data.lead.next)}{data.lead.nextAction ? ` · ${data.lead.nextAction}` : ''}</span>}</div>
          <div className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">{tabs.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={cx('shrink-0 px-2 py-1 text-xs', tab === k ? 'border-b-2 font-semibold' : 'text-ink-2')} style={tab === k ? { borderColor: C, color: C } : undefined} data-testid={`lead-tab-${k}`}>{l}</button>)}</div>
          {tab === 'progress' ? <LeadProgress key={data.lead.status} id={id} data={data} onSaved={() => { reload(); onChange?.(); }} go={setTab} />
            : tab === 'events' ? <LeadEvents data={data} />
            : tab === 'info' ? <>{data.readOnly === false && <LeadEdit key={data.lead.status + (data.lead.next ?? '') + (data.lead.updated ?? '')} id={id} data={data} onSaved={() => { reload(); onChange?.(); }} />}
            {/* 로컬 10/19: 사람이 보는 칸만 한국어로 — 내부 id·원본 키는 숨기고, 원본 전체는 관리자만 접힘 안에 */}
            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-sm" data-testid="lead-info">
              {([['거래처명', data.lead.name], ['단계', data.lead.status && stageLabel(data.lead.status)], ['우선순위', data.lead.priority], ['시설', data.lead.facility], ['지역', data.lead.region], ['규모', data.lead.scale], ['담당', data.lead.owner], ['다음 연락', data.lead.next && kd(data.lead.next)],
                ['연락처', [data.lead.contact, data.lead.phone].filter(Boolean).join(' · ')], ['사업자번호', data.lead.bizNo], ['이메일', data.lead.email && <a href={`mailto:${data.lead.email}`} className="underline" style={{ color: C }}>{data.lead.email}</a>], ['홈페이지', data.lead.homepage && <a href={data.lead.homepage} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: C }}>{String(data.lead.homepage).replace(/^https?:\/\//, '')}</a>], ['예상매출', won(data.lead.revenue)], ['최근 활동', data.lead.lastActivity && kd(data.lead.lastActivity)], ['등록일', data.lead.created && kd(data.lead.created)], ['메모', data.lead.memo]] as [string, unknown][])
                .filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [<dt key={k} className="text-ink-3">{k}</dt>, <dd key={k + ':v'} className="whitespace-pre-wrap break-words">{typeof v === 'string' || typeof v === 'number' ? String(v) : (v as React.ReactNode)}</dd>])}
            </dl>
            <ContactRow phone={data.lead.phone} />
            <RawFold row={data.raw} admin={data.canAssign} testId="lead-raw" />
            {/* S2 2차(감사 1-14): 삭제 — 사유 필수, 감사 기록, 열린 영업 업무 완료 처리 */}
            {data.readOnly === false && data.canDelete && (del === null ? <div className="flex justify-end"><button type="button" onClick={() => setDel('')} className="text-xs text-red-600 underline" data-testid="lead-delete">리드 삭제</button></div>
              : <div className="flex flex-wrap items-center gap-2 rounded-input border border-red-200 bg-red-50 p-2 text-xs" data-testid="lead-delete-box"><span className="text-red-700">삭제 사유(필수) — 기록이 남고 목록에서 사라집니다</span><input className={cx(inputCls, 'h-8 min-w-0 flex-1 py-1')} value={del} onChange={(e) => setDel(e.target.value)} maxLength={500} aria-label="삭제 사유" data-testid="lead-delete-reason" autoFocus />
                <Button size="sm" variant="danger" onClick={remove} disabled={!del.trim()} data-testid="lead-delete-go">삭제</Button><Button size="sm" variant="secondary" onClick={() => setDel(null)}>취소</Button></div>)}
            {data.readOnly === false && data.canAssign && <LeadMergeBox id={id} onMerged={(into) => { onChange?.(); if (onOpen) onOpen(into); else onClose(); }} />}</>
            : tab === 'tasks' ? <LeadTasks id={id} data={data} onSaved={() => { reload(); onChange?.(); }} />
            : tab === 'timeline' ? <LeadTimeline items={data.timeline ?? []} />
            : <ul className="space-y-2">{(tab === 'props' || tab === 'cons') && data.readOnly === false && <li><RecordForm kind={tab === 'props' ? 'proposals' : 'contracts'} leads={[]} leadId={id} onSaved={() => { reload(); onChange?.(); }} /></li>}
              {(list ?? []).map((r: any) => <li key={r.__id} className="rounded-input border border-line p-2"><Rec row={r} admin={data.canAssign} /></li>)}
              {!(list ?? []).length && <li className="text-xs text-ink-3">없음</li>}</ul>}
        </div>
      )}
    </Modal>
  );
}

/** S2 2차(감사 1-13·1-15): 거래처 보기 4(표·카드·단계별·간단) · 빠른 칩 6 · 정렬 5 · 필터(단계·우선·담당·지역) · 단계 요약 · CSV 내보내기/가져오기 · 새 리드 13칸(비슷한 거래처 경고) */
const LEAD_VIEWS: [string, string][] = [['table', '표'], ['cards', '카드'], ['stages', '단계별'], ['compact', '간단']];
// 197차(#461 영업 진행 목록 개편 1단계): '오늘 볼 것' 띠 · 보기 탭 7개(+ 내 보기, 서버에 저장·기기 간 유지) · 표 열(단계 머문 날·다음 행동·마지막 접촉·출처) · 열 머리 정렬 · 열 고르기.
// 예전 빠른 칩 '내 담당·오늘 연락·연락 지남·30일 조용함'은 탭·띠로 옮김. 원칙: 진행 중 거래처는 다음 행동이 있거나, 종결 사유가 있다
const LEAD_CHIPS: [string, string][] = [['week', '이번 주 연락'], ['high', '우선 높음']];
const LEAD_TABS: [string, string][] = [['mine', '내 거래처'], ['due', '오늘·지남'], ['none', '다음 행동 없음'], ['new', '새 리드'], ['open', '전체 진행 중'], ['closed', '종결'], ['all', '전체']];
const TAB_SORT: Record<string, string> = { mine: 'next', due: 'next', none: 'contact', new: 'created', open: 'stage', closed: 'closed', all: 'activity' };
const LEAD_STRIP: [string, string][] = [['today', '오늘 연락'], ['overdue', '기한 지남'], ['none', '다음 행동 없음'], ['stale', '14일 넘게 연락 없음'], ['new', '새 리드(7일)'], ['unassigned', '담당 없음']];
const LEAD_SORTS: [string, string][] = [['', '보기 기본 순서'], ['activity', '최근 활동순'], ['next', '다음 연락순'], ['contact', '연락 없은 지 오래된 순'], ['stage', '단계순'], ['name', '이름순'], ['revenue', '예상매출순'], ['created', '등록순'], ['closed', '종결 최근순']];
const DESC_SORTS = new Set(['activity', 'revenue', 'created', 'closed']);
const LEAD_COLS: [string, string][] = [['source', '출처'], ['contact', '마지막 접촉'], ['revenue', '예상 금액'], ['owner', '담당'], ['priority', '우선'], ['interest', '관심 사업'], ['facility', '시설'], ['region', '지역']];
const DEFAULT_COLS = ['source', 'contact', 'revenue', 'owner', 'priority'];
const LEAD_CLOSED = new Set(['계약완료', '보류', '실패', '되돌림']);
const kstDay = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d); };
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00+09:00`) - Date.parse(`${from}T12:00:00+09:00`)) / 864e5);
const shiftDay = (d: string, n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.parse(`${d}T12:00:00+09:00`) + n * 864e5));
const PRI_KO: Record<string, string> = { urgent: '긴급', high: '높음', medium: '보통', low: '낮음' };
const CSV_COLS: [string, string][] = [['name', '거래처명'], ['status', '단계'], ['priority', '우선순위'], ['facility', '시설'], ['region', '지역'], ['scale', '규모'], ['owner', '담당'], ['contact', '고객 담당자'], ['phone', '연락처'], ['email', '이메일'], ['homepage', '홈페이지'], ['bizNo', '사업자번호'], ['revenue', '예상매출'], ['next', '다음 연락일'], ['lastActivity', '최근 활동'], ['created', '등록일'], ['memo', '메모']];
const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** CSV 한 줄씩(따옴표·줄바꿈 처리) */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
/** UTF-8(BOM 포함) 먼저, 깨지면 CP949(euc-kr) — 엑셀 저장 CSV */
async function readCsvFile(file: File) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); } catch { return new TextDecoder('euc-kr').decode(buf); }
}
/** 205차: 가져오기 칸 길이(서버 검사와 같음 — 긴 칸 하나로 파일 전체가 막히지 않게 잘라 넣음) · 같은 연락처 경고 이름 */
const IMPORT_MAX: Record<string, number> = { name: 300, region: 50, scale: 60, facilityType: 100, contactName: 100, phone: 40, email: 200, homepage: 300, bizNo: 20, memo: 5000 };
const SAME_BY: Record<string, string> = { bizNo: '사업자번호', phone: '전화', email: '메일' };
const IMPORT_MAP: [RegExp, string][] = [[/사업자.?(등록)?.?번호|등록번호|biz.?no|business.?(no|number)/i, 'bizNo'], [/거래처|회사|이름|^name$|company/i, 'name'], [/단계|상태|status|stage/i, 'status'], [/우선|priority/i, 'priority'], [/시설|유형|facility|type/i, 'facilityType'], [/지역|region|area/i, 'region'], [/규모|scale|size|세대/i, 'scale'],
  [/고객.?담당|담당자|contact.?name|manager/i, 'contactName'], [/연락처|전화|phone|tel/i, 'phone'], [/이메일|e-?mail/i, 'email'], [/홈페이지|website|url|homepage/i, 'homepage'], [/매출|금액|revenue|amount/i, 'expectedRevenue'], [/다음.?연락|next/i, 'nextContactDate'], [/메모|비고|memo|note/i, 'memo']];
/** 202차(#461 ⑥, SALES_LEADS_REVAMP 2-4): 휴대폰 리드 카드 밀기 — → 연락함 기록 · ← 다음 연락일 바꾸기. 손가락(또는 휴대폰 폭)에서만, 세로 스크롤은 그대로 */
const SWIPE_PX = 72;
function SwipeCard({ on, onLeft, onRight, children }: { on: boolean; onLeft: () => void; onRight: () => void; children: React.ReactNode }) {
  const st = useRef<{ x: number; y: number; dx: number; lock: '' | 'h' } | null>(null); const eat = useRef(false);
  const [dx, setDx] = useState(0);
  const end = () => { const s = st.current; st.current = null; setDx(0); if (s?.lock !== 'h') return; eat.current = true; setTimeout(() => { eat.current = false; }, 0); if (s.dx <= -SWIPE_PX) onLeft(); else if (s.dx >= SWIPE_PX) onRight(); };
  return (
    <div className="relative overflow-hidden rounded-card" data-testid="lead-swipe">
      {dx !== 0 && <div aria-hidden className={cx('absolute inset-0 flex items-center px-4 text-xs font-semibold', dx > 0 ? 'justify-start bg-emerald-50 text-emerald-800' : 'justify-end bg-sky-50 text-sky-800')} data-testid="lead-swipe-hint-bg">{dx > 0 ? '연락함 기록' : '다음 연락일 바꾸기'}</div>}
      <div className={cx('relative', on && 'touch-pan-y')} style={dx ? { transform: `translateX(${dx}px)` } : { transition: 'transform .15s' }}
        onPointerDown={(e) => { if (!on || e.button > 0 || (e.pointerType === 'mouse' && !window.matchMedia('(max-width: 767px)').matches)) return; st.current = { x: e.clientX, y: e.clientY, dx: 0, lock: '' }; }}
        onPointerMove={(e) => {
          const s = st.current; if (!s) return; const mx = e.clientX - s.x, my = e.clientY - s.y;
          if (!s.lock) { if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) { s.lock = 'h'; e.currentTarget.setPointerCapture?.(e.pointerId); } else if (Math.abs(my) > 10) { st.current = null; return; } else return; }
          s.dx = Math.max(-110, Math.min(110, mx)); setDx(s.dx);
        }}
        onPointerUp={end} onPointerCancel={() => { st.current = null; setDx(0); }}
        onClickCapture={(e) => { if (eat.current) { e.preventDefault(); e.stopPropagation(); } }}>{children}</div>
    </div>
  );
}

export function Leads({ initialId, initialView }: { initialId?: string; initialDay?: string; initialView?: string }) { // initialDay 는 주소(?day)에서 직접 읽음
  // #242 2단계: 검색어·단계·오늘·칩·정렬·우선·담당·지역은 주소에 — 리드에서 업무·일정을 열었다 뒤로 와도 같은 목록. ?id= 는 뒤로가기로 돌아온 상세(서버가 준 값이 없을 때)
  const sp = useSearchParams();
  const [s, setS] = useUrlState('q', ''); const [status, setStatus] = useUrlState('status', ''); const [open, setOpen] = useState<string | null>(initialId ?? sp.get('id'));
  const [dayQ, setDay] = useUrlState('day', ''); const day = dayQ === 'today' ? 'today' : ''; // 영업 현황 '오늘 연락할 리드'
  const [boxQ, setBox] = useUrlState('box', ''); // #610 ⓒ·#614 예전 보관함 주소(?box=archive) → 197차 '종결' 보기
  const [lvQ, setLv] = useUrlState('lv', 'open'); // 197차(#461): 보기 탭(내 거래처·오늘·지남·다음 행동 없음·새 리드·전체 진행 중·종결·전체)
  const [focus, setFocus] = useUrlState('focus', ''); // 197차: '오늘 볼 것' 띠에서 누른 조건(진행 중 거래처 안에서)
  const [chipsQ, setChipsQ] = useUrlState('chips', ''); const chips = chipsQ ? chipsQ.split(',') : []; const setChips = (c: string[]) => setChipsQ(c.join(','));
  const [view, setView] = useState(initialView && LEAD_VIEWS.some(([k]) => k === initialView) ? initialView : 'table');
  const [sort, setSort] = useUrlState('sort', ''); const [rev, setRev] = useUrlState('rev', ''); // 197차: 정렬 '' = 보기 기본 순서 · rev=1 거꾸로(열 머리 두 번)
  const [sort2, setSort2] = useUrlState('sort2', ''); const [rev2, setRev2] = useUrlState('rev2', ''); // 204차: 2차 정렬(열 머리 Shift+클릭)
  const [fPri, setFPri] = useUrlState('pri', ''); const [fOwner, setFOwner] = useUrlState('owner', ''); const [fRegion, setFRegion] = useUrlState('region', ''); const [fSrc, setFSrc] = useUrlState('src', '');
  const [mv, setMv] = useState<{ id: string; name: string; q: Record<string, string> }[] | null>(null); const [cols, setCols] = useState<string[] | null>(null); const [saving, setSaving] = useState<string | null>(null); // 197차: 내 보기·열(저장 뒤 화면에 바로)
  const [imp, setImp] = useState<ImportRows | null>(null); // 205차: 파일을 읽으면 미리보기(겹침 표시) 창
  const ST = useStages(); // 207차: 단계 이름·숨김은 회사 설정
  const [quick, setQuick] = useState<{ mode: 'next' | 'log'; lead: any } | null>(null); // 202차: 휴대폰 카드 밀기 창
  // 204차(#461 ⑦): 표에서 여러 건 골라 한 번에(담당·단계·다음 연락일·CSV) · 표의 단계 바꾸기도 묻는 창(예전 prompt)
  const [sel, setSel] = useState<string[]>([]); const [bulk, setBulk] = useState<'' | 'stage' | 'next'>(''); const [stMove, setStMove] = useState<{ lead: any; to: string } | null>(null);
  useEffect(() => { setSel([]); }, [lvQ, focus, s, status, chipsQ]); // 보기·조건이 바뀌면 고른 것 풀기
  const { data, error, reload } = useApi<any>(`/api/sales/src?${q({ view: 'leads', q: s, day })}`, [s, day]); // 197차: 단계는 화면에서 거름 — 띠·탭 숫자는 늘 전체 기준
  useEffect(() => { if (initialView) return; try { const v = localStorage.getItem('sales-leads-view'); if (v && LEAD_VIEWS.some(([k]) => k === v)) setView(v); } catch { /* 없음 */ } }, [initialView]);
  const pickView = (v: string) => { setView(v); try { localStorage.setItem('sales-leads-view', v); } catch { /* 없음 */ } };
  // 로컬 검수 10/19: prompt() 는 브라우저·자동화 환경에서 막힐 수 있어 입력 창으로
  const [nl, setNl] = useState<Record<string, string> | null>(null);
  const [similar, setSimilar] = useState<{ id: string; name: string; status: string | null; region: string | null; by?: string }[] | null>(null); // 비슷한 거래처(미리 보기 + 만들기 때 경고 — 205차: 같은 사업자번호·전화·메일도)
  const [forceNew, setForceNew] = useState(false);
  const EMPTY_NL = { name: '', status: '신규리드', priority: '', facilityType: '', region: '', scale: '', expectedRevenue: '', contactName: '', phone: '', email: '', homepage: '', bizNo: '', nextContactDate: '', memo: '', ownerId: '' };
  // 앱 더보기 › 만들기 › 새 리드(?new=1): 쓰기 열린 회사면 입력 창 바로
  async function patchLead(id: string, body: Record<string, unknown>) {
    try { await api(`/api/sales/leads/${id}`, { method: 'PATCH', body }); toast.ok('저장했습니다'); reload(); } catch (e: any) { toast.error(e.message); reload(); }
  }
  useEffect(() => { if (data?.readOnly === false && new URLSearchParams(window.location.search).get('new') === '1') setNl({ ...EMPTY_NL }); }, [data?.readOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // 이름을 치면 비슷한 거래처 미리 보기(0.4초 뒤)
    if (!nl || nl.name.trim().length < 2) { setSimilar(null); return; }
    const h = setTimeout(() => { api<{ similar: any[] }>(`/api/sales/leads/similar?name=${encodeURIComponent(nl.name.trim())}`).then((r) => setSimilar(r.similar)).catch(() => setSimilar(null)); }, 400);
    return () => clearTimeout(h);
  }, [nl?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  async function newLead(e: React.FormEvent) {
    e.preventDefault(); if (!nl?.name.trim()) return;
    const body: Record<string, unknown> = { name: nl.name.trim(), status: nl.status, force: forceNew };
    for (const k of ['priority', 'facilityType', 'region', 'scale', 'contactName', 'phone', 'email', 'homepage', 'bizNo', 'nextContactDate', 'memo', 'ownerId'] as const) if (nl[k]) body[k] = nl[k];
    if (nl.expectedRevenue) body.expectedRevenue = numOf(nl.expectedRevenue);
    try { const r = await api<{ id?: string; similar?: any[] }>('/api/sales/leads', { body });
      if (r.similar) { setSimilar(r.similar); setForceNew(true); toast.error(`비슷한 거래처가 ${r.similar.length}곳 있습니다 — 확인한 뒤 [그래도 만들기]`); return; }
      setNl(null); setForceNew(false); setSimilar(null); reload(); if (r.id) setOpen(r.id); } catch (er: any) { toast.error(er.message); }
  }
  function exportCsv(list: any[] = shown) {
    const rows = [CSV_COLS.map(([, h]) => h).join(','), ...list.map((l: any) => CSV_COLS.map(([k]) => csvCell(k === 'status' ? ST.name(l.status) : k === 'priority' ? l.priority : k === 'revenue' ? (l.revenue ? Number(l.revenue) : '') : l[k])).join(','))];
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `거래처_${today()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function pickCsv(file: File) {
    const grid = parseCsv(await readCsvFile(file)); if (grid.length < 2) { toast.error('머리줄과 자료가 있는 CSV 가 필요합니다'); return; }
    const head = grid[0].map((h) => IMPORT_MAP.find(([re]) => re.test(h.trim()))?.[1] ?? null);
    if (!head.includes('name')) { toast.error("'거래처명' 열을 찾지 못했습니다"); return; }
    const PRI_CODE: Record<string, string> = { 긴급: 'urgent', 높음: 'high', 보통: 'medium', 낮음: 'low', urgent: 'urgent', high: 'high', medium: 'medium', low: 'low' };
    const rows: Record<string, unknown>[] = []; const skipped: string[] = [];
    for (const r of grid.slice(1)) { const o: Record<string, unknown> = {};
      head.forEach((k, idx) => { const v = (r[idx] ?? '').trim(); if (!k || !v || o[k] !== undefined) return;
        if (k === 'status') { const key = ST.keyOf(v); if (key && (data?.stages ?? []).includes(key)) o.status = key; } // 207차: 회사 단계 이름도 else if (k === 'priority') { if (PRI_CODE[v]) o.priority = PRI_CODE[v]; } else if (k === 'expectedRevenue') { const n = numOf(v); if (n !== null && Number.isFinite(n)) o.expectedRevenue = n; }
        else if (k === 'nextContactDate') { const m = v.match(/(\d{4})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/); if (m) o.nextContactDate = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; } else o[k] = v.slice(0, IMPORT_MAX[k] ?? 300); });
      if (typeof o.name === 'string' && o.name) rows.push(o); else skipped.push(r.join(',').slice(0, 40)); }
    setImp({ rows, file: file.name, skipped });
  }
  // 197차: 휴대폰은 보기 탭이 가로로 밀려 켜진 탭이 화면 밖일 수 있음 — 탭 줄만 옆으로 옮겨 보이게(화면 위아래는 그대로)
  const tabsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { const box = tabsRef.current; const on = box?.querySelector<HTMLElement>('[aria-selected="true"]'); if (box && on && (on.offsetLeft < box.scrollLeft || on.offsetLeft + on.offsetWidth > box.scrollLeft + box.clientWidth)) box.scrollLeft = Math.max(0, on.offsetLeft - 8); });
  if (error) return <ErrorBox error={error} retry={reload} />;
  const all: any[] = data?.leads ?? []; const td = today(); const me = data?.me;
  const isArch = (l: any) => ARCHIVED_STAGES.has(String(l.status)); const isClosed = (l: any) => LEAD_CLOSED.has(String(l.status));
  // 197차(#461): 띠 = 진행 중 거래처의 오늘 연락·기한 지남·다음 행동 없음·14일 넘게 연락 없음·새 리드·담당 없음 — 누르면 '전체 진행 중'에서 그 조건만
  const d7 = shiftDay(td, 7), d7ago = shiftDay(td, -7), d14ago = shiftDay(td, -14);
  const lastDay = (l: any) => kstDay(l.lastContact?.at) ?? l.created ?? null;
  const STRIP_FN: Record<string, (l: any) => boolean> = { today: (l) => l.next === td, overdue: (l) => !!l.next && l.next < td, none: (l) => !l.next, stale: (l) => { const d = lastDay(l); return !!d && d < d14ago; },
    new: (l) => l.status === '신규리드' && (l.created ?? '') >= d7ago, unassigned: (l) => !l.ownerId };
  const TAB_FN: Record<string, (l: any) => boolean> = { mine: (l) => !isClosed(l) && !!me && l.ownerId === me, due: (l) => !isClosed(l) && !!l.next && l.next <= td, none: (l) => !isClosed(l) && !l.next,
    new: (l) => !isClosed(l) && STRIP_FN.new(l), open: (l) => !isClosed(l), closed: isClosed, all: () => true };
  const lv = boxQ === 'archive' ? 'closed' : TAB_FN[lvQ] ? lvQ : 'open';
  const live = all.filter((l) => !isClosed(l));
  const stripN: Record<string, number> = Object.fromEntries(LEAD_STRIP.map(([k]) => [k, live.filter(STRIP_FN[k]).length]));
  const tabN: Record<string, number> = Object.fromEntries(LEAD_TABS.map(([k]) => [k, all.filter(TAB_FN[k]).length]));
  const base = all.filter((l) => TAB_FN[lv](l) && (!focus || !STRIP_FN[focus] || (!isClosed(l) && STRIP_FN[focus](l))));
  const stageCount = new Map<string, number>(); for (const l of base) stageCount.set(String(l.status ?? '미정'), (stageCount.get(String(l.status ?? '미정')) ?? 0) + 1);
  const statuses = [...new Set(all.map((l: any) => String(l.status ?? '미정')))] as string[];
  const owners = [...new Map(all.filter((l) => l.ownerId).map((l) => [l.ownerId, l.owner])).entries()] as [string, string][]; const regions = [...new Set(all.map((l) => l.region).filter(Boolean))] as string[];
  const sources = [...new Map(all.filter((l) => l.source?.kind).map((l) => [l.source.kind, l.source.label])).entries()] as [string, string][];
  const CHIP_FN: Record<string, (l: any) => boolean> = { week: (l) => !!l.next && l.next >= td && l.next <= d7, high: (l) => ['urgent', 'high'].includes(String(l.priorityCode)) };
  const stageIdx = (l: any) => { const i = (data?.stages ?? []).indexOf(String(l.status)); return i < 0 ? 99 : i; };
  const SORT_FN: Record<string, (a: any, b: any) => number> = { activity: (a, b) => String(b.lastContact?.at ?? b.lastActivity ?? '').localeCompare(String(a.lastContact?.at ?? a.lastActivity ?? '')), next: (a, b) => String(a.next ?? '9999').localeCompare(String(b.next ?? '9999')),
    contact: (a, b) => String(lastDay(a) ?? '').localeCompare(String(lastDay(b) ?? '')), stage: (a, b) => stageIdx(a) - stageIdx(b) || String(a.next ?? '9999').localeCompare(String(b.next ?? '9999')),
    name: (a, b) => String(a.name).localeCompare(String(b.name), 'ko'), revenue: (a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0), created: (a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')),
    closed: (a, b) => String(b.closedAt ?? '').localeCompare(String(a.closedAt ?? '')), source: (a, b) => String(a.source?.label ?? '').localeCompare(String(b.source?.label ?? ''), 'ko'), owner: (a, b) => String(a.owner ?? '힣').localeCompare(String(b.owner ?? '힣'), 'ko') };
  const sortKey = sort && SORT_FN[sort] ? sort : TAB_SORT[lv];
  const shown = base.filter((l) => (!status || String(l.status ?? '미정') === status) && chips.every((c) => !CHIP_FN[c] || CHIP_FN[c](l)) && (!fPri || l.priorityCode === fPri) && (!fOwner || (fOwner === '-' ? !l.ownerId : l.ownerId === fOwner))
    && (!fRegion || l.region === fRegion) && (!fSrc || l.source?.kind === fSrc)).sort((a, b) => (rev === '1' ? -1 : 1) * (SORT_FN[sortKey] ?? SORT_FN.activity)(a, b)
      || (sort2 && sort2 !== sortKey && SORT_FN[sort2] ? (rev2 === '1' ? -1 : 1) * SORT_FN[sort2](a, b) : 0));
  const sumRevenue = shown.reduce((n, l) => n + (Number(l.revenue) || 0), 0);
  const selectable = shown.filter((l) => !isClosed(l)); const allSel = selectable.length > 0 && selectable.every((l) => sel.includes(l.id)); // 종결 거래처는 고르지 않음(종결 보기엔 체크 칸 없음)
  function bulkDone(r: BulkResult) {
    setBulk(''); reload();
    if (r.ok) toast.ok(`${r.ok}건 바꿨습니다`);
    if (r.failed.length) toast.error(`${r.failed.length}건은 못 바꿨습니다 — ${r.failed[0].name ?? '거래처'}: ${r.failed[0].message}${r.failed.length > 1 ? ' 외' : ''}`);
    setSel(r.failed.map((f) => f.id)); // 못 바꾼 건만 골라 둔 채로
  }
  async function bulkOwner(v: string) { if (!v) return; try { bulkDone(await api<BulkResult>('/api/sales/leads/bulk', { body: { ids: sel, patch: { ownerId: v === '-' ? null : v } } })); } catch (e: any) { toast.error(e.message); } }
  const ed = data?.readOnly === false;
  const box = lv === 'closed' ? 'archive' : '';
  // 로컬 10/25 20:00 ①: 종결(예전 보관함)은 '단계별'·'간단' 보기여도 표(PC)·카드(휴대폰)로 — [되돌리기]가 있는 보기
  const v = box === 'archive' && (view === 'stages' || view === 'compact') ? 'table' : view;
  // 197차: 내 저장된 보기·열(user_settings — 기기 간 유지). 지금 고른 조건과 똑같은 저장 보기가 있으면 그 탭이 켜짐
  const myViews: { id: string; name: string; q: Record<string, string> }[] = mv ?? data?.myViews?.views ?? [];
  const colsOn: string[] = cols ?? data?.myViews?.cols ?? DEFAULT_COLS; const col = (k: string) => colsOn.includes(k);
  const curQ: Record<string, string> = Object.fromEntries(Object.entries({ lv, focus, chips: chipsQ, status, sort, rev, sort2, rev2, pri: fPri, owner: fOwner, region: fRegion, src: fSrc }).filter(([, x]) => x));
  const activeUv = myViews.find((x) => { const e = Object.entries(x.q ?? {}).filter(([, y]) => y); return e.length === Object.keys(curQ).length && e.every(([k, y]) => curQ[k] === y); })?.id ?? null;
  const pickTab = (k: string) => { setLv(k); setFocus(''); setBox(''); setSort(''); setRev(''); if (status && (k === 'closed') !== LEAD_CLOSED.has(status) && k !== 'all') setStatus(''); };
  const pickStatus = (x: string) => { setStatus(x); if (x && LEAD_CLOSED.has(x) && lv !== 'closed' && lv !== 'all') { setLv('closed'); setFocus(''); } else if (x && !LEAD_CLOSED.has(x) && lv === 'closed') setLv('open'); };
  const pickStrip = (k: string) => { const on = focus === k && lv === 'open'; setFocus(on ? '' : k); setLv('open'); setBox(''); setSort(''); setRev(''); if (status && LEAD_CLOSED.has(status)) setStatus(''); };
  const applyView = (x: { q: Record<string, string> }) => { const g = (k: string) => x.q?.[k] ?? ''; setLv(g('lv') || 'open'); setFocus(g('focus')); setChipsQ(g('chips')); setStatus(g('status')); setSort(g('sort')); setRev(g('rev')); setSort2(g('sort2')); setRev2(g('rev2')); setFPri(g('pri')); setFOwner(g('owner')); setFRegion(g('region')); setFSrc(g('src')); setBox(''); };
  const onSort = (k: string, shift = false) => {
    if (shift && k !== sortKey) { if (sort2 === k) setRev2(rev2 === '1' ? '' : '1'); else { setSort2(k); setRev2(''); } return; } // Shift+클릭 = 2차 정렬(다시 = 거꾸로)
    if (sortKey === k) setRev(rev === '1' ? '' : '1'); else { setSort(k); setRev(''); setSort2(''); setRev2(''); }
  };
  async function saveViews(body: { views?: { id: string; name: string; q: Record<string, string> }[]; cols?: string[] }, msg?: string) {
    try { const r = await api<{ views: any[]; cols: string[] | null }>('/api/sales/leads/views', { method: 'PUT', body }); setMv(r.views ?? []); if (r.cols) setCols(r.cols); if (msg) toast.ok(msg); } catch (e: any) { toast.error(e.message); }
  }
  const toggleCol = (k: string) => { const next = col(k) ? colsOn.filter((x) => x !== k) : [...colsOn, k]; setCols(next); void saveViews({ cols: next }); };
  const addView = () => { const name = (saving ?? '').trim(); if (!name) return; void saveViews({ views: [...myViews, { id: Math.random().toString(36).slice(2, 10), name, q: curQ }] }, `'${name}' 보기를 저장했습니다 — 다른 기기에서도 보입니다`); setSaving(null); };
  const delView = (x: { id: string; name: string }) => { if (!confirm(`'${x.name}' 보기를 지울까요?`)) return; void saveViews({ views: myViews.filter((y) => y.id !== x.id) }, '보기를 지웠습니다'); };
  // #610 ⓒ 보관함 [되돌리기] = 마지막 기록의 이전 단계(그것도 보류·실패면 신규리드)로 — 단계 기록에 사유가 남음
  const prevOf = (l: any) => (l.archive?.prev && !ARCHIVED_STAGES.has(l.archive.prev) ? l.archive.prev : '신규리드');
  const restoreLead = async (l: any) => { try { await api(`/api/sales/leads/${l.id}`, { method: 'PATCH', body: { status: prevOf(l), reason: '보관함에서 되돌림' } }); toast.ok(`되돌렸습니다 — '${ST.name(prevOf(l))}'로 기본 목록에 나옵니다`); reload(); } catch (e: any) { toast.error(e.message); } };
  const rowExtra = (l: any) => (isArch(l) ? <LeadArchiveCell l={l} ed={ed} onRestore={() => restoreLead(l)} /> : ed && l.status === '신규리드' ? <AdvanceButton l={l} people={data?.canAssign ? data.people ?? [] : null} me={me} onDone={reload} /> : null);
  // 197차(#461) 칸: 다음 행동(지남 빨강·오늘 주황·없으면 경고) · 마지막 접촉(n일 전 · 종류, 14일 넘으면 '오래 쉼') · 단계 머문 날 · 출처(공고 링크)
  const nextNote = (l: any) => (isClosed(l) ? (l.revisit ? <span className="text-ink-2" data-testid="lead-revisit">다시 볼 날 {kd(l.revisit)}</span> : null)
    : !l.next ? <span className="font-semibold text-red-600" data-testid="lead-no-next">⚠ 다음 행동 없음</span>
    : <span className={cx(l.next < td ? 'font-semibold text-red-600' : l.next === td ? 'font-semibold text-amber-600' : 'text-ink-2')}>{l.next < td ? '지남' : l.next === td ? '오늘' : ''}{l.nextAction ? <span className="font-normal text-ink-2">{l.next <= td ? ' · ' : ''}{l.nextAction}</span> : null}</span>);
  const nextCell = (l: any) => (isClosed(l) ? nextNote(l) ?? <span className="text-ink-3">—</span> : !l.next ? nextNote(l)
    : <span className={cx(l.next < td ? 'font-semibold text-red-600' : l.next === td ? 'font-semibold text-amber-600' : 'text-ink-2')}>{kd(l.next)}{l.next < td ? ' · 지남' : l.next === td ? ' · 오늘' : ''}{l.nextAction ? <span className="font-normal text-ink-2"> · {l.nextAction}</span> : null}</span>);
  const contactCell = (l: any) => { const d = kstDay(l.lastContact?.at); const n = d ? dayDiff(d, td) : null;
    return <span className="inline-flex flex-wrap items-center gap-1">{d ? <span className="tabular-nums">{n === 0 ? '오늘' : `${n}일 전`} · {l.lastContact.kind}</span> : <span className="text-ink-3">기록 없음</span>}{!isClosed(l) && STRIP_FN.stale(l) && <span className="rounded-full bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-800" data-testid="lead-stale">오래 쉼</span>}</span>; };
  const stageDays = (l: any) => { const d = kstDay(l.stageSince); const n = d ? dayDiff(d, td) : 0; return n >= 1 ? <span className="text-[10px] tabular-nums text-ink-3" title="이 단계에 머문 날" data-testid="lead-stage-days">{n}일</span> : null; };
  const srcCell = (l: any) => (!l.source ? null : l.source.href ? <Link href={l.source.href} className="underline" style={{ color: C }} onClick={(e) => e.stopPropagation()} data-testid="lead-source">{l.source.label}</Link> : <span data-testid="lead-source">{l.source.label}</span>);
  const th = (k: string, label: string) => <th key={k} className="whitespace-nowrap p-2" aria-sort={sortKey === k ? ((rev === '1') !== DESC_SORTS.has(k) ? 'descending' : 'ascending') : undefined}>
    <button type="button" onClick={(e) => onSort(k, e.shiftKey)} title="누르면 정렬 · 한 번 더 = 거꾸로 · Shift+클릭 = 2차 정렬" className="inline-flex items-center gap-0.5 hover:text-ink" data-testid={`leads-th-${k}`}>{label}{sort2 === k && sort2 !== sortKey && <span className="text-[10px] text-ink-3" data-testid="leads-th-sort2">{(rev2 === '1') !== DESC_SORTS.has(k) ? '▼' : '▲'}2</span>}{sortKey === k && <span aria-hidden className="text-[10px]">{(rev === '1') !== DESC_SORTS.has(k) ? '▼' : '▲'}</span>}</button></th>;
  const card = (l: any) => (
    <li key={l.id} className="text-sm" data-testid="sales-lead-card"><SwipeCard on={ed && !isClosed(l)} onLeft={() => setQuick({ mode: 'next', lead: l })} onRight={() => setQuick({ mode: 'log', lead: l })}><div className="rounded-card border border-line bg-white p-3"><button type="button" onClick={() => setOpen(l.id)} className="block w-full text-left" data-testid="sales-lead-open">
      <span className="flex flex-wrap items-center gap-1.5"><b>{l.name}</b><StageChip k={l.status} />{stageDays(l)}{l.priority && <span className="text-[11px] text-ink-2">{l.priority}</span>}</span>
      <span className="mt-0.5 block text-xs" data-testid="lead-card-next">{!isClosed(l) && l.next && <span className="text-ink-3">다음 연락 </span>}{nextCell(l)}</span>
      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">{contactCell(l)}{l.source && <span className="text-ink-3">· {l.source.label}</span>}{l.owner && <span className="text-ink-3">· 담당 {l.owner}</span>}</span>
      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">{interests(l.interests)}{[l.facility, l.region, l.scale, l.contact].filter(Boolean).join(' · ')}{l.revenue ? <span>{won(l.revenue)}</span> : null}</span>
    </button><div className="mt-2 flex flex-wrap items-center gap-1.5"><ContactRow phone={l.phone} links={[[l.homepage, '홈페이지']]} />{rowExtra(l)}</div></div></SwipeCard></li>);
  const NLF = (k: string, label: string, extra: Record<string, unknown> = {}) => <Field label={label}><input className={inputCls} value={nl?.[k] ?? ''} onChange={(e) => setNl({ ...nl!, [k]: e.target.value })} aria-label={label} data-testid={`lead-new-${k}`} {...extra} /></Field>;
  return (
    <div className="space-y-3" data-testid="sales-leads">
      <Head title="영업 진행" meta={data}><AiAsk space="sales" examples={AI_ASK_EXAMPLES.salesLeads} compact />{ed && <Button size="sm" onClick={() => { setNl({ ...EMPTY_NL }); setForceNew(false); setSimilar(null); }} data-testid="lead-new">새 리드</Button>}<Search value={s} onChange={setS} />{day === 'today' && <button type="button" onClick={() => setDay('')} className="rounded-full border px-2.5 py-0.5 text-xs" style={{ color: C, borderColor: C }} data-testid="leads-day-today">오늘 연락할 리드 ✕</button>}
        <select className={cx(inputCls, 'h-8 w-32 py-1 text-sm')} value={status} onChange={(e) => pickStatus(e.target.value)} aria-label="단계"><option value="">전체 단계</option>{statuses.map((x) => <option key={x} value={x}>{ST.name(x)}</option>)}</select></Head>
      {!data ? <Skeleton rows={5} /> : (
        <>
        {/* 197차(#461) '오늘 볼 것' 띠 — 진행 중 거래처 기준, 누르면 '전체 진행 중'에서 그 조건만(다시 누르면 풂) */}
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="오늘 볼 것" data-testid="leads-strip">
          {LEAD_STRIP.filter(([k]) => k !== 'unassigned' || stripN.unassigned > 0).map(([k, label]) => { const n = stripN[k] ?? 0; const on = focus === k && lv === 'open';
            const hot = n > 0 && (k === 'overdue' || k === 'none' || k === 'unassigned') ? 'text-red-600' : n > 0 && (k === 'today' || k === 'stale') ? 'text-amber-600' : 'text-ink';
            return <button key={k} type="button" onClick={() => pickStrip(k)} className={cx('min-w-[6.5rem] shrink-0 rounded-card border px-3 py-1.5 text-left', on ? 'border-brand-600 bg-brand-50' : 'border-line bg-white hover:border-brand-300', !n && !on && 'opacity-60')} aria-pressed={on} data-testid={`leads-strip-${k}`}>
              <span className="block text-[11px] text-ink-2">{label}</span><b className={cx('text-lg leading-tight tabular-nums', hot)} data-testid={`leads-strip-${k}-n`}>{n}</b></button>; })}
        </div>
        {/* 보기 탭 7개 + 내 보기(서버 저장 — 다른 기기에서도 그대로) */}
        <div ref={tabsRef} className="-mx-1 flex items-end gap-0.5 overflow-x-auto border-b border-line px-1" role="tablist" aria-label="보기" data-testid="leads-tabs">
          {LEAD_TABS.map(([k, label]) => { const on = !activeUv && lv === k; return <button key={k} type="button" role="tab" aria-selected={on} onClick={() => pickTab(k)} className={cx('shrink-0 border-b-2 px-2.5 py-1.5 text-sm', on ? 'font-semibold' : 'border-transparent text-ink-2 hover:text-ink')} style={on ? { borderColor: C, color: C } : undefined} data-testid={`leads-tab-${k}`}>{label} <span className="text-xs tabular-nums text-ink-3">{tabN[k] ?? 0}</span></button>; })}
          {myViews.map((x) => { const on = activeUv === x.id; return <span key={x.id} className={cx('flex shrink-0 items-center border-b-2', on ? '' : 'border-transparent')} style={on ? { borderColor: C } : undefined}>
            <button type="button" role="tab" aria-selected={on} onClick={() => applyView(x)} className={cx('py-1.5 pl-2.5 pr-1 text-sm', on ? 'font-semibold' : 'text-ink-2 hover:text-ink')} style={on ? { color: C } : undefined} data-testid="leads-uview">{x.name}</button>
            <button type="button" onClick={() => delView(x)} className="px-1 text-xs text-ink-3 hover:text-red-600" aria-label={`${x.name} 보기 지우기`} data-testid="leads-uview-del">✕</button></span>; })}
          {saving === null ? <button type="button" onClick={() => setSaving('')} className="shrink-0 px-2 py-1.5 text-xs font-medium hover:underline" style={{ color: C }} data-testid="leads-view-save">+ 보기 저장</button>
            : <form onSubmit={(e) => { e.preventDefault(); addView(); }} className="flex shrink-0 items-center gap-1 py-1"><input className={cx(inputCls, 'h-7 w-32 py-0 text-xs')} value={saving} onChange={(e) => setSaving(e.target.value)} maxLength={30} placeholder="보기 이름" aria-label="보기 이름" autoFocus data-testid="leads-view-name" />
              <Button size="sm" disabled={!saving.trim()} data-testid="leads-view-save-go">저장</Button><button type="button" onClick={() => setSaving(null)} className="text-xs text-ink-3">취소</button></form>}
        </div>
        {focus && STRIP_FN[focus] && lv === 'open' && <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2" data-testid="leads-focus">‘{LEAD_STRIP.find(([k]) => k === focus)?.[1]}’만 보는 중<button type="button" onClick={() => setFocus('')} className="underline" style={{ color: C }}>모두 보기</button></p>}
        {/* 단계 요약 줄(누르면 단계 필터) + 빠른 칩 + 정렬·필터(우선·담당·지역·출처)·보기·열·CSV */}
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 text-xs" data-testid="leads-stage-summary">{(data.stages ?? statuses).filter((st: string) => stageCount.get(st)).map((st: string) => <button key={st} type="button" onClick={() => pickStatus(status === st ? '' : st)} className={cx('shrink-0 rounded-full border px-2.5 py-0.5', status === st ? 'border-transparent text-white' : 'border-line bg-white')} style={status === st ? { background: C } : undefined} data-testid="leads-stage-chip">{ST.name(st)} <b>{stageCount.get(st)}</b></button>)}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="leads-toolbar">
          {LEAD_CHIPS.map(([k, l]) => { const on = chips.includes(k); return <button key={k} type="button" onClick={() => setChips(on ? chips.filter((x) => x !== k) : [...chips, k])} className={cx('rounded-full border px-2.5 py-0.5', on ? 'border-blue-300 bg-blue-50 font-semibold text-blue-800' : 'border-line bg-white text-ink-2')} aria-pressed={on} data-testid={`leads-chip-${k}`}>{l}</button>; })}
          <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
          <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={sort} onChange={(e) => { setSort(e.target.value); setRev(''); }} aria-label="정렬" data-testid="leads-sort">{LEAD_SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={fPri} onChange={(e) => setFPri(e.target.value)} aria-label="우선순위 필터" data-testid="leads-f-priority"><option value="">우선 전체</option>{Object.entries(PRI_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          {owners.length > 0 && <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={fOwner} onChange={(e) => setFOwner(e.target.value)} aria-label="담당 필터" data-testid="leads-f-owner"><option value="">담당 전체</option>{owners.map(([id, n]) => <option key={id} value={id}>{n}</option>)}<option value="-">담당 없음</option></select>}
          {regions.length > 0 && <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={fRegion} onChange={(e) => setFRegion(e.target.value)} aria-label="지역 필터" data-testid="leads-f-region"><option value="">지역 전체</option>{regions.map((r) => <option key={r}>{r}</option>)}</select>}
          {sources.length > 1 && <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={fSrc} onChange={(e) => setFSrc(e.target.value)} aria-label="출처 필터" data-testid="leads-f-source"><option value="">출처 전체</option>{sources.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>}
          <span className="hidden gap-0.5 rounded-input border border-line bg-white p-0.5 md:inline-flex" role="group" aria-label="보기">{LEAD_VIEWS.map(([k, l]) => <button key={k} type="button" onClick={() => pickView(k)} className={cx('rounded px-2 py-0.5', view === k ? 'text-white' : 'text-ink-2')} style={view === k ? { background: C } : undefined} aria-pressed={view === k} data-testid={`leads-view-${k}`}>{l}</button>)}</span>
          {v === 'table' && <details className="relative hidden md:block" data-testid="leads-cols"><summary className={cx(linkCls, 'cursor-pointer list-none')}>열</summary>
            <div className="absolute left-0 z-20 mt-1 w-44 space-y-1 rounded-card border border-line bg-white p-2 shadow-pop">{LEAD_COLS.map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={col(k)} onChange={() => toggleCol(k)} data-testid={`leads-col-${k}`} />{l}</label>)}
              <p className="text-[10px] text-ink-3">거래처·단계·다음 행동은 늘 보입니다. 고른 열은 다른 기기에서도 그대로입니다.</p></div></details>}
          <span className="ml-auto flex items-center gap-1.5"><span className="text-ink-3" data-testid="leads-count">{shown.length}건{sumRevenue ? ` · 예상 ${won(sumRevenue)}` : ''}</span>
            <button type="button" onClick={() => exportCsv()} className={linkCls} data-testid="leads-csv-export"><Download size={12} /> CSV</button>
            {ed && data.canAssign && <label className={cx(linkCls, 'cursor-pointer')} data-testid="leads-csv-import">CSV 가져오기<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickCsv(f); }} aria-label="CSV 파일" data-testid="leads-csv-file" /></label>}</span>
        </div>
        {!shown.length && all.length > 0 && (s || status || focus || chips.length || fPri || fOwner || fRegion || fSrc) && lv !== 'all' && <p className="rounded-input bg-slate-50 px-3 py-2 text-xs text-ink-2" data-testid="leads-empty-hint">이 보기에는 맞는 거래처가 없습니다 — <button type="button" onClick={() => pickTab('all')} className="underline" style={{ color: C }}>전체 보기에서 찾기</button></p>}
        {/* 197차(#461) 표: 거래처·담당자(아래 작은 글씨 지역·분류) · 단계(머문 날) · 다음 행동(날짜 + 할 일, 지남 빨강·오늘 주황·없으면 경고) · 고른 열(출처·마지막 접촉·예상 금액·담당·우선·관심 사업·시설·지역) — 열 머리를 누르면 정렬(두 번 = 거꾸로). 표 안에서 바로 고치기(거래처명·단계·다음 연락·우선·담당)는 그대로. 휴대폰은 카드 */}
        {ed && v === 'table' && sel.length > 0 && <div className="sticky top-0 z-10 hidden flex-wrap items-center gap-2 rounded-card border border-brand-200 bg-brand-50 p-2 text-sm md:flex" data-testid="leads-bulk-bar">
          <b>{sel.length}건 선택</b>
          {data.canAssign && <select className={cx(inputCls, 'h-8 !w-auto py-0 text-xs')} value="" onChange={(e) => void bulkOwner(e.target.value)} aria-label="담당 일괄 바꾸기" data-testid="leads-bulk-owner"><option value="">담당 바꾸기…</option><option value="-">담당 없음</option>{(data.people ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
          <Button size="sm" variant="secondary" onClick={() => setBulk('stage')} data-testid="leads-bulk-stage">단계 바꾸기</Button>
          <Button size="sm" variant="secondary" onClick={() => setBulk('next')} data-testid="leads-bulk-next">다음 연락일</Button>
          <button type="button" onClick={() => exportCsv(shown.filter((l) => sel.includes(l.id)))} className={linkCls} data-testid="leads-bulk-csv"><Download size={12} /> 고른 것 CSV</button>
          <button type="button" onClick={() => setSel([])} className="ml-auto text-xs text-ink-2 hover:underline" data-testid="leads-bulk-clear">선택 해제</button>
        </div>}
        {v === 'table' && <div className="hidden overflow-x-auto rounded-card border border-line bg-white shadow-card md:block" data-testid="leads-table"><table className="w-full min-w-[880px] text-sm"><thead className="bg-slate-50 text-left text-xs text-ink-2"><tr>
            {ed && <th className="w-8 p-2">{selectable.length > 0 && <input type="checkbox" checked={allSel} onChange={(e) => setSel(e.target.checked ? selectable.map((l: any) => l.id) : [])} aria-label="보이는 진행 중 거래처 모두 고르기" data-testid="leads-sel-all" />}</th>}{th('name', '거래처·담당자')}{th('stage', '단계')}{th('next', '다음 행동')}{col('source') && th('source', '출처')}{col('contact') && th('contact', '마지막 접촉')}{col('revenue') && th('revenue', '예상 금액')}{col('owner') && th('owner', '담당')}
            {col('priority') && <th className="whitespace-nowrap p-2">우선</th>}{col('interest') && <th className="whitespace-nowrap p-2">관심 사업</th>}{col('facility') && <th className="whitespace-nowrap p-2">시설</th>}{col('region') && <th className="whitespace-nowrap p-2">지역</th>}</tr></thead>
          <tbody>{shown.map((l: any) => <tr key={l.id} className="cursor-pointer border-t border-line align-top hover:bg-slate-50" onClick={(e) => { if (!(e.target as HTMLElement).closest('input,select,button,a')) setOpen(l.id); }} data-testid="sales-lead-row">
            {ed && <td className="w-8 p-2">{!isClosed(l) && <input type="checkbox" checked={sel.includes(l.id)} onChange={(e) => setSel(e.target.checked ? [...sel, l.id] : sel.filter((x) => x !== l.id))} aria-label={`${l.name} 고르기`} data-testid="lead-sel" />}</td>}
            <td className="p-2 font-medium">{ed ? <CellInput value={l.name} onSave={(v) => patchLead(l.id, { name: v })} label="거래처명" testId="cell-name" /> : l.name}{l.contact && <span className="block text-[11px] font-normal text-ink-3">{l.contact}{l.phone ? ` · ${l.phone}` : ''}</span>}
              {(!col('facility') || !col('region')) && (l.facility || l.region) && <span className="block text-[11px] font-normal text-ink-3">{[l.facility, l.region].filter(Boolean).join(' · ')}</span>}</td>
            <td className="p-2">{isArch(l) ? rowExtra(l) : <span className="flex flex-wrap items-center gap-1">{ed ? <select className="rounded border border-line bg-white px-1 py-0.5 text-xs" value={l.status ?? ''} aria-label="단계" data-testid="cell-status" onChange={(e) => { const v = e.target.value; if (v !== l.status) setStMove({ lead: l, to: v }); }}>{ST.pickable(data.stages ?? [], l.status).map((s: string) => <option key={s} value={s}>{ST.name(s)}</option>)}</select> : <StageChip k={l.status} />}{stageDays(l)}{rowExtra(l)}</span>}</td>
            <td className="p-2 text-xs" data-testid="cell-next-action">{ed && !isClosed(l) ? <span className="flex flex-col gap-0.5"><input key={`${l.id}:${l.next ?? ''}`} type="date" className={cx('w-fit rounded border bg-white px-1 py-0.5 text-xs', l.next && l.next < td ? 'border-red-300 text-red-700' : l.next === td ? 'border-amber-300 text-amber-700' : 'border-line')} defaultValue={l.next ?? ''} aria-label="다음 연락" data-testid="cell-next" onChange={(e) => patchLead(l.id, { nextContactDate: e.target.value || null })} />{nextNote(l)}</span> : nextCell(l)}</td>
            {col('source') && <td className="whitespace-nowrap p-2 text-xs">{srcCell(l)}</td>}
            {col('contact') && <td className="p-2 text-xs text-ink-2" data-testid="cell-contact">{contactCell(l)}</td>}
            {col('revenue') && <td className="p-2 text-xs tabular-nums">{won(l.revenue) || '-'}</td>}
            {col('owner') && <td className="p-2 text-xs">{ed && data.canAssign ? <select className="rounded border border-line bg-white px-1 py-0.5 text-xs" value={l.ownerId ?? ''} aria-label="담당" data-testid="cell-owner" onChange={(e) => patchLead(l.id, { ownerId: e.target.value || null })}><option value="">없음</option>{(data.people ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : l.owner ?? <span className="text-red-600">없음</span>}</td>}
            {col('priority') && <td className="p-2 text-xs">{ed ? <select className="rounded border border-line bg-white px-1 py-0.5 text-xs" value={l.priorityCode ?? ''} aria-label="우선" data-testid="cell-priority" onChange={(e) => patchLead(l.id, { priority: e.target.value || null })}><option value="">—</option>{Object.entries(PRI_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> : l.priority ?? ''}</td>}
            {col('interest') && <td className="p-2">{interests(l.interests)}</td>}{col('facility') && <td className="p-2 text-xs">{l.facility ?? ''}</td>}{col('region') && <td className="p-2 text-xs">{l.region ?? ''}</td>}</tr>)}
            {!shown.length && <tr><td colSpan={11} className="p-6 text-center text-ink-3">{lv === 'closed' ? '종결한 거래처가 없습니다 — 계약완료·보류·실패로 닫은 리드와 되돌린 리드가 여기에 모입니다' : lv === 'none' ? '다음 행동이 없는 진행 중 거래처가 없습니다' : '리드가 없습니다'}</td></tr>}</tbody></table></div>}
        {/* 대표 10/21 12:00 영업 재편 3): 진행 단계(예전 '파이프라인' 메뉴)는 리드·거래처 안 '단계별' 보기 — PC 칸반·휴대폰 단계 칩 목록 */}
        {v === 'stages' && <Pipeline embedded />}
        {v === 'compact' && <ul className="hidden divide-y divide-line rounded-card border border-line bg-white text-sm shadow-card md:block" data-testid="leads-compact">{shown.map((l: any) => <li key={l.id}><button type="button" onClick={() => setOpen(l.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"><span className="min-w-0 flex-1 truncate font-medium">{l.name}</span><StageChip k={l.status} /><span className="w-28 truncate text-xs text-ink-2">{l.owner ?? ''}</span><span className={cx('w-24 text-xs tabular-nums', l.next && l.next < td ? 'font-semibold text-red-600' : 'text-ink-3')}>{kd(l.next)}</span><span className="hidden w-24 text-right text-xs tabular-nums text-ink-3 lg:block">{won(l.revenue) || '-'}</span></button></li>)}{!shown.length && <li className="p-6 text-center text-ink-3">리드가 없습니다</li>}</ul>}
        {/* 대표 검수 10/20 ②: 전화·문자 줄과 홈페이지 칩을 카드 안에, 날짜 10. 22.(목). 휴대폰은 늘 카드 */}
        {ed && v !== 'stages' && !!shown.length && <p className="text-[11px] text-ink-3 md:hidden" data-testid="lead-swipe-hint">카드를 오른쪽으로 밀면 연락함 기록 · 왼쪽으로 밀면 다음 연락일 바꾸기</p>}
        <ul className={cx('space-y-2', v === 'cards' ? 'md:grid md:grid-cols-2 md:gap-2 md:space-y-0 xl:grid-cols-3' : 'md:hidden', v === 'stages' && 'hidden')} data-testid="sales-lead-cards">{shown.map(card)}{!shown.length && <li className="text-sm text-ink-3">리드가 없습니다</li>}</ul>
        </>
      )}
      {open && <LeadDetail id={open} onClose={() => setOpen(null)} onChange={reload} onOpen={setOpen} />}
      {stMove && <StageMoveDialog lead={{ id: stMove.lead.id, name: stMove.lead.name, next: stMove.lead.next }} to={stMove.to} onClose={() => setStMove(null)} onDone={(m) => { setStMove(null); toast.ok(m); reload(); }} />}
      {bulk && <BulkLeadDialog mode={bulk} ids={sel} stages={data?.stages ?? []} onClose={() => setBulk('')} onDone={bulkDone} />}
      {quick && <LeadQuickDialog mode={quick.mode} lead={{ id: quick.lead.id, name: quick.lead.name, next: quick.lead.next, nextAction: quick.lead.nextAction }} onClose={() => setQuick(null)} onDone={(m) => { setQuick(null); toast.ok(m); reload(); }} />}
      {nl && (
        <Modal open onClose={() => setNl(null)} title="새 리드" wide>
          <form onSubmit={newLead} className="grid gap-3 text-sm" data-testid="lead-new-form">
            {NLF('name', '거래처(리드) 이름', { required: true, maxLength: 300, autoFocus: true })}
            {!!similar?.length && <div className="rounded-input border border-amber-300 bg-amber-50 p-2 text-xs" data-testid="lead-new-similar"><b className="text-amber-800">비슷한 거래처 {similar.length}곳</b> — 이미 있으면 그 거래처를 열어 이어서 적으세요
              <ul className="mt-1 space-y-0.5">{similar.map((x) => <li key={x.id}><button type="button" onClick={() => { setNl(null); setOpen(x.id); }} className="underline">{x.name}</button> <StageChip k={x.status} /> <span className="text-ink-3">{x.region ?? ''}</span>{x.by && x.by !== 'name' && <span className="ml-1 font-semibold text-amber-800" data-testid="lead-new-same">같은 {SAME_BY[x.by] ?? x.by}</span>}</li>)}</ul></div>}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="단계"><select className={inputCls} value={nl.status} onChange={(e) => setNl({ ...nl, status: e.target.value })} aria-label="단계" data-testid="lead-new-status">{ST.pickable(data?.stages ?? ['신규리드'], nl.status).map((x: string) => <option key={x} value={x}>{ST.name(x)}</option>)}</select></Field>
              <Field label="우선순위"><select className={inputCls} value={nl.priority} onChange={(e) => setNl({ ...nl, priority: e.target.value })} aria-label="우선순위"><option value="">—</option>{Object.entries(PRI_KO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              {data?.canAssign ? <Field label="담당"><select className={inputCls} value={nl.ownerId} onChange={(e) => setNl({ ...nl, ownerId: e.target.value })} aria-label="담당"><option value="">나</option>{(data.people ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field> : NLF('nextContactDate', '다음 연락일', { type: 'date' })}
            </div>
            <div className="grid gap-3 sm:grid-cols-4">{NLF('facilityType', '시설 유형', { maxLength: 100, placeholder: '아파트·오피스텔…' })}{NLF('region', '지역', { maxLength: 50 })}{NLF('scale', '규모', { maxLength: 60, placeholder: '1,200세대' })}{NLF('expectedRevenue', '예상매출(원)', { inputMode: 'numeric' })}</div>
            <div className="grid gap-3 sm:grid-cols-4">{NLF('contactName', '고객 담당자', { maxLength: 100 })}{NLF('phone', '연락처', { maxLength: 40, inputMode: 'tel' })}{NLF('email', '이메일', { maxLength: 200, inputMode: 'email' })}{NLF('homepage', '홈페이지', { maxLength: 300, inputMode: 'url' })}</div>
            <div className="grid gap-3 sm:grid-cols-4">{NLF('bizNo', '사업자번호', { maxLength: 20, inputMode: 'numeric', placeholder: '123-45-67890' })}{data?.canAssign && NLF('nextContactDate', '다음 연락일', { type: 'date' })}</div>
            <Field label="메모"><textarea className={inputCls} rows={2} value={nl.memo} onChange={(e) => setNl({ ...nl, memo: e.target.value })} maxLength={5000} aria-label="메모" /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setNl(null)}>취소</Button><Button type="submit" disabled={!nl.name.trim()} data-testid="lead-new-save">{forceNew && similar?.length ? '그래도 만들기' : '만들기'}</Button></div>
          </form>
        </Modal>
      )}
      {imp && <LeadImportDialog data={imp} onClose={() => setImp(null)} onDone={reload} />}
    </div>
  );
}

/** #610 ⓒ·#614 보관함 줄 — 단계·사유·누가·언제 + [되돌리기](이전 단계로, 없으면 신규리드) */
function LeadArchiveCell({ l, ed, onRestore }: { l: any; ed: boolean; onRestore: () => void }) {
  const a = l.archive ?? {}; const ST = useStages();
  return <span className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="lead-archive"><StageChip k={l.status} />{a.reason && <span className="text-ink-2" data-testid="lead-archive-reason">사유: {a.reason}</span>}{(a.by || a.at) && <span className="text-ink-3">{[a.by, a.at && fmtDateTime(a.at)].filter(Boolean).join(' · ')}</span>}{ed && <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); onRestore(); }} data-testid="lead-archive-restore">되돌리기{a.prev ? `(${ST.name(a.prev)})` : ''}</Button>}</span>;
}
/** #610 ⓑ(대표 10/25 ⑥): 리드 목록 표·카드 [영업 진행으로] — 신규리드를 1차연락완료로 올리며 담당(관리자)·다음 연락일 지정(담당자에게 다음 연락 업무 자동) */
function AdvanceButton({ l, people, me, onDone }: { l: any; people: { id: string; name: string }[] | null; me?: string; onDone: () => void }) {
  const [open, setOpen] = useState(false); const [owner, setOwner] = useState<string>(l.ownerId ?? me ?? ''); const [next, setNext] = useState<string>(l.next ?? ''); const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { await api(`/api/sales/leads/${l.id}`, { method: 'PATCH', body: { status: '1차연락완료', ...(people && owner ? { ownerId: owner } : {}), ...(next ? { nextContactDate: next } : {}) } }); toast.ok('영업 진행(1차연락완료)으로 올렸습니다'); setOpen(false); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()}>{/* 표 줄 클릭(상세 열기)과 겹치지 않게 */}
      <button type="button" onClick={() => setOpen(true)} className={cx(linkCls, 'border-brand-600 text-brand-700')} data-testid="lead-advance"><ArrowRight className="size-3.5" aria-hidden />영업 진행으로</button>
      {open && <Modal open onClose={() => setOpen(false)} title="영업 진행으로">
        <div className="space-y-3 text-sm" data-testid="lead-advance-dialog">
          <p className="text-xs text-ink-2"><b>{l.name}</b> — 단계를 ‘1차연락완료’로 올리고 담당·다음 연락일을 정합니다. 담당자에게는 다음 연락 업무가 자동으로 갑니다.</p>
          <div className="grid gap-2 sm:grid-cols-2">{people && <Field label="담당"><select className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="담당" data-testid="lead-advance-owner"><option value="">그대로</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
            <Field label="다음 연락일"><input type="date" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} aria-label="다음 연락일" data-testid="lead-advance-next" /></Field></div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>취소</Button><Button disabled={busy} onClick={go} data-testid="lead-advance-go">{busy ? '올리는 중…' : '1차연락완료로'}</Button></div>
        </div>
      </Modal>}
    </span>
  );
}
const ARCHIVED_STAGES = new Set(CLOSED_STAGES); // 보관함 = 보류·실패·되돌림(계약완료는 ⑩ 대표 결정 전까지 기본 목록)
const STAGE_FALLBACK = ['신규리드', '1차연락완료', '미팅예정', '현장방문완료', '제안서작성중', '제안서발송완료', '견적협의', '계약검토', '계약완료', '보류', '실패'];
export function Pipeline({ embedded }: { embedded?: boolean } = {}) {
  const { data, error, reload } = useApi<any>('/api/sales/src?view=pipeline');
  const [open, setOpen] = useState<string | null>(null);
  const [stage, setStage] = useUrlState('pst', ''); // 앱 단계 칩. #242 2단계: 주소(?pst=)에 — 리드를 열었다 뒤로 와도 같은 단계
  // 202차(#461 ⑥): 단계 이동(PC 칸반 끌어 놓기·카드 select) = 묻는 창 — 진행 단계로 = 다음 연락일(+ 할 일), 종결로 = 사유(보류·실패 필수)·다시 볼 날
  const [move, setMove] = useState<{ lead: any; to: string } | null>(null); const ST = useStages();
  const [drag, setDrag] = useState<{ id: string; from: string } | null>(null); const [over, setOver] = useState('');
  const moveStage = (l: any, from: string, to: string) => { if (to && to !== from) setMove({ lead: l, to }); };
  // 끌어 놓을 곳(단계 칸 · 끄는 동안 아래에 뜨는 종결 칸) — 놓으면 묻는 창
  const dropProps = (st: string, key: string) => ({
    onDragOver: (e: React.DragEvent) => { if (drag && drag.from !== st) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== key) setOver(key); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? '' : o)); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); const d = drag; setOver(''); setDrag(null); const it = d ? (data?.columns ?? []).flatMap((x: any) => x.items).find((x: any) => x.id === d.id) : null; if (d && it) moveStage(it, d.from, st); },
  });
  if (error) return <ErrorBox error={error} retry={reload} />;
  const cols: any[] = data?.columns ?? []; const used = cols.filter((c) => c.items.length); const total = used.reduce((n, c) => n + c.items.length, 0);
  const shown = stage ? cols.filter((c) => c.status === stage) : used;
  return (
    <div className="space-y-3" data-testid="sales-pipeline">
      {!embedded && <Head title="진행 단계" meta={data} />}
      {!data ? <Skeleton rows={5} /> : <>
        {/* 영업 재편 5) 전환율(파이프라인 메뉴에서 흡수): 단계마다 지금 n · 거쳐 간 n(비율) + 계약 전환율 */}
        {data.funnel && <div className="rounded-card border border-line bg-white p-2 text-xs" data-testid="pipeline-funnel">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">전환율</span><span className="text-ink-2">리드 {data.funnel.total} → 계약완료 {data.funnel.won}{data.funnel.conversion !== null && <> (<b style={{ color: C }}>{data.funnel.conversion}%</b>)</>}</span>{data.funnel.lost > 0 && <span className="text-ink-3">· 실패 {data.funnel.lost}</span>}<span className="ml-auto text-ink-3">막대 = 그 단계를 거쳐 간 리드 비율</span></div>
          <div className="mt-1.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${data.funnel.stages.length}, minmax(0, 1fr))` }}>{data.funnel.stages.map((f: any) => <div key={f.status} className="min-w-0" title={`${ST.name(f.status)}: 지금 ${f.now} · 거쳐 간 ${f.reached} (${f.pct}%)`} data-testid="funnel-stage"><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${f.pct}%`, background: C }} /></div><div className="mt-0.5 truncate text-[10px] text-ink-2">{ST.name(f.status)}</div><div className="text-[10px] tabular-nums text-ink-3">{f.now}<span className="text-ink-3">/{f.reached}</span></div></div>)}</div>
        </div>}
        {/* 대표 검수 10/20 ②: 휴대폰은 가로 칸반(빈 칸 많고 좁음) 대신 단계 칩 + 목록, PC 는 칸반 그대로 */}
        <div className="md:hidden" data-testid="pipeline-list">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">{([['', `전체 ${total}`], ...used.map((c) => [c.status, `${ST.name(c.status)} ${c.items.length}`])] as [string, string][]).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setStage(k)} className={cx('shrink-0 rounded-full border px-3 py-1 text-xs', stage === k ? 'border-transparent text-white' : 'border-line bg-white')} style={stage === k ? { background: C } : undefined} data-testid="pipeline-stage">{l}</button>))}</div>
          <ul className="mt-2 space-y-2">{shown.flatMap((c) => c.items.map((l: any) => <li key={l.id}><button type="button" onClick={() => setOpen(l.id)} className="w-full rounded-card border border-line bg-white p-3 text-left text-sm" data-testid="pipeline-item">
            <span className="flex flex-wrap items-center gap-1.5"><b>{l.name}</b><StageChip k={c.status} /></span>
            <span className="mt-0.5 block text-xs text-ink-2">{[l.owner && `담당 ${l.owner}`, l.next && `다음 연락 ${kd(l.next)}`].filter(Boolean).join(' · ')}</span></button></li>))}
            {!shown.some((c) => c.items.length) && <li className="text-sm text-ink-3">리드가 없습니다</li>}</ul>
        </div>
        <div className="hidden gap-3 overflow-x-auto pb-2 md:flex">{cols.filter((c: any) => !ST.hidden(c.status) || c.items.length).map((c: any) => ( /* 207차: 숨긴 단계 칸은 거래처가 있을 때만 */
          <section key={c.status} className={cx('w-60 shrink-0 rounded-card border border-line bg-slate-50 p-2', over === c.status && 'border-brand-400 bg-brand-50 ring-2 ring-brand-300')} data-testid="pipeline-col" data-status={c.status} {...dropProps(c.status, c.status)}><h2 className="mb-2 text-xs font-semibold">{ST.name(c.status)} <span className="text-ink-3">{c.items.length}</span></h2>
            <ul className="space-y-1.5">{c.items.map((l: any) => <li key={l.id} draggable={data.readOnly === false} data-testid="pipeline-card" className={cx(data.readOnly === false && 'cursor-grab', drag?.id === l.id && 'opacity-50')}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.id); setDrag({ id: l.id, from: c.status }); }} onDragEnd={() => { setDrag(null); setOver(''); }}><button type="button" onClick={() => setOpen(l.id)} className="w-full rounded-input border border-line bg-white p-2 text-left text-sm hover:border-blue-300"><span className="block truncate font-medium">{l.name}</span><span className="block truncate text-[11px] text-ink-2">{[l.owner, l.next && `연락 ${kd(l.next)}`].filter(Boolean).join(' · ')}</span></button>{data.readOnly === false && <select className={cx(inputCls, 'mt-1 h-7 w-full py-0 text-[11px]')} value={c.status} onChange={(e) => moveStage(l, c.status, e.target.value)} aria-label={`${l.name} 단계 이동`} data-testid="pipeline-move">{ST.pickable(data.stages ?? STAGE_FALLBACK, c.status).map((st: string) => <option key={st} value={st}>{ST.name(st)}</option>)}</select>}</li>)}</ul></section>))}</div>
      </>}
      {open && <LeadDetail id={open} onClose={() => setOpen(null)} onChange={reload} onOpen={setOpen} />}
      {/* 끄는 동안 아래에 종결 칸(성사·보류·실패) — 단계가 12칸이라 오른쪽 끝 칸까지 끌고 가지 않아도 되게(Pipedrive 의 끌기 중 '성사·실패' 칸과 같은 흐름) */}
      {drag && <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 hidden justify-center md:flex"><div className="pointer-events-auto flex items-center gap-2 rounded-card border border-line bg-white p-2 shadow-lg" data-testid="pipeline-drop-bar">
        <span className="px-1 text-xs text-ink-3">여기에 놓아 종결</span>
        {(['계약완료', '보류', '실패'] as const).filter((st) => st !== drag.from).map((st) => (
          <div key={st} data-testid="pipeline-drop" data-status={st} {...dropProps(st, `bar:${st}`)}
            className={cx('min-w-28 rounded-input border-2 border-dashed px-4 py-3 text-center text-sm font-semibold', over === `bar:${st}` ? 'border-brand-500 bg-brand-50 text-brand-800' : st === '계약완료' ? 'border-emerald-300 text-emerald-800' : 'border-line text-ink-2')}>{st === '계약완료' ? `성사(${ST.name(st)})` : ST.name(st)}</div>))}
      </div></div>}
      {move && <StageMoveDialog lead={{ id: move.lead.id, name: move.lead.name, next: move.lead.next }} to={move.to} onClose={() => setMove(null)} onDone={(m) => { setMove(null); toast.ok(m); reload(); }} />}
    </div>
  );
}

/** S2 2차(감사 1-16): 제안·계약 표(칸 보강) + 계약 종료 KPI + ROI(기간 3/6/12개월: 계약금액·영업비용·ROI·전환율·출처별) + 영업비용 입력(관리자) */
const g = (r: any, ...keys: string[]) => { for (const k of keys) { const v = r?.[k]; if (v !== null && v !== undefined && v !== '') return v; } return null; };
const pct = (v: number | null) => (v === null ? '-' : `${v}%`);
function Deals() {
  const [months, setMonths] = useUrlState('dm', '6'); // #242 2단계: 보던 기간은 주소(?dm=)에
  const { data, error, reload } = useApi<any>(`/api/sales/src?view=deals&status=${months}`, [months]);
  const [cost, setCost] = useState({ month: today().slice(0, 7), business: '', item: '', amount: '', memo: '' });
  async function addCost(e: React.FormEvent) {
    e.preventDefault(); if (!cost.item.trim() || !cost.amount) return;
    try { await api('/api/sales/costs', { body: { month: cost.month, business: cost.business || undefined, item: cost.item.trim(), amount: numOf(cost.amount) ?? 0, memo: cost.memo || undefined } }); toast.ok('비용을 적었습니다'); setCost({ ...cost, item: '', amount: '', memo: '' }); reload(); } catch (er: any) { toast.error(er.message); }
  }
  async function del(id: string) { try { await api(`/api/sales/records/${id}`, { method: 'DELETE' }); toast.ok('지웠습니다'); reload(); } catch (e: any) { toast.error(e.message); } }
  if (error) return <ErrorBox error={error} retry={reload} />;
  const ed = data?.readOnly === false; const roi = data?.roi; const kpi = data?.kpi;
  const Tbl = ({ kind, cols, rows }: { kind: 'proposals' | 'contracts'; cols: [string, (r: any) => React.ReactNode][]; rows: any[] }) => (
    <>
      <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[800px] text-sm" data-testid={`deals-table-${kind}`}><thead className="bg-slate-50 text-left text-xs text-ink-2"><tr>{cols.map(([h]) => <th key={h} className="whitespace-nowrap p-2">{h}</th>)}{ed && <th className="p-2" />}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r.__id} className="border-t border-line" data-testid={`deals-row-${kind}`}>{cols.map(([h, f]) => <td key={h} className="p-2 text-xs">{f(r)}</td>)}{ed && <td className="p-2 text-right">{/^[0-9a-f-]{36}$/i.test(String(r.__id)) && <button type="button" onClick={() => del(r.__id)} className="text-[11px] text-ink-3 underline" aria-label={`${g(r, 'title')} 삭제`} data-testid="deals-del">삭제</button>}</td>}</tr>)}
          {!rows.length && <tr><td colSpan={cols.length + 1} className="p-4 text-center text-xs text-ink-3">아직 없습니다</td></tr>}</tbody></table></div>
      <ul className="space-y-2 md:hidden">{rows.map((r) => <li key={r.__id} className="rounded-input border border-line p-2 text-sm"><b>{g(r, 'title')}</b> <span className="text-xs text-ink-2">{g(r, 'lead_name')}</span><div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-2">{cols.slice(2, 6).map(([h, f]) => { const v = f(r); return v ? <span key={h}>{h} {v}</span> : null; })}</div></li>)}{!rows.length && <li className="text-xs text-ink-3">아직 없습니다</li>}</ul>
    </>);
  const money = (v: unknown) => won(v) || '-';
  const PCOLS: [string, (r: any) => React.ReactNode][] = [['거래처', (r) => g(r, 'lead_name', 'company')], ['제목', (r) => <b>{g(r, 'title')}</b>], ['버전', (r) => g(r, 'version')], ['제안 금액', (r) => money(g(r, 'amount'))], ['최종 금액', (r) => money(g(r, 'final_amount'))], ['월 운영비', (r) => money(g(r, 'monthly_fee'))], ['제안일', (r) => kd(g(r, 'proposal_date', 'date'))], ['계약 예상', (r) => kd(g(r, 'expected_contract_date', 'expected_close_date'))], ['상태', (r) => chip(g(r, 'status'))], ['사업', (r) => g(r, 'business')], ['메모', (r) => <span className="line-clamp-1 max-w-[12rem]">{g(r, 'memo')}</span>]];
  const CCOLS: [string, (r: any) => React.ReactNode][] = [['거래처', (r) => g(r, 'lead_name', 'company')], ['제목', (r) => <b>{g(r, 'title')}</b>], ['금액', (r) => money(g(r, 'amount'))], ['계약일', (r) => kd(g(r, 'contract_date', 'date', 'signed_at'))], ['시작', (r) => kd(g(r, 'start_date'))], ['종료', (r) => { const e = g(r, 'end_date', 'contract_end_date'); return e ? <span className={String(e) < today() ? 'text-ink-3' : ''}>{kd(e)}</span> : '-'; }], ['PM', (r) => g(r, 'pm')], ['재계약', (r) => g(r, 'renew_stage')], ['상태', (r) => chip(g(r, 'status'))], ['사업', (r) => g(r, 'business')]];
  return (
    <div className="space-y-3" data-testid="sales-deals">
      <Head title="제안·계약" meta={data} />
      {!data ? <Skeleton rows={3} /> : <>
        {kpi && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="deals-kpi">{([['90일 내 종료', kpi.d90], ['180일 내', kpi.d180], ['1년 내', kpi.d365], ['기간 지남', kpi.past]] as [string, number][]).map(([l, n]) => <div key={l} className="rounded-card border border-line bg-white p-3 shadow-card"><div className="text-xs text-ink-2">{l}</div><div className="text-xl font-bold tabular-nums">{n}<span className="text-xs font-normal text-ink-3"> 건</span></div></div>)}</div>}
        <section className="rounded-card border border-line bg-white p-3 shadow-card"><h2 className="mb-2 text-sm font-semibold">제안·견적 <span className="text-ink-3">{data.proposals.length}</span></h2>
          {ed && <div className="mb-2"><RecordForm kind="proposals" leads={data.leads ?? []} onSaved={reload} /></div>}<Tbl kind="proposals" cols={PCOLS} rows={data.proposals} /></section>
        <section className="rounded-card border border-line bg-white p-3 shadow-card"><h2 className="mb-2 text-sm font-semibold">계약 <span className="text-ink-3">{data.contracts.length}</span> <Link href="/s/sales/contracts" className="ml-2 text-xs font-normal underline" style={{ color: C }}>계약만료·재입찰 보기</Link></h2>
          {ed && <div className="mb-2"><RecordForm kind="contracts" leads={data.leads ?? []} onSaved={reload} /></div>}<Tbl kind="contracts" cols={CCOLS} rows={data.contracts} /></section>
        {roi && <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="deals-roi">
          <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">영업 ROI</h2><select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={months} onChange={(e) => setMonths(e.target.value)} aria-label="기간" data-testid="roi-months">{[['3', '최근 3개월'], ['6', '최근 6개월'], ['12', '최근 12개월']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><span className="text-xs text-ink-3">{kd(roi.from)} ~ 오늘 · 계약일 기준</span></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 text-sm">{([['계약 금액', money(roi.contractAmount)], ['영업비용', money(roi.cost)], ['ROI', pct(roi.roi)], ['새 리드', `${roi.newLeads}건`], ['계약한 거래처', `${roi.wonLeads}곳`], ['전환율', pct(roi.conversion)]] as [string, string][]).map(([l, v]) => <div key={l} className="rounded-input border border-line p-2"><div className="text-[11px] text-ink-2">{l}</div><div className="font-semibold tabular-nums" data-testid={`roi-${l}`}>{v}</div></div>)}</div>
          {!!Object.keys(roi.bySource ?? {}).length && <table className="mt-2 w-full text-xs" data-testid="roi-sources"><thead className="text-left text-ink-2"><tr><th className="p-1">출처</th><th className="p-1">리드</th><th className="p-1">계약</th><th className="p-1">전환율</th></tr></thead><tbody>{Object.entries(roi.bySource as Record<string, { leads: number; won: number }>).map(([k, v]) => <tr key={k} className="border-t border-line"><td className="p-1">{k}</td><td className="p-1 tabular-nums">{v.leads}</td><td className="p-1 tabular-nums">{v.won}</td><td className="p-1 tabular-nums">{v.leads ? Math.round((v.won / v.leads) * 1000) / 10 : 0}%</td></tr>)}</tbody></table>}
          <p className="mt-1 text-[11px] text-ink-3">ROI = (계약 금액 − 영업비용) ÷ 영업비용. 비용이 없으면 계산하지 않습니다.</p>
          {ed && data.canAssign && <form onSubmit={addCost} className="mt-2 grid gap-2 rounded-input border border-blue-200 bg-blue-50/40 p-2 text-sm sm:grid-cols-[8rem_8rem_1fr_8rem_1fr_auto]" data-testid="cost-form">
            <input type="month" className={cx(inputCls, 'h-8 py-1 text-xs')} value={cost.month} onChange={(e) => setCost({ ...cost, month: e.target.value })} aria-label="월" />
            <input className={cx(inputCls, 'h-8 py-1 text-xs')} value={cost.business} onChange={(e) => setCost({ ...cost, business: e.target.value })} placeholder="사업" maxLength={60} aria-label="사업" />
            <input className={cx(inputCls, 'h-8 py-1 text-xs')} value={cost.item} onChange={(e) => setCost({ ...cost, item: e.target.value })} placeholder="항목(광고·출장·인건비…)" maxLength={100} aria-label="항목" data-testid="cost-item" />
            <input className={cx(inputCls, 'h-8 py-1 text-xs')} value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} placeholder="금액(원)" inputMode="numeric" aria-label="금액" data-testid="cost-amount" />
            <input className={cx(inputCls, 'h-8 py-1 text-xs')} value={cost.memo} onChange={(e) => setCost({ ...cost, memo: e.target.value })} placeholder="메모" maxLength={500} aria-label="메모" />
            <Button size="sm" disabled={!cost.item.trim() || !cost.amount} data-testid="cost-save">비용 적기</Button></form>}
          {!!roi.costs?.length && <ul className="mt-2 divide-y divide-line rounded-input border border-line text-xs" data-testid="cost-list">{roi.costs.map((c: any) => <li key={c.__id} className="flex items-center gap-2 p-1.5"><span className="tabular-nums text-ink-2">{c.month}</span><span className="min-w-0 flex-1 truncate">{c.item}{c.business ? ` · ${c.business}` : ''}{c.memo ? <span className="text-ink-3"> — {c.memo}</span> : null}</span><span className="tabular-nums">{money(c.amount)}</span>{ed && data.canAssign && <button type="button" onClick={() => del(c.__id)} className="text-ink-3 underline" aria-label={`${c.item} 삭제`}>삭제</button>}</li>)}</ul>}
        </section>}
      </>}
    </div>
  );
}
export { Deals };

/** #611(대표 10/25 ⑦): 입찰·공고 = 영업기회 허브 '입찰' 탭 하나(검색·사업 칩·일괄·상세 전부). embedded = 허브 안(주소 칸 bt·bq·bz·bs — 허브의 tab·q 와 겹치지 않게). 옛 /s/sales/bids 주소는 여기로 넘어옴 */
const BID_CHIPS: [string, string][] = [['open', '진행 중(마감 임박순)'], ['today', '오늘 새 공고'], ['working', '진행 기록 있음'], ['all', '관련 전체'], ['closing', '오늘 마감'], ['recruit', '협력사 모집']]; // #608: '마감 임박'·'준비 기간' 칩은 뺌(카드 왼쪽 줄로)
const BID_SORTS: [string, string][] = [['', '기본 순서'], ['deadline', '마감 D-day순'], ['notice', '공고일 최신순'], ['amount', '예산 큰 순']];
export function Bids({ initialTab, initialId, embedded }: { initialTab?: string; initialId?: string; embedded?: boolean }) {
  // #242 2단계: 탭·검색어·사업·정렬은 주소에 — 공고에서 업무·리드로 갔다 뒤로 와도 같은 목록
  // 기본 칩은 고정 '진행 중'(#613 대표 10/25: 모니터링은 진행 중 먼저) — 앱 하단 '영업기회'·당일 메일 링크는 ?bt=today 로 오늘 새 공고를 바로 연다
  const sp = useSearchParams();
  const [tab, setTab] = useUrlState(embedded ? 'bt' : 'tab', embedded ? (initialTab ?? 'open') : 'open'); const [s, setS] = useUrlState(embedded ? 'bq' : 'q', ''); const [open, setOpen] = useState<any>(null); const [biz, setBiz] = useUrlState(embedded ? 'bz' : 'biz', '');
  const [sort, setSort] = useUrlState(embedded ? 'bs' : 'sort', ''); // #606 정렬(주소에 저장 — 새로 고침해도 유지)
  const { data, error, reload } = useApi<any>(`/api/sales/src?${q({ view: 'bids', tab, q: s, biz, sort })}`, [tab, s, biz, sort]);
  // #510: 당일 공고 메일 제목(?id=) → 그 공고 상세를 바로 — 지금 탭 목록에 없어도 한 건 찾아서. #242 2단계: 허브 안·뒤로가기로 돌아온 상세도(?id=)
  const [deep, setDeep] = useState<string | null>(initialId ?? sp.get('id'));
  const one = useApi<any>(deep ? `/api/sales/src?${q({ view: 'bids', tab: 'all', q: deep })}` : null, [deep]);
  useEffect(() => { if (!deep || !one.data) return; const n = one.data.items?.find((x: any) => String(x.id) === deep); if (n) setOpen(n); else toast.info('이 공고는 지금 관련 공고 목록에 없습니다 — 메일의 [원문]으로 확인해 주세요'); setDeep(null); }, [deep, one.data]);
  const [sel, setSel] = useState<string[]>([]); // 대표 10/20 14:15 ④ 일괄 선택
  useEffect(() => setSel([]), [tab]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  // 메일·홈 링크로 온 soon(마감 임박)·prep(준비 기간)·ref(참고) 탭은 칩에 없지만 그 탭에 있는 동안만 칩으로 보여 줌
  const extra: [string, string][] = tab === 'ref' ? [['ref', '참고(검색어만 일치)']] : tab === 'soon' ? [['soon', '마감 임박(3일)']] : tab === 'prep' ? [['prep', '준비 기간(D-10 안)']] : [];
  const chips: [string, string][] = [...BID_CHIPS.map(([k, l]) => [k, k === 'today' && data ? `${l} ${data.todayCount ?? 0}` : l] as [string, string]), ...extra, ['skip', `대상 아님${data ? ` ${data.skipCount ?? 0}건` : ''}`]];
  return (
    <div className="space-y-3" data-testid="sales-bids">
      {!!data?.categories?.length && <div className="flex flex-wrap items-center gap-1.5" data-testid="sales-bids-biz"><span className="text-[11px] text-ink-3">사업</span>
        {[['', '전체'], ...data.categories.map((c: any) => [c.key, c.name]), ['none', '미분류']].map(([k, l]) => <button key={k} type="button" onClick={() => setBiz(k)} data-testid={`sales-bids-biz-${k || 'all'}`} className={cx('rounded-full border px-2.5 py-0.5 text-xs', biz === k ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800' : 'border-line bg-white')}>{l}</button>)}
        <Link href="/s/sales/sources#biz" className="text-[11px] text-ink-3 underline">관심 사업 설정</Link></div>}
      <Head title="입찰·공고 모니터링" meta={data}><AiAsk space="sales" examples={AI_ASK_EXAMPLES.salesBids} compact /><Search value={s} onChange={setS} /></Head>
      {data?.canAssign && data?.readOnly === false && <BidLeadsBanner onDone={reload} />}
      <div className="flex flex-wrap items-center gap-1.5">{chips.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} data-testid={`sales-bids-tab-${k}`} className={cx('rounded-full border px-3 py-1 text-xs', tab === k ? 'border-transparent text-white' : 'border-line')} style={tab === k ? { background: C } : undefined}>{l}</button>)}
        <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬" data-testid="bids-sort">{BID_SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {data && <span className="self-center text-xs text-ink-3">{data.items.length}{data.items.length === 300 ? '+(최근 300)' : ''} / 관련 {data.total}</span>}</div>
      {!data ? <Skeleton rows={6} /> : <ul className="space-y-1.5">{data.items.map((n: any) => <li key={n.id} className="relative">{data.readOnly === false && !n.workLeadId && <input type="checkbox" className="absolute right-3 top-3 z-10 size-4" checked={sel.includes(n.id)} onChange={(e) => setSel((v) => e.target.checked ? [...v, n.id] : v.filter((x) => x !== n.id))} aria-label={`${n.title} 선택`} data-testid="bid-select" />}<BidCard n={n} onOpen={() => setOpen(n)} onChange={reload} canWrite={data.readOnly === false} /></li>)}
        {!data.items.length && <li className="text-sm text-ink-3">해당 공고가 없습니다</li>}</ul>}
      {/* 로컬 10/24 12:20(#537 후속): 오늘 새 공고에서 뺀 결과(낙찰·유찰) — 당일 메일 '결과' 구역과 같은 기준, 접어 둠 */}
      {tab === 'today' && !!data?.results?.length && <details className="rounded-card border border-line bg-slate-50 p-2" data-testid="bids-results">
        <summary className="cursor-pointer text-sm font-semibold text-ink-2">결과(낙찰·유찰) {data.results.length}건 <span className="font-normal text-ink-3">— 새 공고가 아닌 결과</span></summary>
        <ul className="mt-2 space-y-1.5">{data.results.map((n: any) => <BidCard key={n.id} n={n} onOpen={() => setOpen(n)} onChange={reload} canWrite={data.readOnly === false} />)}</ul></details>}
      <BulkBar kind="bid" ids={sel} onDone={reload} onClear={() => setSel([])} />
      {open && <BidDetail n={data?.items.find((x: any) => x.id === open.id) ?? open} admin={data?.canAssign} canWrite={data?.readOnly === false} onChange={reload} onClose={() => setOpen(null)} />}
    </div>
  );
}
/** 대표 검수 10/20 ②: 입찰 상세 — 한국어 칸만(공고명·단지·발주처·마감·예산·문서·연락처·상태·메모·다음 조치), 관리자 '원본 보기' 접힘 */
function BidDetail({ n, admin, canWrite, onChange, onClose }: { n: any; admin?: boolean; canWrite?: boolean; onChange?: () => void; onClose: () => void }) {
  useBackClose(true, onClose, ['id', String(n.id)]); // #535: 휴대폰 뒤로가기 = 공고 상세만 닫힘(메일 링크 ?id= 와 같은 주소)
  // S1-4: 원본 상세 그대로 — [공식 원문][공고문][첨부 각각], 정보 칸(마감·예산·낙찰·추정가격·계약방식·계약기간·공고일·DB 등록)은 값이 없으면 '후속조사 필요', 접힘 '과업·참가자격·요건 상세'
  const docs = [n.search ? <SearchHintChip key="u" h={n.search} /> : n.url && <a key="u" href={n.url} target="_blank" rel="noopener noreferrer" className={cx(linkCls, 'text-ink-2')} data-testid="bid-doc-url"><ExternalLink className="size-3.5" aria-hidden />공식 원문</a>,
    ...(n.attachments ?? []).map((a: any, i: number) => attUrl(a) && <a key={i} href={attHref(a, i, bidCtx(n))} target="_blank" rel="noopener noreferrer" className={cx(linkCls, 'text-ink-2')} data-testid="bid-doc-file"><Download className="size-3.5" aria-hidden />{attName(a, i)}</a>)].filter(Boolean);
  const unk = (v: unknown) => (v === null || v === undefined || v === '' ? <span className="text-ink-3">{UNK2}</span> : v as React.ReactNode);
  const D8: [string, unknown][] = [['주요 과업', n.detail?.tasks], ['참가 자격', n.detail?.qualification], ['실적 요건', n.detail?.performance], ['지역 제한', n.detail?.regionLimit], ['면허·등록', n.detail?.license], ['공동수급·하도급', n.detail?.joint], ['현장설명회', n.detail?.briefing], ['제안 발표', n.detail?.presentation]];
  return (
    <Modal open onClose={onClose} title={n.title} wide>
      <div className="space-y-3" data-testid="bid-detail">
        <AiAsk space="sales" examples={AI_ASK_EXAMPLES.salesBid} subject={`공고 ${String(n.title).slice(0, 40)}`} compact testId="ai-ask-bid" />
        <div className="flex flex-wrap gap-1.5 text-[11px]">{[n.classification ?? n.category, n.businesses?.map((b: any) => b.name).join('·') || null, n.status, n.fit !== null && n.fit !== undefined && `적합 ${n.fit}`, n.sourceLabel && `${n.sourceLabel}${n.noticeNo ? ` ${n.noticeNo}` : ''}`].filter(Boolean).map((b, i) => <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-ink-2">{String(b)}</span>)}</div>
        <KoDl rows={[['공고명', n.title], ['단지', n.complex], ['발주처', n.agency], ['지역', n.region], ['공고 종류', n.noticeType], ['적합 사업', n.businesses?.length ? n.businesses.map((b: { name: string }) => b.name).join(' · ') : n.fitBusiness],
          ['마감', n.deadline ? kdt(n.deadline) : unk(null)], ['예산', won(n.amount) || (n.amount ? String(n.amount) : unk(null))], ['낙찰', n.winner ? [n.winner, won(n.awardAmount), n.awardDate && kd(n.awardDate)].filter(Boolean).join(' · ') : unk(null)],
          ['추정가격', won(n.estimated) || unk(n.estimated)], ['계약방식', unk(n.contractMethod)], ['계약기간', unk(n.contractPeriod)], ['공고일', n.noticeDate ? kd(n.noticeDate) : unk(null)], ['DB 등록', n.posted ? kd(n.posted) : unk(null)],
          ['세대수', n.households && `${n.households}세대`], ['업종', n.industry !== n.noticeType && n.industry], ['키워드', n.keywords], ['대표 판단', n.judgment && `${n.judgment}${n.salesPoint ? ` · 영업 포인트: ${n.salesPoint}` : ''}`], ['부족 자격', n.qualificationGap],
          ['문서', docs.length ? <span className="flex flex-wrap gap-1.5">{docs}</span> : null], ['연락처', (n.phone || n.address || n.fax) && <span className="space-y-1"><ContactRow phone={n.phone} />{n.address && <span className="block text-xs text-ink-2">{String(n.address)}</span>}{n.fax && <span className="block text-xs text-ink-3">팩스 {String(n.fax)}</span>}</span>],
          ['상태', n.work], ['메모', n.workMemo], ['다음 조치', n.workNext && kd(n.workNext)]]} />
        <details className="rounded-input border border-line p-2 text-sm" data-testid="bid-detail-more"><summary className="cursor-pointer text-ink-2">과업 · 참가자격 · 요건 상세{D8.some(([, v]) => v) ? '' : ' (아직 없음 — 후속조사)'}</summary>
          <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1">{D8.map(([k, v]) => [<dt key={k} className="text-ink-3">{k}</dt>, <dd key={k + 'v'} className="whitespace-pre-wrap break-words">{v ? String(v) : <span className="text-ink-3">{UNK2}</span>}</dd>])}</dl></details>
        {canWrite && (n.workBid ? <BidTaskPanel n={n} onSaved={() => onChange?.()} /> : <WorkPanel kind="bid" id={String(n.id)} cur={{ status: n.work, memo: n.workMemo, next: n.workNext, leadId: n.workLeadId }} onSaved={() => onChange?.()} />)}
        <RawFold row={n.raw} admin={admin} testId="bid-raw" />
      </div>
    </Modal>
  );
}

/** #606(대표 10/25 ②): 탭별 정렬 메뉴 — 값은 서버(srcViews hub)가 같은 이름으로 정렬, 주소 ?sort= 에 저장 */
const HUB_SORTS: Record<string, [string, string][]> = {
  buildings: [['', '기본 순서'], ['completion', '준공 예정순'], ['moveIn', '입주 예정순'], ['households', '세대수 많은 순'], ['firstSeen', 'DB 등록 최신순']],
  facilities: [['', '기본(세대수·점수)'], ['completion', '준공일순'], ['moveIn', '입주일순'], ['elapsed', '경과일 긴 순'], ['households', '세대수 많은 순'], ['next', '다음 연락순']],
  vendors: [['', '기본 순서'], ['period', '모집 시기순'], ['rank', '순위순'], ['firstSeen', 'DB 등록 최신순']],
};
const chipCls = (on: boolean) => cx('rounded-full border px-2.5 py-0.5', on ? 'border-blue-300 bg-blue-50 font-semibold text-blue-800' : 'border-line bg-white text-ink-2');
export function Hub({ initialSub }: { initialTab?: string; initialDay?: string; initialSub?: string }) { // initialTab·initialDay 는 주소(?tab·?day)에서 직접 읽음
  // 대표 10/21 12:00 영업 재편 3): 허브 = 모든 기회 원천의 입구 — 신규 현장·준공 시설·협력사 + 계약만료·재입찰·공공데이터·지역별 카테고리
  const sess = useSession(); const bidsOn = sess.features.salesBids !== false;
  const allowed: string[] | null = sess.features.salesHubTabs ?? null; // #611(대표 10/25 ⑦): 회사가 켠 수집 DB 종류의 탭만(데이터 설정에서 끈 종류는 숨김)
  // #537(대표 10/24): 영업기회 안 '입찰' 탭(켠 회사만) — 앱 하단 '영업기회'가 여기로(?tab=bids&bt=today). #611: 이제 입찰·공고 전체 기능이 이 탭
  // #242 2단계: 탭·검색어·오늘만·보관함·정렬·필터는 주소에, 상세는 ?id= — 상세에서 리드·업무로 갔다 뒤로 와도 같은 탭·같은 상세
  const sp = useSearchParams();
  const T = useSalesTerms(); // #408
  const tabs = ([...(bidsOn ? [['bids', '입찰']] : []), ['buildings', T.buildingsTab], ['facilities', T.facilitiesTab], ['vendors', T.vendorsTab], ...(bidsOn ? [['contracts', '계약만료·재입찰']] : []), ['prospects', '공공데이터'], ['regions', '지역별']] as [string, string][]).filter(([k]) => !allowed || allowed.includes(k));
  const [tabQ, setTab] = useUrlState('tab', 'buildings'); const tab = tabs.some(([k]) => k === tabQ) ? tabQ : (tabs.some(([k]) => k === 'buildings') ? 'buildings' : tabs[0]?.[0] ?? 'buildings');
  const [s, setS] = useUrlState('q', ''); const [detail, setDetail] = useState<any>(null);
  const [dayQ, setDay] = useUrlState('day', ''); const day = dayQ === 'today' ? 'today' : ''; // 영업 현황 '오늘 새 영업 DB'
  const [boxQ, setBox] = useUrlState('box', ''); const box = boxQ === 'archive' ? 'archive' : ''; // #605 보관함(대상 아님·완료)
  const [sort, setSort] = useUrlState('sort', ''); const [region, setRegion] = useUrlState('region', ''); const [hh, setHh] = useUrlState('hh', ''); const [period, setPeriod] = useUrlState('period', ''); // #606
  const [st, setSt] = useUrlState('st', ''); // #459(대표 10/23): 상태 필터 칩(주소 ?st=)
  const sub = ['bids', 'contracts', 'prospects', 'regions'].includes(tab);
  const { data, error, reload } = useApi<any>(sub ? (null as unknown as string) : `/api/sales/src?${q({ view: 'hub', tab, q: s, day, box, sort, region, hh, period, status: st })}`, [tab, s, day, box, sort, region, hh, period, st]);
  const [sel, setSel] = useState<string[]>([]); // 대표 10/20 14:15 ④ 일괄 선택
  useEffect(() => setSel([]), [tab, box, st]);
  const reopen = useRef(sub ? null : sp.get('id')); // 주소 ?id= 상세(새로 고침·뒤로가기) — 목록을 불러온 뒤 그 줄로
  useEffect(() => { if (!reopen.current || !data?.items) return; const r = data.items.find((x: any) => String(x.id) === reopen.current); reopen.current = null; if (r) setDetail({ tab, r }); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const tabRow = (cls: (on: boolean) => string, style?: (on: boolean) => React.CSSProperties | undefined) => <div className="flex flex-wrap gap-1.5">{tabs.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} data-testid={`sales-hub-${k}`} className={cls(tab === k)} style={style?.(tab === k)}>{l}</button>)}
    <Link href="/s/sales/support" data-testid="sales-hub-support" className={cls(false)} style={style?.(false)}>지원사업</Link></div>; // #647(대표 10/25 22:20): 앱 하단 '영업기회'에서도 지원사업 화면으로 — 수집 DB 종류 설정과 무관하게 항상
  if (sub) return (
    <div className="space-y-3" data-testid="sales-hub">
      {tabRow((on) => cx('rounded-full border px-3 py-1 text-xs', on ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800' : 'border-line bg-white'))}
      {tab === 'bids' ? <Bids embedded initialTab={['today', 'soon', 'open', 'working', 'all'].includes(initialSub ?? '') ? initialSub : undefined} /> : tab === 'contracts' ? <Contracts /> : tab === 'prospects' ? <Prospects /> : <Regions />}
    </div>);
  if (error) return <ErrorBox error={error} retry={reload} />;
  const regions: string[] = data?.regions ?? [];
  return (
    <div className="space-y-3" data-testid="sales-hub">
      <Head title="영업기회 허브" meta={data}><Search value={s} onChange={setS} />
        {day === 'today' && <button type="button" onClick={() => setDay('')} className="rounded-full border px-2.5 py-0.5 text-xs" style={{ color: C, borderColor: C }} data-testid="hub-day-today">오늘 새로 들어온 것만 ✕</button>}</Head>
      {tabRow((on) => cx('rounded-full border px-3 py-1 text-xs', on ? 'border-transparent text-white' : 'border-line'), (on) => (on ? { background: C } : undefined))}
      {/* #605 보관함 칩 · #606 정렬·필터(지역·세대수·기간) — 모두 주소에 저장(새로 고침·뒤로가기에도 같은 목록) */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="hub-toolbar">
        <button type="button" onClick={() => setBox('')} aria-pressed={!box} className={chipCls(!box)} data-testid="hub-box-open">기본 목록</button>
        <button type="button" onClick={() => setBox('archive')} aria-pressed={box === 'archive'} className={chipCls(box === 'archive')} data-testid="hub-box-archive">대상 아님·완료{data ? ` ${data.archiveCount ?? 0}건` : ''}</button>
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
        <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="정렬" data-testid="hub-sort">{(HUB_SORTS[tab] ?? HUB_SORTS.buildings).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {tab !== 'vendors' && <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={region} onChange={(e) => setRegion(e.target.value)} aria-label="지역 필터" data-testid="hub-f-region"><option value="">지역 전체</option>{regions.map((r) => <option key={r} value={r}>{r}</option>)}{region && !regions.includes(region) && <option value={region}>{region}</option>}</select>}
        {tab !== 'vendors' && <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={hh} onChange={(e) => setHh(e.target.value)} aria-label="세대수 필터" data-testid="hub-f-hh"><option value="">세대수 전체</option>{[['300', '300세대 이상'], ['500', '500세대 이상'], ['1000', '1,000세대 이상']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="기간 필터" data-testid="hub-f-period"><option value="">기간 전체</option><option value="1">1개월 안</option><option value="3">3개월 안</option><option value="6">6개월 안</option></select>
        {data && <span className="ml-auto text-ink-3" data-testid="hub-count">{data.items.length}건{data.items.length === 300 ? '+(최근 300)' : ''}</span>}
      </div>
      {/* #459(대표 10/23): 상태 필터 칩 — 기본 목록은 미검토·검토중·연락중·신청·보류, 보관함은 대상 아님·완료. 0건 묶음은 숨기고 건수를 같이 보여 줌(주소 ?st=) */}
      {data && <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="hub-status-row">
        <button type="button" onClick={() => setSt('')} aria-pressed={!st} className={chipCls(!st)} data-testid="hub-status-all">상태 전체</button>
        {((data.statusGroups ?? []) as [string, string][]).filter(([k]) => (data.statusCounts?.[k] ?? 0) > 0 || k === st).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setSt(st === k ? '' : k)} aria-pressed={st === k} className={chipCls(st === k)} data-testid={`hub-status-${k}`}>{l} {data.statusCounts?.[k] ?? 0}</button>))}
      </div>}
      {/* 200차 #699: 원본 기준일 — 준공·입주 단지가 언제 자료인지(K-apt 자료실 주 1회 · 한국부동산원 연 1회) */}
      {tab === 'facilities' && !box && <ResearchBar onDone={reload} />}
      {tab === 'facilities' && !!data?.sourceAsOf?.length && <p className="text-[11px] text-ink-3" data-testid="hub-source-asof">원본 기준일 · {(data.sourceAsOf as { label: string; day: string; note: string | null }[]).map((x) => `${x.label} ${kd(x.day)}${x.note ? ` ${x.note}` : ''}`).join(' · ')}</p>}
      {/* #609(대표 10/25 ⑤): 모든 탭 1열(한 줄 한 건) */}
      {!data ? <Skeleton rows={6} /> : <ul className="space-y-2">{data.items.map((r: any) => (
        <li key={r.id} className="relative">{data.readOnly === false && !box && !(r.work?.status === '진행영업 전환' || r.work?.leadId || r.leadId) && <input type="checkbox" className="absolute right-3 top-3 z-10 size-4" checked={sel.includes(r.id)} onChange={(e) => setSel((v) => e.target.checked ? [...v, r.id] : v.filter((x) => x !== r.id))} aria-label={`${r.name} 선택`} data-testid="hub-select" />}<HubCard tab={tab} r={r} onRaw={() => setDetail({ tab, r })} onChange={reload} canWrite={data.readOnly === false} /></li>))}
        {!data.items.length && <li className="text-sm text-ink-3">{box === 'archive' ? '보관함이 비어 있습니다 — 대상 아님·완료로 넘긴 건이 여기에 모입니다' : '없습니다'}</li>}</ul>}
      <BulkBar kind={tab === 'buildings' ? 'building' : tab === 'facilities' ? 'facility' : 'vendor'} ids={sel} onDone={reload} onClear={() => setSel([])} />
      {detail && <HubDetail tab={detail.tab} r={data?.items.find((x: any) => x.id === detail.r.id) ?? detail.r} admin={data?.canAssign} canWrite={data?.readOnly === false} onChange={reload} onClose={() => setDetail(null)} />}
    </div>
  );
}
/** 대표 검수 10/20 ②: 허브 상세 — 원본 키 덤프 대신 한국어 칸(값 없는 칸은 '미확인'), 관리자 '원본 보기' 접힘 */
function HubDetail({ tab, r, admin, canWrite, onChange, onClose }: { tab: string; r: any; admin?: boolean; canWrite?: boolean; onChange?: () => void; onClose: () => void }) {
  useBackClose(true, onClose, ['id', String(r.id)]); // #242 2단계: 뒤로가기 = 상세만 닫힘(허브 그대로), 주소 ?id= 로 새로 고침·뒤로가기에도 같은 상세
  const T = useSalesTerms(); // #408 칸 이름은 회사 업종 템플릿
  const rows: [string, React.ReactNode][] = tab === 'buildings'
    ? [[T.unitName, r.name], ['상태', r.status], ['유형', r.kind], ['우선순위', r.priority], ['지역', r.region], ['주소', r.address], ...(r.dates ?? []).map(([k, v]: [string, unknown]) => [k, k === '세대수' ? (D(v) ? `${D(v)}세대` : UNK) : (D(v) ? kd(D(v)) : UNK)] as [string, React.ReactNode]), ['DB 등록', r.firstSeen && kd(r.firstSeen)], ['비고', r.estimated && '날짜는 시점 추정치'],
        ['문서', (r.url || r.attachments?.length) && <ContactRow key="d" links={[[r.url, '공식 승인 원문'], ...((r.attachments ?? []) as any[]).map((a, i) => [attHref(a, i, { title: r.name, origin: r.url }), attName(a, i)] as [string, string])]} />]]
    : tab === 'facilities'
      ? [[T.facilityName, r.name], ['판정', r.verdict], ['연락 상태', r.contact], ['유형', r.lane], ['지역', r.region], ['세대수', r.households && `${r.households}세대`], ['규모', r.scale], [T.operator, r.operator], ['계약만료일', r.contractEnd && kd(r.contractEnd)], ['후속조사', r.research && <ResearchChip key="rs" r={r} />], ['주소', r.address], [T.office, r.phone ? <ContactRow phone={r.phone} /> : UNK],
        ['부대시설', r.amenities && String(r.amenities)], ['준공(사용승인)', r.date && kd(r.date)], ['입주', r.moveIn && kd(r.moveIn)], ['경과', r.elapsedDays !== null && r.elapsedDays !== undefined && `입주·준공 뒤 ${r.elapsedDays}일`], ['DB 등록', r.firstSeen && kd(r.firstSeen)], ['다음 연락', r.next && kd(r.next)], ['최근 기록', r.lastNote], ['다음 조치', r.nextAction && `${r.nextAction}${r.nextActionFrom ? ` (${r.nextActionFrom})` : ''}`]]
      : [['회사', r.name], ['구분', r.division], ['순위', r.rank && `${r.rank}위`], ['상태', r.status], ['모집 공지', openLabel(r.open)], ['모집 시기', r.period], ['등록 요건', r.requirement], ['공동인증서', r.cert], ['비고', r.note], ['공지', r.notice],
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
const kdt = (v: unknown) => {
  const s = String(v ?? '');
  // 197차: 시각대가 붙은 ISO(…Z·+09:00)는 서울 날짜·시각으로(예전엔 UTC 시각을 그대로 잘라 9시간 일렀음)
  if (/T\d\d:\d\d/.test(s) && /(Z|[+-]\d\d:?\d\d)$/.test(s)) { const d = new Date(s); if (!Number.isNaN(d.getTime())) { const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); return kd(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d)) + (t !== '00:00' ? ` ${t}` : ''); } }
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s; const t = s.slice(11, 16); return kd(s) + (/^\d\d:\d\d$/.test(t) && t !== '00:00' ? ` ${t}` : '');
};
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
/** 대표 10/21 12:00 영업 재편 4): 사업 배지는 회사 관심 사업(카테고리) 설정에서 — 이름·색 모두 자료(코드에 회사 이름 없음) */
const BizBadges = ({ items, testid }: { items?: { key: string; name: string; color: string }[]; testid?: string }) => items?.length ? <span className="inline-flex flex-wrap gap-1" data-testid={testid}>{items.map((b) => <span key={b.key} className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: b.color }} data-testid={testid ? `${testid}-item` : undefined}>{b.name}</span>)}</span> : null;
const CAT_CLS: Record<string, string> = { '즉시 검토': 'bg-rose-50 text-rose-800', '협력사 필요': 'bg-amber-50 text-amber-800' };
/** 대표 10/24 추가 ③: 마감 D-10 안 = 입찰 준비 기간(D-4~D-10 주황 강조, 입찰 탭 '준비 기간(D-10 안)' 필터·당일 메일 배지와 같은 기준) */
const PREP_DAYS = 10;
/** 입찰 카드(영업관리 2-5, PC·휴대폰 같음): 상태 → 사업 → 분류 → 출처 → 단지·공고명 → 기관·지역·세대·업종 → 낙찰 → 공고·DB 등록(오늘 등록) → 키워드 → [전화][원문][첨부]·마감 */
function BidCard({ n, onOpen, onChange, canWrite }: { n: any; onOpen?: () => void; onChange?: () => void; canWrite?: boolean }) {
  const td = today();
  const dd = n.close ? Math.round((Date.parse(n.close) - Date.parse(td)) / 864e5) : null;
  const st = /정정/.test(String(n.status ?? '')) ? ['정정 전 공고', 'bg-slate-100 text-ink-2'] : /낙찰/.test(String(n.status ?? '')) ? ['낙찰', 'bg-emerald-50 text-emerald-800'] : /사전|예정/.test(String(n.status ?? '')) ? ['입찰 예정', 'bg-sky-50 text-sky-800']
    // 대표 10/24 추가 ②: '마감·취소' → '취소'·'마감' 따로. '마감임박'(3일 안 마감)은 D-n — #537 후속2
    : /취소/.test(String(n.status ?? '')) || n.notice_kind === 'cancel' ? ['취소', 'bg-slate-200 text-ink-2'] : /마감(?!임박)/.test(String(n.status ?? '')) || (dd !== null && dd < 0) ? ['마감', 'bg-slate-100 text-ink-3']
    : dd === 0 ? [`오늘 마감 ${String(n.deadline ?? '').slice(11, 16)}`, 'bg-red-600 text-white'] : dd !== null && dd <= 3 ? [`D-${dd}`, 'bg-red-50 text-red-700']
    // 대표 10/24 추가 ③: 입찰 준비는 9~10일 전부터 — D-4~D-10 주황·굵게 '준비 시작' + 카드 왼쪽 주황 줄
    : dd !== null && dd <= PREP_DAYS ? [`D-${dd} · 준비 시작`, 'bg-amber-100 font-bold text-amber-800'] : dd !== null ? [`D-${dd}`, 'bg-slate-100 text-ink-2'] : ['진행중', 'bg-slate-100 text-ink-2'];
  const prep = dd !== null && dd > 3 && dd <= PREP_DAYS && st[0].endsWith('준비 시작');
  // #608(대표 10/25 ④): 카드 왼쪽 줄 = D-0~3 빨강 · D-4~10 노랑(취소·마감·낙찰은 없음), 배지 글자는 그대로
  const urgent = dd !== null && dd >= 0 && dd <= 3 && /^(D-\d|오늘 마감)/.test(st[0]);
  const cat = n.classification ?? n.category;
  return (
    <li className={cx('rounded-card border border-line bg-white p-3 text-sm', urgent && 'border-l-4 border-l-red-500', prep && 'border-l-4 border-l-amber-300')} data-testid="sales-bid" data-prep={prep ? '1' : undefined} data-urgent={urgent ? '1' : undefined}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', st[1])} data-testid="bid-status">{st[0]}</span>
        <BizBadges items={n.businesses} testid="bid-business" />
        {cat && <span className={cx('hidden rounded-full px-2 py-0.5 text-[11px] font-medium md:inline', CAT_CLS[String(cat)] ?? 'bg-slate-100 text-ink-2')}>{String(cat)}</span>}
        {n.vendorRecruit && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] text-teal-800 md:hidden" data-testid="bid-recruit">협력사 모집</span>}
        {n.sourceLabel && <span className="hidden rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2 md:inline">{String(n.sourceLabel)}</span>}
        {n.work && chip(n.work)}
        {n.fit !== null && n.fit !== undefined && <span className="hidden text-[11px] text-ink-3 md:inline">적합 {String(n.fit)}</span>}
      </div>
      {/* 대표 검수 10/20 ②: 제목을 누르면 한국어 상세(원문은 칩으로), 예산·원문·공고문 내려받기는 휴대폰에도, 날짜 10. 25.(토) 10:00 */}
      <div className="mt-1"><button type="button" onClick={onOpen} className="text-left font-medium hover:underline" data-testid="bid-open">{n.complex && <b className="mr-1">{n.complex}</b>}{n.title}</button></div>
      <div className="mt-0.5 text-xs text-ink-2">{[n.agency, n.region, n.households && `${n.households}세대`, n.industry].filter(Boolean).join(' · ')}</div>
      {(won(n.amount) || n.winner) && <div className="mt-0.5 text-xs text-ink-2">{won(n.amount) && <>예산 {won(n.amount)}</>}{n.winner && <>{won(n.amount) ? ' · ' : ''}낙찰 {n.winner}{won(n.awardAmount) ? ` · ${won(n.awardAmount)}` : ''}{n.awardDate ? ` (${kd(n.awardDate)})` : ''}</>}</div>}
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3" data-testid="bid-dates"><span className="hidden md:inline">{[n.noticeDate && `공고 ${kd(n.noticeDate)}`, n.posted && `DB 등록 ${kd(n.posted)}`].filter(Boolean).join(' · ')}</span>{n.todayNew && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white" data-testid="bid-today">오늘 등록</span>}{n.todayLabel && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900" title="오늘 탭에 있는 까닭 — 공고일과 수집 시각이 다름" data-testid="bid-today-why">{n.todayLabel}</span>}</div>
      <BidHistory h={n.history} />
      {n.keywords && <div className="mt-0.5 hidden text-xs text-ink-3 md:block">키워드: {n.keywords}</div>}
      {n.judgment && <div className="mt-0.5 hidden text-xs text-ink-2 md:block">판단: {n.judgment}</div>}
      <div className="mt-1.5 flex flex-wrap items-end gap-1.5 text-xs">
        <ContactRow phone={n.phone} links={[[n.search ? null : n.url, '원문'], [n.attachments?.length ? attHref(n.attachments[0], 0, bidCtx(n)) : null, n.attachments?.length > 1 ? `공고문 내려받기 ${n.attachments.length}건` : '공고문 내려받기']]} />
        {n.search && <SearchHintChip h={n.search} />}
        {canWrite && !n.workLeadId && !n.workBid && !n.skipped && st[0] !== '취소' && <HandoffButton kind="bid" id={String(n.id)} name={`${n.complex ? n.complex + ' ' : ''}${n.title}`} onDone={onChange} compact />}
        {n.workBid && <BidTaskChip b={n.workBid} />}{canWrite && n.workBid && !n.workBid.result && <RevertButton bidId={String(n.id)} onDone={onChange} />}{/* 결정 15-35 입찰 업무 */}{/* 대표 10/24 추가 ②: 취소·대상 아님 공고는 넘기기 대신 [대상 아님]·[되돌리기] */}
        {n.workLeadId && <Link href={`/s/sales/leads?id=${n.workLeadId}`} className={cx(linkCls, 'text-emerald-800')} data-testid="sales-handoff-lead">영업 중 → 리드</Link>}
        {canWrite && n.workLeadId && n.workHandoff && <RevertButton leadId={n.workLeadId} onDone={onChange} />}{/* #610 ⓐ */}
        <span className="ml-auto font-medium text-ink" data-testid="bid-deadline">{n.deadline ? `마감 ${kdt(n.deadline)}` : '마감일 미확인'}</span>
      </div>
      {(n.skipped || st[0] === '취소') && <BidSkip n={n} onChange={onChange} canWrite={canWrite} />}
    </li>
  );
}
/** 대표 10/24 추가 ②: 같은 공고 묶음 — '10/23 취소 공고' · '2회 게시(10/20 취소·10/22)' · '정정 10/22' (취소·정정 공고·재게시는 따로 카드로 안 냄) */
const md = (d?: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '?');
function BidHistory({ h }: { h?: { cancelDay: string | null; cancelNotice: boolean; posts: { day: string | null; cancelled: boolean }[]; amendDay: string | null } | null }) {
  if (!h || (!h.cancelDay && h.posts.length < 2 && !h.amendDay)) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]" data-testid="bid-history">
      {h.cancelDay && <span className="rounded-full bg-slate-200 px-1.5 py-0.5 font-semibold text-ink-2" data-testid="bid-history-cancel">{md(h.cancelDay)} {h.cancelNotice ? '취소 공고' : '취소'}</span>}
      {h.posts.length > 1 && <span className="rounded-full border border-line px-1.5 py-0.5 text-ink-2" data-testid="bid-history-posts">{h.posts.length}회 게시({h.posts.map((p) => `${md(p.day)}${p.cancelled ? ' 취소' : ''}`).join('·')})</span>}
      {h.amendDay && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-800" data-testid="bid-history-amend">정정 {md(h.amendDay)}</span>}
    </div>
  );
}
/** 대표 10/24 추가 ②: [대상 아님] 탭 줄 = 누가·언제·사유 + [되돌리기] / 취소된 공고 카드 = [대상 아님으로](사유 선택) — 넘기면 모든 목록·당일 메일에서 빠짐 */
function BidSkip({ n, onChange, canWrite }: { n: any; onChange?: () => void; canWrite?: boolean }) {
  const [ask, setAsk] = useState(false); const [why, setWhy] = useState(''); const [busy, setBusy] = useState(false);
  async function go(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try { await api('/api/sales/work', { body: { kind: 'bid', id: String(n.id), ...body } }); toast.ok(msg); onChange?.(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (n.skipped) return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-input bg-slate-50 px-2 py-1 text-xs text-ink-2" data-testid="bid-skip">
      <b>대상 아님</b>{[n.skip?.by, n.skip?.at && fmtDateTime(n.skip.at)].filter(Boolean).map((x: string) => <span key={x}>· {x}</span>)}{n.skip?.reason && <span data-testid="bid-skip-reason">· 사유: {n.skip.reason}</span>}
      {canWrite && <Button size="sm" variant="secondary" className="ml-auto" disabled={busy} onClick={() => go({ restore: true }, n.linked?.length ? `되돌렸습니다 — 같은 사업 ${n.linked.length}건과 함께 다시 목록에 나옵니다` : '되돌렸습니다 — 다시 목록에 나옵니다')} data-testid="bid-skip-restore">되돌리기</Button>}
      {/* 137차: 같은 사업(사전규격 ↔ 본 공고)이라 함께 숨긴 공고 — 되돌리기도 함께 */}
      {n.linked?.length > 0 && <ul className="basis-full space-y-0.5 border-t border-line pt-1" data-testid="bid-skip-linked">{n.linked.map((l: any) => (
        <li key={l.id} className="text-[11px] text-ink-3" data-testid="bid-skip-linked-row">같은 사업이라 함께 숨김 · {[l.sourceLabel, l.title, l.noticeDate && `공고 ${kd(l.noticeDate)}`].filter(Boolean).join(' · ')}</li>))}</ul>}
    </div>
  );
  if (!canWrite || n.workLeadId) return null;
  return ask ? (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="bid-skip-ask">
      <input className={cx(inputCls, 'h-8 min-w-0 flex-1 py-1 text-xs')} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} placeholder="사유(선택) — 예: 취소 공고 확인" aria-label="대상 아님 사유" data-testid="bid-skip-reason-input" />
      <Button size="sm" disabled={busy} onClick={() => go({ status: '대상아님', reason: why.trim() || null }, '대상 아님으로 넘겼습니다 — [대상 아님] 탭에서 볼 수 있습니다')} data-testid="bid-skip-go">넘기기</Button>
      <Button size="sm" variant="ghost" onClick={() => setAsk(false)}>취소</Button>
    </div>
  ) : <div className="mt-1.5"><button type="button" className={cx(linkCls, 'text-ink-2')} onClick={() => setAsk(true)} data-testid="bid-skip-open">취소 확인 · 대상 아님으로</button></div>;
}
// 212차 #612: 원천에서 다시 읽어 채우는 칸은 '미확인'만 — 전화로 조사하는 시설 값은 카드의 '미확인 · 조사 예정 날짜(담당)'(ResearchChip)
const UNK = <span className="text-ink-3" title="원천에서 값이 들어오면 자동으로 채워집니다">미확인</span>;
const seoulYmd = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso));
const mdd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 212차 #612 ③(대표 결정 10/25): 빈 값(현 위탁사·계약만료일·관리사무소 번호)이 남은 시설 — '미확인 · 조사 예정 10/30(담당 ○○)'(업무로), 조사한 뒤 '확인 못함' */
function ResearchChip({ r }: { r: any }) {
  const T = useSalesTerms(); const x = r.research;
  const miss = [!r.operator && T.operator, !r.contractEnd && '계약만료일', !r.phone && `${T.office} 번호`].filter(Boolean) as string[];
  if (!x || (!miss.length && x.status !== 'open')) return null;
  const tip = miss.length ? `미확인: ${miss.join('·')}` : undefined;
  if (x.status === 'open') {
    const body = `미확인 · 조사 예정 ${x.due ? mdd(x.due) : ''}${x.assignee ? `(담당 ${x.assignee})` : ''}`;
    return x.taskId ? <Link href={`/tasks/${x.taskId}`} title={tip} className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:underline" data-testid="hub-research-chip">{body}</Link>
      : <span title={tip} className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900" data-testid="hub-research-chip">{body}</span>;
  }
  const at = x.doneAt ? `${mdd(seoulYmd(x.doneAt))} ` : '';
  return <span title={[tip, x.note && `메모: ${x.note}`].filter(Boolean).join(' · ') || undefined} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-2" data-testid="hub-research-chip">{x.status === 'none' ? `미확인 · ${at}조사함(확인 못함)` : `일부 미확인 · ${at}조사함`}</span>;
}
/** 212차 #612: 허브 '준공·입주 시설' 머리 줄 — 이번 주 후속조사 묶음(담당·마감·조사한 수·업무), 관리자는 이번 주 묶음이 없을 때 [지금 만들기] */
function ResearchBar({ onDone }: { onDone?: () => void }) {
  const { data, reload } = useApi<any>('/api/sales/research');
  const T = useSalesTerms(); const [busy, setBusy] = useState(false);
  if (!data) return null;
  const l = data.latest;
  async function run() {
    setBusy(true);
    try { const r = await api<any>('/api/sales/research', { body: {} }); toast.ok(r.items ? `이번 주 후속조사 ${r.items}곳을 업무로 묶었습니다` : '이번 주 조사할 곳이 없습니다 — 빈 값이 있는 곳은 이미 조사했거나 조사 중입니다'); reload(); onDone?.(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-input bg-amber-50/70 px-2.5 py-1.5 text-xs text-ink-2" data-testid="hub-research">
      <b className="text-amber-900">후속조사</b>
      {l?.thisWeek && l.items ? <>
        <span data-testid="hub-research-week">이번 주 {l.items}곳{l.assignee ? ` · 담당 ${l.assignee}` : ''}{l.due ? ` · ${mdd(l.due)}까지` : ''}{l.done || l.none ? ` · 조사함 ${l.done + l.none}곳${l.none ? `(확인 못함 ${l.none})` : ''}` : ''}{l.taskDone ? ' · 업무 완료' : ''}</span>
        {l.taskId && <Link href={`/tasks/${l.taskId}`} className="font-medium text-amber-900 underline" data-testid="hub-research-task">업무 열기</Link>}
      </> : <span data-testid="hub-research-week">{l?.thisWeek ? '이번 주 조사할 곳 없음 · ' : ''}{T.operator}·계약만료일·{T.office} 번호가 빈 큰 단지부터 {data.max}곳을 {data.auto ? '매주 월요일 아침' : '관리자가 만들 때'} 업무 하나로 묶습니다</span>}
      {data.canRun && <Button size="sm" variant="secondary" className="ml-auto" disabled={busy} onClick={run} data-testid="hub-research-run">이번 주 묶음 지금 만들기</Button>}
    </div>
  );
}
/** S1-3: 협력사 모집 공지 공개 여부 — 원본 recruit_visibility(글자) 그대로, 예전 참/거짓 값은 공개·비공개 */
const openLabel = (v: unknown) => (v === null || v === undefined || v === '' ? null : v === true || v === 'true' ? '공개' : v === false || v === 'false' ? '비공개' : String(v));
const keyDates = (dates?: [string, unknown][]) => { const has = (dates ?? []).filter(([, v]) => D(v));
  const pick3 = [...has.filter(([k]) => /준공|세대|입주/.test(k)), ...has.filter(([k]) => !/준공|세대|입주/.test(k))].slice(0, 3);
  return pick3.map(([k, v]) => (k === '세대수' ? `${D(v)}세대` : `${k.replace('(예정)', '')} ${D(v)}`)).join(' · '); };
/** 허브 카드(영업관리 2-7 신규단지 · 2-8 준공·입주 시설 · 2-9 협력사) — 칸 순서 그대로 */
function HubCard({ tab, r, onRaw, onChange, canWrite }: { tab: string; r: any; onRaw: () => void; onChange?: () => void; canWrite?: boolean }) {
  const today0 = today(); const T = useSalesTerms();
  const leadId = r.work?.leadId ?? r.leadId ?? null; const kind = tab === 'buildings' ? 'building' : tab === 'facilities' ? 'facility' : 'vendor';
  const handedOff = !!(r.work?.handoff ?? r.handoff); // 넘기기로 만든 리드(진행영업 전환은 되돌리기 없음)
  const handoff = canWrite && !leadId ? <HandoffButton kind={kind} id={String(r.id)} name={String(r.name ?? '')} onDone={onChange} compact />
    : leadId ? <><Link href={`/s/sales/leads?id=${leadId}`} className={cx(linkCls, 'text-emerald-800')} data-testid="sales-handoff-lead">영업 중 → 리드</Link>{canWrite && handedOff && <RevertButton leadId={leadId} onDone={onChange} />}</> : null; // #610 ⓐ
  return (
    <div className="flex h-full flex-col rounded-card border border-line bg-white p-3 text-sm" data-testid="sales-hub-item">
      {tab === 'buildings' ? (<>
        <div className="flex flex-wrap items-center gap-1.5">{r.status && chip(r.status)}{r.kind && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">{r.kind}</span>}{r.priority && !/보통|medium/i.test(r.priority) && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">{r.priority}</span>}{r.estimated && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-3" data-testid="hub-estimated">시점 추정치</span>}</div>
        <button type="button" onClick={onRaw} className="mt-1 block text-left font-semibold hover:underline">{r.name}</button>
        <p className="text-xs text-ink-2">{(r.address && r.region && String(r.address).startsWith(String(r.region)) ? [r.address] : [r.region, r.address]).filter(Boolean).join(' · ')}</p>
        {/* 대표(10/19 앱): 휴대폰 카드는 값이 있는 핵심 2~3개만(준공·세대수·입주 먼저), 빈 값('미확인')은 숨김 — 전체 10칸은 PC·상세 */}
        <p className="mt-0.5 text-xs text-ink-2 md:hidden" data-testid="hub-key">{keyDates(r.dates)}</p>
        <dl className="mt-1 hidden grid-cols-2 gap-x-3 gap-y-0.5 text-xs md:grid md:grid-cols-5">{(r.dates ?? []).map(([k, v]: [string, unknown]) => <div key={k}><dt className="text-ink-3">{k}</dt><dd>{D(v) ?? UNK}</dd></div>)}</dl>
        <div className="mt-auto flex flex-wrap items-end gap-1.5 pt-1.5">{(r.url || r.attachments?.length) ? <ContactRow links={[[r.url, '공식 승인 원문'], ...((r.attachments ?? []) as any[]).map((a: any, i: number) => [attHref(a, i, { title: r.name, origin: r.url }), attName(a, i)] as [string, string])]} /> : null}{handoff}</div>
      </>) : tab === 'facilities' ? (<>
        <div className="flex flex-wrap items-center gap-1.5"><button type="button" onClick={onRaw} className="text-left font-semibold hover:underline">{r.name}</button>{r.verdict && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-800">{r.verdict}</span>}{r.contact && chip(r.contact)}</div>
        <p className="text-xs text-ink-2">{[r.lane, r.region, r.households && `${r.households}세대`, r.scale, r.operator && `${T.operator} ${r.operator}`, r.contractEnd && `계약만료 ${kd(r.contractEnd)}`].filter(Boolean).join(' · ')}</p>
        {r.address && <p className="hidden text-xs text-ink-3 md:block">{r.address}</p>}
        {/* 대표 검수 10/20 ②: 관리사무소 전화 → 전화·문자 줄, 앞에 '·' 가 붙던 준공·입주 줄 정리, 날짜 한국어 */}
        <div className="mt-1.5 flex flex-wrap items-end gap-1.5">{r.phone ? <ContactRow phone={r.phone} /> : <p className="hidden text-xs text-ink-3 md:block">대표 번호 미확인</p>}<ResearchChip r={r} />{handoff}</div>
        {r.amenities && <p className="hidden text-xs text-ink-3 md:block">부대시설: {String(r.amenities)}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3"><span>{[r.firstSeen && `DB 등록 ${kd(r.firstSeen)}`, r.date && `준공(사용승인) ${kd(r.date)}`, r.moveIn && `입주 ${kd(r.moveIn)}`, r.elapsedDays !== null && r.elapsedDays !== undefined && `${r.elapsedDays}일 경과`].filter(Boolean).join(' · ')}</span>{r.firstSeen === today0 && <span className="rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">오늘 등록</span>}</p>
        {r.next && <p className="text-xs">다음 연락 {kd(r.next)}</p>}{r.lastNote && <p className="hidden text-xs text-ink-2 md:block">최근 기록: {r.lastNote}</p>}{r.nextAction && <p className="hidden text-xs text-ink-2 md:block">다음 조치: {r.nextAction}{r.nextActionFrom && ` (${r.nextActionFrom})`}</p>}
      </>) : (<>
        <div className="flex flex-wrap items-center gap-1.5">{r.division && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">{r.division}</span>}<button type="button" onClick={onRaw} className="text-left font-semibold hover:underline">{r.name}</button>{r.rank && <span className="text-xs text-ink-3">{r.rank}위</span>}{r.status && chip(r.status)}</div>
        <p className="text-xs text-ink-2">{[openLabel(r.open) && `모집 공지 ${openLabel(r.open)}`, r.period && `모집 ${r.period}`, r.requirement && `요건 ${r.requirement}`, r.cert && `공동인증서 ${r.cert}`, r.note].filter(Boolean).join(' · ') }</p>
        {r.notice && <p className="hidden text-xs md:block">공지: {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline">{r.notice}</a> : r.notice}</p>}
        {/* 대표 검수 10/20 ②: 신청·포털·홈페이지 칩은 휴대폰에도(공지 원문은 휴대폰에서 칩으로) */}
        <div className="mt-1.5 flex flex-wrap items-end gap-1.5"><ContactRow links={[[r.applyUrl, '등록 신청'], [r.portalUrl, '협력사 포털'], [r.homepage, '홈페이지'], [r.url, '공지 원문']]} />{handoff}</div>
        {(r.memo || r.next) && <p className="mt-1 text-xs text-ink-2">{[r.memo, r.next && `다음 ${kd(r.next)}`].filter(Boolean).join(' · ')}</p>}
      </>)}
      {r.archive && <ArchiveLine kind={kind} id={String(r.id)} a={r.archive} canWrite={canWrite} onChange={onChange} operator={tab === 'facilities' ? r.operator : undefined} contractEnd={tab === 'facilities' ? r.contractEnd : undefined} />}
    </div>
  );
}
/** #605(대표 10/25 ①): 보관함 줄 = 상태·누가·언제·사유 + [되돌리기](대상 아님 → 넘기기 전 상태, 완료 → 처음 상태) · 시설은 '현 위탁사·계약만료일' 칸(적으면 계약만료·재입찰 탭으로) */
function ArchiveLine({ kind, id, a, canWrite, onChange, operator, contractEnd }: { kind: 'building' | 'facility' | 'vendor'; id: string; a: { status: string | null; by: string | null; at: string | null; reason: string | null; prev: string | null }; canWrite?: boolean; onChange?: () => void; operator?: string | null; contractEnd?: string | null }) {
  const T = useSalesTerms();
  const [busy, setBusy] = useState(false); const [op, setOp] = useState(operator ?? ''); const [end, setEnd] = useState(contractEnd ?? '');
  const skip = SKIP_ST.test(String(a.status ?? '').trim());
  async function post(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try { await api('/api/sales/work', { body: { kind, id, ...body } }); toast.ok(msg); onChange?.(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-input bg-slate-50 px-2 py-1 text-xs text-ink-2" data-testid="hub-archive">
      <b>{a.status}</b>{[a.by, a.at && fmtDateTime(a.at)].filter(Boolean).map((x) => <span key={String(x)}>· {String(x)}</span>)}{a.reason && <span data-testid="hub-archive-reason">· 사유: {a.reason}</span>}
      {canWrite && <Button size="sm" variant="secondary" className="ml-auto" disabled={busy} onClick={() => post(skip ? { restore: true } : { status: WORK_STATUS[kind][0] }, '되돌렸습니다 — 다시 기본 목록에 나옵니다')} data-testid="hub-archive-restore">되돌리기</Button>}
      {canWrite && kind === 'facility' && <form className="flex basis-full flex-wrap items-center gap-1.5 border-t border-line pt-1" onSubmit={(e) => { e.preventDefault(); void post({ operator: op.trim() || null, contractEnd: end || null }, `${T.operator}·계약만료일을 적었습니다 — 계약만료·재입찰 탭에서 봅니다`); }} data-testid="hub-archive-contract">
        <input className={cx(inputCls, 'h-7 w-36 py-0 text-xs')} value={op} onChange={(e) => setOp(e.target.value)} maxLength={100} placeholder={T.operator} aria-label={T.operator} data-testid="hub-archive-operator" />
        <input type="date" className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={end} onChange={(e) => setEnd(e.target.value)} aria-label="계약만료일" data-testid="hub-archive-end" />
        <Button size="sm" variant="secondary" disabled={busy} type="submit" data-testid="hub-archive-contract-save">저장</Button><span className="text-[11px] text-ink-3">적어 두면 계약만료·재입찰 탭에 자동으로 들어갑니다</span></form>}
    </div>
  );
}
/** 결정 15-35: 입찰 업무로 넘긴 공고 — 업무 열기(기한)·결과 칩·계약 업무 */
const BID_RES: Record<string, [string, string]> = { won: ['낙찰', 'bg-emerald-50 text-emerald-800'], lost: ['미낙찰', 'bg-slate-100 text-ink-2'], failed: ['유찰', 'bg-amber-50 text-amber-800'], canceled: ['공고 취소', 'bg-red-50 text-red-700'] };
function BidTaskChip({ b }: { b: any }) {
  const r = b.result ? BID_RES[String(b.result)] : null;
  return <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="sales-bid-task-chip">
    {b.result !== 'canceled' && <Link href={`/tasks/${b.taskId}`} className={cx(linkCls, 'text-emerald-800')} data-testid="sales-bid-task">입찰 업무{!b.result && b.due ? ` · 기한 ${kd(b.due)}` : ''} →</Link>}
    {r && <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', r[1])} data-testid="sales-bid-result">{r[0]}{b.auto && b.result !== 'canceled' ? ' · 자동 판정' : ''}</span>}
    {b.contractTaskId && <Link href={`/tasks/${b.contractTaskId}`} className={cx(linkCls, 'text-ink-2')} data-testid="sales-bid-contract">계약 업무 →</Link>}
  </span>;
}
/** 입찰 상세의 입찰 업무 칸 — 결과 [낙찰]·[미낙찰]·[유찰](자동 판정 바로잡기 포함), 낙찰은 계약 기간·금액(선택) */
function BidTaskPanel({ n, onSaved }: { n: any; onSaved: () => void }) {
  const b = n.workBid; const [busy, setBusy] = useState(false); const [wonOpen, setWonOpen] = useState(false); const [f, setF] = useState({ start: '', end: '', amount: '' });
  async function result(r: 'won' | 'lost' | 'failed', extra: Record<string, unknown> = {}) {
    setBusy(true);
    try { const x = await api<{ status: string }>('/api/sales/work/bid-result', { body: { id: String(n.id), result: r, ...extra } });
      toast.ok(r === 'won' ? '낙찰로 넣었습니다 — 계약 기록과 계약 업무가 있습니다' : `'${x.status}'(으)로 넣었습니다 — 입찰 업무를 마쳤습니다`); setWonOpen(false); onSaved(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (b.result === 'canceled') return <div className="rounded-input border border-red-200 bg-red-50 p-2 text-xs text-red-800" data-testid="bid-task-panel">발주처가 공고를 취소해 입찰 업무와 일정을 취소했습니다.</div>;
  return (
    <div className="space-y-2 rounded-input border border-emerald-200 bg-emerald-50/50 p-3 text-sm" data-testid="bid-task-panel">
      <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-emerald-900">{b.result ? '입찰 결과' : '입찰 업무로 진행 중'}</span><BidTaskChip b={b} /></div>
      <p className="text-xs text-ink-2">기한은 공고 일정에 맞춰 자동으로 바뀌고, 공고가 취소되면 업무도 함께 취소됩니다. 개찰 결과가 올라오면 우리 회사 낙찰인지 자동으로 판정합니다{b.result ? ' — 판정이 틀리면 아래에서 바로잡아 주세요' : ''}.</p>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="개찰 결과">
        <span className="text-xs text-ink-3">결과</span>
        <Button size="sm" variant={b.result === 'won' ? 'primary' : 'secondary'} disabled={busy} onClick={() => setWonOpen(!wonOpen)} data-testid="bid-result-won">낙찰</Button>
        <Button size="sm" variant={b.result === 'lost' ? 'primary' : 'secondary'} disabled={busy || b.result === 'lost'} onClick={() => result('lost')} data-testid="bid-result-lost">미낙찰</Button>
        <Button size="sm" variant={b.result === 'failed' ? 'primary' : 'secondary'} disabled={busy || b.result === 'failed'} onClick={() => result('failed')} data-testid="bid-result-failed">유찰</Button>
      </div>
      {wonOpen && <div className="grid gap-2 rounded-input border border-line bg-white p-2 sm:grid-cols-4" data-testid="bid-won-form">
        <Field label="계약 시작"><input type="date" className={inputCls} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} aria-label="계약 시작" data-testid="bid-won-start" /></Field>
        <Field label="계약 종료"><input type="date" className={inputCls} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} aria-label="계약 종료" data-testid="bid-won-end" /></Field>
        <Field label="금액(원)"><input inputMode="numeric" className={inputCls} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} aria-label="계약 금액" placeholder="선택" /></Field>
        <div className="flex items-end gap-1.5"><Button size="sm" disabled={busy} onClick={() => result('won', { contractStart: f.start || null, contractEnd: f.end || null, amount: numOf(f.amount) })} data-testid="bid-won-go">낙찰로 넣기</Button><Button size="sm" variant="ghost" onClick={() => setWonOpen(false)}>닫기</Button></div>
        <p className="text-[11px] text-ink-3 sm:col-span-4">계약 기간을 넣으면 종료 120일 전에 재계약 준비 업무가 자동으로 생깁니다(나중에 계약 기록에서 넣어도 됩니다).</p>
      </div>}
    </div>
  );
}
/** 결정 15-35 예전 자료 정리(관리자): 입찰 공고에서 넘어와 리드가 된 건 → 미리 보고 고른 것만 입찰 업무로 */
function BidLeadsBanner({ onDone }: { onDone?: () => void }) {
  const { data, reload } = useApi<{ items: { id: string; name: string; status: string | null; owner: string | null; movable: boolean; why: string | null; openTasks: number }[] }>('/api/sales/work/bid-leads');
  const [open, setOpen] = useState(false); const [pick, setPick] = useState<string[] | null>(null); const [busy, setBusy] = useState(false);
  const items = data?.items ?? []; if (!items.length) return null;
  const movable = items.filter((x) => x.movable); const chosen = pick ?? movable.map((x) => x.id);
  async function go() {
    setBusy(true);
    try { const r = await api<{ moved: unknown[]; skipped: unknown[] }>('/api/sales/work/bid-leads', { body: { leadIds: chosen } });
      toast.ok(`입찰 업무로 옮겼습니다 — ${r.moved.length}건${r.skipped.length ? ` · 그대로 둠 ${r.skipped.length}건` : ''}`); setOpen(false); setPick(null); reload(); onDone?.(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="bid-leads-banner">
      <span>입찰 공고에서 넘어와 리드가 된 건 {items.length}건 — 이제 입찰은 업무로 관리합니다.</span>
      <button type="button" className="font-semibold underline" onClick={() => setOpen(true)} data-testid="bid-leads-open">살펴보고 옮기기</button>
      {open && <Modal open onClose={() => setOpen(false)} title="입찰에서 넘어온 리드 정리">
        <div className="space-y-3 text-sm" data-testid="bid-leads-dialog">
          <p className="text-xs text-ink-2">옮기면 리드는 보관함(되돌림, 사유 기록)으로 가고, 넘길 때 만든 업무는 입찰 업무로 이어져 공고 일정·취소·결과를 따라갑니다. 상담·제안·계약 기록이 있거나 첫 연락 다음 단계까지 간 리드는 현장 영업으로 그대로 둡니다.</p>
          <ul className="max-h-72 space-y-1 overflow-y-auto">{items.map((x) => <li key={x.id}><label className={cx('flex items-start gap-2 text-xs', !x.movable && 'text-ink-3')}>
            <input type="checkbox" className="mt-0.5" disabled={!x.movable} checked={x.movable && chosen.includes(x.id)} onChange={(e) => setPick(e.target.checked ? [...chosen, x.id] : chosen.filter((y) => y !== x.id))} data-testid="bid-leads-item" />
            <span><b className="font-medium">{x.name}</b> · {x.status ?? '단계 없음'} · 담당 {x.owner ?? '없음'}{x.openTasks ? ` · 열린 업무 ${x.openTasks}건` : ''}{x.why && <span className="block text-ink-3">{x.why}</span>}</span></label></li>)}</ul>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>닫기</Button><Button disabled={busy || !chosen.length} onClick={go} data-testid="bid-leads-go">{busy ? '옮기는 중…' : `${chosen.length}건 입찰 업무로 옮기기`}</Button></div>
        </div>
      </Modal>}
    </div>
  );
}
/** #610 ⓐ(대표 10/25 ⑥): [넘기기] 뒤 카드에서 바로 [되돌리기] — 리드는 보관함('되돌림'), 원천 행은 넘기기 전 상태, 업무·일정 취소(누가·언제 기록). 리드 상세의 [배정 이전으로 되돌리기]와 같은 API */
function RevertButton({ leadId, bidId, onDone }: { leadId?: string; bidId?: string; onDone?: () => void }) {
  const [ask, setAsk] = useState(false); const [why, setWhy] = useState(''); const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { const r = await api<{ tasks: number; events: number }>('/api/sales/work/handoff/revert', { body: bidId ? { kind: 'bid', id: bidId, reason: why.trim() || undefined } : { leadId, reason: why.trim() || undefined } });
      toast.ok(bidId ? `되돌렸습니다 — 입찰 업무 ${r.tasks}건·일정 ${r.events}건 취소` : `되돌렸습니다 — 리드는 보관함으로, 업무 ${r.tasks}건·일정 ${r.events}건 취소`); setAsk(false); onDone?.(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (!ask) return <button type="button" className={cx(linkCls, 'text-ink-2')} onClick={() => setAsk(true)} data-testid="sales-handoff-revert">되돌리기</button>;
  return <span className="flex flex-wrap items-center gap-1.5"><input className={cx(inputCls, 'h-8 w-40 py-1 text-xs')} value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} placeholder="사유(선택)" aria-label="되돌리기 사유" data-testid="sales-handoff-revert-reason" /><Button size="sm" disabled={busy} onClick={go} data-testid="sales-handoff-revert-go">되돌리기</Button><Button size="sm" variant="ghost" onClick={() => setAsk(false)}>취소</Button></span>;
}
