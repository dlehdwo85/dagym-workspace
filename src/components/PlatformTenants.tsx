'use client';
import { useState } from 'react';
import { Download, Eye, KeyRound, Lock, LockOpen, Plus, Search, ShieldOff, Trash2 } from 'lucide-react';
import { INDUSTRIES } from '@/lib/industries';
import { api, useApi } from './client';
import { fmtBytes } from './usage';
import { Button, Field, Modal, cx, fmtDateTime, inputCls, toast } from './ui';
const SIZE_LABEL: Record<string, string> = { '1': '혼자', '2-10': '2~10명', '11-30': '11~30명', '31-100': '31~100명', '100+': '100명 넘게' };
const SPACE_LABEL: Record<string, string> = { sales: '영업', marketing: '마케팅' };

const cell = 'px-2 py-1.5';
const STATUS: Record<string, string> = { active: '사용 중', blocked: '정지', deleted: '삭제' };
const SUB: Record<string, string> = { trial: '체험', expired: '체험 끝(읽기 전용)', active: '사용', suspended: '중지' };
// #656 고객사 단계(체험/유료/보류/해지)·구분(설계 파트너 체험단/일반)·연락 종류
const STAGE: Record<string, string> = { trial: '체험', paid: '유료', hold: '보류', churned: '해지' };
const STAGE_CLS: Record<string, string> = { trial: 'bg-sky-50 text-sky-800', paid: 'bg-emerald-50 text-emerald-800', hold: 'bg-amber-50 text-amber-800', churned: 'bg-slate-200 text-ink-2' };
const SEGMENT_LABEL: Record<string, string> = { partner: '설계 파트너', customer: '일반' };
const KIND_LABEL: Record<string, string> = { call: '전화', mail: '메일', meeting: '미팅', kakao: '카카오톡', memo: '메모' };
const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

/** V28-3 슈퍼 계정: 회사 목록(검색·필터) → 상세(요금제·정지·체험·읽기 전용·삭제 예약·한도·사용자·지원 모드) */
export function PlatformTenants() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [segment, setSegment] = useState(''); // #656 구분(설계 파트너/일반)
  const [stage, setStage] = useState(''); // #656 단계(체험/유료/보류/해지)
  const qs = `q=${encodeURIComponent(query)}&status=${status}&segment=${segment}&stage=${stage}`;
  const list = useApi<{ tenants: any[]; summary?: { month: string; aiCostKrw: number; customerAiCostKrw: number; revenueKrw: number; marginKrw: number; marginPct: number | null; customers: number; paying: number; contactDue?: number } }>(`/api/platform/tenants?${qs}`, [qs]);
  const sm = list.data?.summary;
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false); // 대표 10/20 ① [고객사 추가]
  const today = todayKst();
  return (
    <section className="rounded-card border border-line bg-white shadow-card" data-testid="platform-company-list">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold">고객사 관리 {list.data && <span className="text-xs font-normal text-ink-3">{list.data.tenants.length}곳</span>}</h2>
        <Button size="sm" onClick={() => setAdding(true)} data-testid="platform-add-company"><Plus />고객사 추가</Button>
        <a className="inline-flex h-8 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-xs font-medium text-ink-2 hover:bg-slate-50" href={`/api/platform/tenants/export?${qs}`} data-testid="platform-export-companies" title="지금 보이는 목록을 엑셀로 내려받습니다 (?format=csv 로 CSV)"><Download className="size-3.5" />내보내기</a>
        <form className="ml-auto flex gap-1.5" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <input className={cx(inputCls, 'h-8 w-48 py-1 text-xs')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="회사·대표 이메일·id" aria-label="회사 찾기" />
          <Button size="sm" type="submit" variant="secondary"><Search />찾기</Button>
        </form>
        <select className={cx(inputCls, 'h-8 w-auto py-1 text-xs')} value={segment} onChange={(e) => setSegment(e.target.value)} aria-label="구분" data-testid="platform-filter-segment">
          <option value="">구분: 전체</option><option value="partner">설계 파트너 체험단</option><option value="customer">일반 고객</option>
        </select>
        <select className={cx(inputCls, 'h-8 w-auto py-1 text-xs')} value={stage} onChange={(e) => setStage(e.target.value)} aria-label="단계" data-testid="platform-filter-stage">
          <option value="">단계: 전체</option>{Object.entries(STAGE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className={cx(inputCls, 'h-8 w-auto py-1 text-xs')} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="상태">
          <option value="">전체</option><option value="active">사용 중</option><option value="blocked">정지</option><option value="trial">체험·체험 끝</option><option value="deleting">삭제 예약</option>
        </select>
      </div>
      {sm && (
        <p className="border-b border-line bg-slate-50 px-3 py-1.5 text-xs text-ink-2" data-testid="platform-ai-margin">
          {sm.month} AI 원가(고객사) <b>{sm.customerAiCostKrw.toLocaleString('ko-KR')}원</b>{sm.aiCostKrw !== sm.customerAiCostKrw && <span className="text-ink-3"> (우리 회사·시험 포함 {sm.aiCostKrw.toLocaleString('ko-KR')}원)</span>}
          {' '}vs 요금 합계(월 환산·VAT 제외) <b>{sm.revenueKrw.toLocaleString('ko-KR')}원</b> → 마진 <b className={sm.marginKrw < 0 ? 'text-red-600' : 'text-emerald-700'}>{sm.marginKrw.toLocaleString('ko-KR')}원{sm.marginPct !== null ? ` (${sm.marginPct}%)` : ''}</b>
          <span className="text-ink-3"> · 고객사 {sm.customers}곳 중 결제 {sm.paying}곳</span>
          {!!sm.contactDue && <span className="ml-1 rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700" data-testid="platform-contact-due">오늘까지 연락할 곳 {sm.contactDue}곳</span>}
        </p>
      )}
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full min-w-[1180px] text-sm">
          <thead><tr className="text-left text-xs text-ink-3"><th className={cell}>회사</th><th className={cell}>단계</th><th className={cell}>담당자</th><th className={cell}>요금제</th><th className={cell}>상태</th><th className={cell}>인원</th><th className={cell}>저장</th><th className={cell}>AI(이번 달)</th><th className={cell}>청구·미납</th><th className={cell}>연락</th><th className={cell}>최근 접속</th><th className={cell}>가입</th><th className={cell} /></tr></thead>
          <tbody>
            {(list.data?.tenants ?? []).map((t) => (
              <tr key={t.id} className={cx('border-t border-line', t.status !== 'active' && 'bg-slate-50 text-ink-3')} data-tenant={t.id}>
                <td className={cell}><div className="font-medium">{t.name}{t.segment === 'partner' && <span className="ml-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-normal text-violet-800" data-testid={`company-partner-${t.id}`}>파트너</span>}{t.owner_invited && <span className="ml-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-normal text-amber-800">초대 대기</span>}</div><div className="text-[11px] text-ink-3">{t.id} · {t.owner_email ?? '-'}</div></td>
                <td className={cell}><span className={cx('rounded-full px-2 py-0.5 text-xs', STAGE_CLS[t.stage] ?? 'bg-slate-100')} data-testid={`company-stage-${t.id}`}>{STAGE[t.stage] ?? t.stage}</span>{t.lifecycle && <div className="text-[11px] text-ink-3" title={t.lifecycle_note ?? ''}>직접 정함{t.lifecycle_note ? ` · ${t.lifecycle_note}` : ''}</div>}</td>
                <td className={cell}>{t.contact_name || t.contact_phone ? <><div>{t.contact_name ?? '-'}{t.contact_title ? <span className="text-[11px] text-ink-3"> {t.contact_title}</span> : null}</div><div className="text-[11px] text-ink-3">{t.contact_phone ?? ''}</div></> : <span className="text-ink-3">-</span>}{t.source && <div className="text-[11px] text-ink-3">경로 {t.source}</div>}</td>
                <td className={cell}>{t.plan_code ?? '-'}<div className="text-[11px] text-ink-3">{SUB[t.sub_status] ?? ''}{t.sub_status === 'trial' && t.trial_ends_at ? ` ~${String(t.trial_ends_at).slice(0, 10)}` : ''}{t.discount_pct ? ` · 할인 ${t.discount_pct}%` : ''}</div></td>
                <td className={cell}>{STATUS[t.status] ?? t.status}{t.delete_scheduled_at && <div className="text-[11px] text-red-600">삭제 예정 {String(t.delete_scheduled_at).slice(0, 10)}</div>}{t.support_consent_at && <div className="text-[11px] text-emerald-700">지원 허용</div>}</td>
                <td className={cell}>{t.users}명<div className="text-[11px] text-ink-3">7일 접속 {t.active7 ?? 0}명</div></td>
                <td className={cell}>{t.storage_bytes != null ? fmtBytes(Number(t.storage_bytes)) : '-'}</td>
                <td className={cell} data-testid={`company-ai-${t.id}`}>{t.ai_requests}회{t.ai_limit_requests !== null && t.ai_limit_requests !== undefined ? ` / ${t.ai_limit_requests}회` : ''} · {Math.round(Number(t.ai_krw)).toLocaleString()}원
                  <div className="text-[11px] text-ink-3">{t.ai_left_requests === null || t.ai_left_requests === undefined ? 'AI 요청 무제한' : `남은 ${t.ai_left_requests}회`}{t.mkt_credits_limit !== null && t.mkt_credits_limit !== undefined ? ` · 마케팅 ${t.mkt_credits_left}/${t.mkt_credits_limit}크레딧` : ''}</div>
                  {t.ai_budget && t.ai_budget.source !== 'legacy' && <div className={cx('text-[11px]', t.ai_budget.over ? 'font-semibold text-red-600' : (t.ai_budget.pct ?? 0) >= 80 ? 'text-amber-700' : 'text-ink-3')} data-testid={`company-ai-budget-${t.id}`}>
                    월 AI 예산 {t.ai_budget.limitKrw === null ? '무제한' : `${Number(t.ai_budget.limitKrw).toLocaleString()}원 중 ${t.ai_budget.pct}%`}{t.ai_budget.over ? ' · 멈춤' : ''}</div>}</td>
                <td className={cell}>{t.billing_amount ? `${Number(t.billing_amount).toLocaleString()}원/${t.billing_cycle === 'annual' ? '년' : '월'}` : '-'}
                  {t.next_billing_on && <div className="text-[11px] text-ink-3">다음 {String(t.next_billing_on).slice(0, 10)}</div>}
                  {t.past_due_since && <div className="text-[11px] font-medium text-red-600">미납 {String(t.past_due_since).slice(0, 10)}~{t.billing_lock === 'suspended' ? ' · 이용 중지' : t.billing_lock === 'read_only' ? ' · 읽기 전용' : ''}</div>}
                  {t.last_payment && <div className="text-[11px] text-ink-3">최근 {String(t.last_payment.at).slice(0, 10)} {t.last_payment.status === 'paid' ? '성공' : t.last_payment.status}</div>}</td>
                <td className={cell} data-testid={`company-contact-${t.id}`}>{t.next_contact_at ? <div className={cx('text-xs', t.next_contact_at <= today ? 'font-medium text-red-600' : 'text-ink-2')}>다음 {t.next_contact_at}</div> : null}{t.last_contact_at ? <div className="text-[11px] text-ink-3">마지막 {String(t.last_contact_at).slice(0, 10)}</div> : !t.next_contact_at ? <span className="text-ink-3">-</span> : null}</td>
                <td className={cell}>{t.last_login_at ? fmtDateTime(t.last_login_at) : '-'}</td>
                <td className={cell}>{String(t.created_at).slice(0, 10)}</td>
                <td className={cell}><Button size="sm" variant="secondary" onClick={() => setOpen(t.id)} data-testid={`company-open-${t.id}`}>관리</Button></td>
              </tr>
            ))}
            {list.data && !list.data.tenants.length && <tr><td className={cx(cell, 'text-ink-3')} colSpan={13}>찾는 회사가 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <TenantDetail id={open} onClose={() => { setOpen(null); list.reload(); }} />}
      {adding && <NewTenant onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); list.reload(); setOpen(id); }} />}
    </section>
  );
}

function TenantDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useApi<any>(`/api/platform/tenants/${id}/detail`, [id]);
  const [ov, setOv] = useState<{ users: string; storageGb: string; aiRequests: string; tasksTotal: string; aiBudgetKrw: string } | null>(null);
  const [wt, setWt] = useState<string | null>(null); // 대표 10/24 추가 ① 마케팅 글 모델(고른 값, 저장 전)
  const t = d.data?.tenant;
  const run = async (fn: () => Promise<any>, ok: string) => { try { const r = await fn(); toast.ok(ok); d.reload(); return r; } catch (e: any) { toast.error(e.message); } };
  if (!d.data) return <Modal open onClose={onClose} title="회사 관리" wide><p className="text-sm text-ink-3">불러오는 중…</p></Modal>;
  const internal = id === 'default' || id === 'demo';
  const o = d.data.subscription.overrides ?? {};
  const cur = ov ?? { users: o.users === undefined ? '' : String(o.users ?? ''), storageGb: o.storageGb === undefined ? '' : String(o.storageGb ?? ''), aiRequests: o.aiRequests === undefined ? '' : String(o.aiRequests ?? ''), tasksTotal: o.tasksTotal === undefined ? '' : String(o.tasksTotal ?? ''),
    aiBudgetKrw: o.aiBudgetKrw === undefined ? '' : o.aiBudgetKrw === null ? '무제한' : String(o.aiBudgetKrw) };
  const ab = d.data.aiBudget as { source: string; limitKrw: number | null; usedKrw: number; pct: number | null; over: boolean; resetLabel: string; parts: { planKrw: number | null; perSeatKrw: number | null; seats: number | null; mktKrw: number; packKrw: number; ownerCapKrw: number | null } } | undefined;
  const n = (v: string) => (v.trim() === '' ? undefined : v.trim() === '무제한' ? null : Number(v));
  return (
    <Modal open onClose={onClose} title={`회사 관리 — ${t.name}`} wide>
      <div className="space-y-4 text-sm" data-testid="company-detail">
        <p className="text-xs text-ink-2">{t.id} · 대표 {t.owner_email ?? '-'} · 요금제 {d.data.subscription.planCode}({SUB[d.data.subscription.status] ?? d.data.subscription.status}) · {STATUS[t.status] ?? t.status}
          {' '}· 사용 {d.data.usage.users}명 / 저장 {fmtBytes(d.data.usage.storageBytes)} / AI {d.data.usage.aiRequests}회{d.data.usage.tasks !== undefined && ` / 업무 ${d.data.usage.tasks.toLocaleString('ko-KR')}개`}</p>
        {!internal && (
          <div className="flex flex-wrap gap-1.5">
            {t.status === 'active'
              ? <Button size="sm" variant="secondary" onClick={() => confirm('이 회사를 정지할까요? 모든 구성원이 바로 로그아웃됩니다.') && run(() => api(`/api/platform/tenants/${id}/status`, { method: 'PUT', body: { status: 'blocked' } }), '정지했습니다')}>정지</Button>
              : t.status === 'blocked' && <Button size="sm" variant="secondary" onClick={() => run(() => api(`/api/platform/tenants/${id}/status`, { method: 'PUT', body: { status: 'active' } }), '정지를 풀었습니다')}>정지 해제</Button>}
            {[7, 14].map((x) => <Button key={x} size="sm" variant="ghost" onClick={() => run(() => api(`/api/platform/tenants/${id}/trial`, { body: { action: 'extend', days: x } }), `체험 ${x}일 연장`)}>체험 +{x}일</Button>)}
            <Button size="sm" variant="ghost" onClick={() => confirm('읽기 전용으로 바꿀까요? (체험 종료와 같음)') && run(() => api(`/api/platform/tenants/${id}/trial`, { body: { action: 'end' } }), '읽기 전용으로 바꿨습니다')}>읽기 전용</Button>
            <Button size="sm" variant="ghost" onClick={() => { const code = prompt('바꿀 요금제 코드 (예: personal · team · business · trial)', d.data.subscription.planCode); if (code) run(() => api(`/api/platform/tenants/${id}`, { method: 'PUT', body: { planCode: code, addons: d.data.subscription.addons ?? {}, status: code === 'trial' ? 'trial' : 'active' } }), '요금제를 바꿨습니다'); }}>요금제 변경</Button>
          </div>
        )}
        {d.data.billing && (
          <div className="rounded-input border border-line p-3" data-testid="company-billing">
            <p className="text-xs font-medium text-ink-2">요금·결제</p>
            <p className="mt-1">이번 달 청구 예정 <b>{Number(d.data.billing.expectedThisMonth ?? 0).toLocaleString()}원</b>{d.data.billing.next_billing_on && ` · 다음 결제 ${String(d.data.billing.next_billing_on).slice(0, 10)}`}
              {' '}· AI 원가 {Number(d.data.billing.aiCostKrw ?? 0).toLocaleString()}원{d.data.billing.aiCostRate != null && ` (매출 대비 ${d.data.billing.aiCostRate}%)`}</p>
            {d.data.billing.past_due_since && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-red-700">
                <span>미납 {Number(d.data.billing.unpaid ?? 0).toLocaleString()}원 · {String(d.data.billing.past_due_since).slice(0, 10)}부터{d.data.billing.billing_lock === 'suspended' ? ' · 이용 중지' : d.data.billing.billing_lock === 'read_only' ? ' · 읽기 전용' : ''}
                  {d.data.billing.billing_grace_until && new Date(d.data.billing.billing_grace_until) > new Date() && ` · 유예 ${String(d.data.billing.billing_grace_until).slice(0, 10)}까지`}</span>
                {[7, 14].map((x) => <Button key={x} size="sm" variant="secondary" onClick={() => run(() => api(`/api/platform/tenants/${id}/billing`, { body: { action: 'grace', days: x } }), `유예 ${x}일`)} data-testid={`grace-${x}`}>유예 +{x}일</Button>)}
                {d.data.billing.billing_lock && <Button size="sm" variant="ghost" onClick={() => run(() => api(`/api/platform/tenants/${id}/billing`, { body: { action: 'unlock' } }), '잠금을 풀었습니다')}>잠금 해제</Button>}
              </div>
            )}
            {!!d.data.payments?.length && (
              <ul className="mt-2 max-h-32 overflow-y-auto text-xs text-ink-2">
                {d.data.payments.map((p: any) => <li key={p.id}>{String(p.paid_at ?? p.created_at).slice(0, 16).replace('T', ' ')} · {p.kind} {p.plan_code ?? ''} · {Number(p.amount).toLocaleString()}원{p.settlement && <span className={p.settlement === 'settled' ? 'text-emerald-700' : p.settlement === 'mismatch' ? 'text-red-600' : 'text-ink-3'}> · 정산 {p.settlement === 'settled' ? `완료 ${p.settled_on ?? ''}` : p.settlement === 'mismatch' ? '차이' : `예정 ${p.expected_on ?? ''}`}</span>} · <b className={p.status === 'paid' ? 'text-emerald-700' : p.status === 'failed' ? 'text-red-600' : ''}>{p.status}</b>{p.result_msg && ` · ${p.result_msg}`}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="rounded-input border border-line p-3">
          <p className="mb-2 text-xs font-medium text-ink-2">한도 개별 조정 (비우면 요금제 값, ‘무제한’ 입력 가능) — AI 크레딧 지급은 AI 예산(원)을 올려 주세요</p>
          {ab && (
            <p className={cx('mb-2 text-xs', ab.over ? 'font-medium text-red-600' : 'text-ink-2')} data-testid="company-ai-budget">
              이번 달 AI 예산 {ab.limitKrw === null ? '무제한' : `${ab.limitKrw.toLocaleString('ko-KR')}원`} 중 {ab.usedKrw.toLocaleString('ko-KR')}원{ab.pct !== null && ` (${ab.pct}%)`}{ab.over && ' — AI 멈춤'} · {ab.resetLabel} 초기화
              <span className="text-ink-3"> · {ab.source === 'legacy' ? '요금제에 원 예산 없음(예전 회사 월 한도 $)' : ab.source === 'override' ? '회사별 조정 값' : ab.source === 'unlimited' ? '회사별 조정: 무제한' : [
                ab.parts.perSeatKrw !== null ? `1인 ${ab.parts.perSeatKrw.toLocaleString('ko-KR')}원 × ${ab.parts.seats}명` : `요금제 ${Number(ab.parts.planKrw ?? 0).toLocaleString('ko-KR')}원`,
                ab.parts.mktKrw ? `마케팅 요금제 ${ab.parts.mktKrw.toLocaleString('ko-KR')}원` : '', ab.parts.packKrw ? `AI 팩 ${ab.parts.packKrw.toLocaleString('ko-KR')}원` : '',
                ab.parts.ownerCapKrw !== null ? `대표 한도 ${ab.parts.ownerCapKrw.toLocaleString('ko-KR')}원` : ''].filter(Boolean).join(' + ')}</span>
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            {([['users', '인원(명)'], ['storageGb', '저장(GB)'], ['aiRequests', 'AI(회/월)'], ['tasksTotal', '업무 총량(개)'], ['aiBudgetKrw', 'AI 예산(원/월)']] as const).map(([k, l]) => (
              <label key={k} className="text-xs">{l}<input className={cx(inputCls, 'mt-0.5 h-8 w-28 py-1 text-xs')} value={cur[k]} placeholder={k === 'aiBudgetKrw' ? (ab?.limitKrw === null || ab?.limitKrw === undefined ? '요금제 값' : String(ab.limitKrw)) : String(d.data.limits[k] ?? '무제한')} onChange={(e) => setOv({ ...cur, [k]: e.target.value })} data-testid={`ov-${k}`} /></label>
            ))}
            <Button size="sm" onClick={() => run(() => api(`/api/platform/tenants/${id}/limits`, { method: 'PUT', body: { users: n(cur.users), storageGb: n(cur.storageGb), aiRequests: n(cur.aiRequests), tasksTotal: n(cur.tasksTotal), aiBudgetKrw: n(cur.aiBudgetKrw),
              clear: (['users', 'storageGb', 'aiRequests', 'tasksTotal', 'aiBudgetKrw'] as const).filter((k) => cur[k].trim() === '') } }), '한도를 바꿨습니다')} data-testid="ov-save">저장</Button>
          </div>
        </div>
        {d.data.mktWrite && <MktWriteBox id={id} w={d.data.mktWrite} pick={wt} setPick={setWt} run={run} />}
        <div>
          <p className="mb-1 text-xs font-medium text-ink-2">사용자 {d.data.users.length}명 — 비밀번호는 보거나 정할 수 없고 재설정 메일만 보냅니다</p>
          <ul className="divide-y divide-line rounded-input border border-line" data-testid="company-users">
            {d.data.users.map((u: any) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5" data-user={u.id}>
                <span className="min-w-0 flex-1"><b className="font-medium">{u.name}</b> <span className="text-xs text-ink-3">{u.email} · {u.role}{u.status !== 'active' && ` · ${u.status === 'disabled' ? '잠김' : u.status}`}{u.totp && ' · 2단계'}{u.last_login_at && ` · 최근 ${fmtDateTime(u.last_login_at)}`}</span></span>
                {u.status === 'active' ? <Button size="sm" variant="ghost" onClick={() => confirm(`${u.name} 계정을 잠글까요?`) && run(() => api(`/api/platform/users/${u.id}`, { body: { action: 'lock' } }), '잠갔습니다')}><Lock />잠금</Button>
                  : <Button size="sm" variant="ghost" onClick={() => run(() => api(`/api/platform/users/${u.id}`, { body: { action: 'unlock' } }), '잠금을 풀었습니다')}><LockOpen />해제</Button>}
                <Button size="sm" variant="ghost" onClick={() => run(() => api(`/api/platform/users/${u.id}`, { body: { action: 'reset_password' } }), `${u.email} 로 재설정 메일을 보냈습니다`)}><KeyRound />재설정 메일</Button>
                {u.totp && <Button size="sm" variant="ghost" onClick={() => confirm('2단계 인증을 초기화할까요?') && run(() => api(`/api/platform/users/${u.id}`, { body: { action: 'reset_2fa' } }), '2단계 인증을 초기화했습니다')}><ShieldOff />2단계 초기화</Button>}
              </li>
            ))}
          </ul>
        </div>
        {!internal && <TenantOps id={id} t={t} ownerInvite={d.data.ownerInvite} run={run} />}
        {!internal && <CrmBox key={`${t.lifecycle ?? ''}:${t.contact_phone ?? ''}:${d.data.billing?.discount_pct ?? 0}`} id={id} t={t} stage={d.data.stage} contacts={d.data.contacts ?? []} billing={d.data.billing} run={run} />}
        {!internal && (
          <div className="flex flex-wrap items-center gap-2 rounded-input border border-line p-3">
            <span className="min-w-0 flex-1 text-xs text-ink-2">지원 모드(읽기 전용 30분, 모든 조회 기록) — {t.support_consent_at ? <b className="text-emerald-700">고객 허용됨</b> : <b>고객이 허용하지 않음</b>}</span>
            <Button size="sm" variant="secondary" disabled={!t.support_consent_at} data-testid="support-start" onClick={async () => {
              const reason = prompt('지원 사유(고객 문의 번호 등)'); if (!reason) return;
              const r = await run(() => api(`/api/platform/tenants/${id}/support`, { body: { reason } }), '지원 모드를 시작합니다'); if (r) window.location.href = '/';
            }}><Eye />지원 모드로 보기</Button>
          </div>
        )}
        {!!d.data.support.length && <p className="text-xs text-ink-3">최근 지원: {d.data.support.map((s: any) => `${fmtDateTime(s.created_at)} ${s.admin_name}(${s.reason ?? ''})`).join(' · ')}</p>}
        {!internal && (
          <div className="flex flex-wrap items-center gap-2 rounded-input border border-red-200 p-3">
            <span className="min-w-0 flex-1 text-xs text-red-700">{t.delete_scheduled_at ? `삭제 예정 ${String(t.delete_scheduled_at).slice(0, 10)} — 그 뒤 [영구 삭제 실행] 가능` : '삭제 예약: 30일 유예 뒤 영구 삭제(고객 대표에게 메일·알림)'}</span>
            {!t.delete_scheduled_at
              ? <Button size="sm" variant="danger" onClick={() => { const name = prompt(`확인을 위해 회사 이름 "${t.name}" 을 그대로 입력하세요`); if (name) run(() => api(`/api/platform/tenants/${id}/delete`, { body: { action: 'schedule', confirmName: name } }), '삭제를 예약했습니다'); }}><Trash2 />삭제 예약</Button>
              : <>
                <Button size="sm" variant="secondary" onClick={() => run(() => api(`/api/platform/tenants/${id}/delete`, { body: { action: 'cancel' } }), '삭제 예약을 취소했습니다')}>예약 취소</Button>
                <Button size="sm" variant="danger" disabled={new Date(t.delete_scheduled_at) > new Date()} onClick={() => { const name = prompt(`영구 삭제합니다. 회사 이름 "${t.name}" 을 다시 입력하세요`); if (name) run(() => api(`/api/platform/tenants/${id}/delete`, { body: { action: 'execute', confirmName: name } }), '영구 삭제했습니다'); }}>영구 삭제 실행</Button>
              </>}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** 대표 10/20 ① 고객사 상세 — 대표 초대 상태·공간·메모·감사 기록 (대신 보기 없음) */
function TenantOps({ id, t, ownerInvite, run }: { id: string; t: any; ownerInvite: { pending: boolean; expiresAt?: string | null; expired?: boolean }; run: (fn: () => Promise<any>, ok: string) => Promise<any> }) {
  const [memo, setMemo] = useState<string>(t.platform_memo ?? '');
  const [showAudit, setShowAudit] = useState(false);
  const audit = useApi<{ logs: any[] }>(showAudit ? `/api/platform/tenants/${id}/audit` : null, [showAudit]);
  const spaces: string[] = (t.spaces ?? []).filter((x: string) => x !== 'work');
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="space-y-2 rounded-input border border-line p-3" data-testid="company-ops">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-2">업종 {(t.industries ?? []).length ? (t.industries as string[]).join('·') : '-'} · 규모 {SIZE_LABEL[t.size_band] ?? '-'}</span>
        {ownerInvite.pending && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800" data-testid="company-invite-pending">대표 초대 대기{ownerInvite.expired ? '(기한 지남)' : ownerInvite.expiresAt ? ` ~${String(ownerInvite.expiresAt).slice(0, 10)}` : ''}</span>}
        {ownerInvite.pending && <Button size="sm" variant="secondary" data-testid="company-reinvite" onClick={async () => { const r = await run(() => api(`/api/platform/tenants/${id}/reinvite`, { body: {} }), '새 초대 링크를 만들었습니다'); if (r?.inviteLink) setLink(r.inviteLink); }}>초대 메일 다시 보내기</Button>}
        {link && <a className="underline" href={link} data-testid="company-invite-link">{link}</a>}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="company-spaces">
        <span className="text-ink-2">공간: 업무(항상)</span>
        {(['sales', 'marketing'] as const).map((sp) => <label key={sp} className="flex items-center gap-1"><input type="checkbox" checked={spaces.includes(sp)} data-testid={`company-space-${sp}`}
          onChange={(e) => run(() => api(`/api/platform/tenants/${id}/spaces`, { method: 'PUT', body: { spaces: e.target.checked ? [...spaces, sp] : spaces.filter((x) => x !== sp) } }), `${SPACE_LABEL[sp]} 공간을 ${e.target.checked ? '켰' : '껐'}습니다`)} />{SPACE_LABEL[sp]}</label>)}
      </div>
      <div className="flex items-start gap-2">
        <textarea className={cx(inputCls, 'min-h-[56px] flex-1 text-xs')} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="운영 메모(계약·담당자·특이사항) — 운영자만 봅니다" aria-label="운영 메모" data-testid="company-memo" />
        <Button size="sm" variant="secondary" onClick={() => run(() => api(`/api/platform/tenants/${id}/memo`, { method: 'PUT', body: { memo } }), '메모를 저장했습니다')} data-testid="company-memo-save">메모 저장</Button>
      </div>
      <div>
        <button type="button" className="text-xs text-ink-2 underline" onClick={() => setShowAudit((v) => !v)} data-testid="company-audit-toggle">{showAudit ? '감사 기록 닫기' : '감사 기록 보기(최근 100건)'}</button>
        {showAudit && (
          <ul className="mt-1 max-h-48 divide-y divide-line overflow-y-auto rounded-input border border-line text-xs" data-testid="company-audit">
            {(audit.data?.logs ?? []).map((l) => <li key={l.id} className="flex gap-2 px-2 py-1"><span className="shrink-0 text-ink-3">{fmtDateTime(l.created_at)}</span><span className="shrink-0 font-medium">{l.actor_name ?? '-'}{l.by_platform ? '(운영)' : ''}</span><span className="min-w-0 flex-1 truncate">{l.action}{l.target_type ? ` · ${l.target_type}` : ''}{l.detail && Object.keys(l.detail).length ? ` · ${JSON.stringify(l.detail).slice(0, 120)}` : ''}</span></li>)}
            {audit.data && !audit.data.logs.length && <li className="px-2 py-2 text-ink-3">기록이 없습니다</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 대표 10/20 ① [고객사 추가]: 회사명·업종(여러 개)·규모·대표 이름/이메일 → 대표에게 초대 메일, 요금제(비우면 체험)·체험 기간·시작 공간·메모 */
function NewTenant({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const plans = useApi<{ plans: { code: string; name: string; active: boolean }[] }>('/api/platform');
  const [f, setF] = useState({ company: '', industries: [] as string[], size: '2-10', ownerName: '', ownerEmail: '', planCode: 'trial', trialDays: 14, spaces: [] as string[], memo: '',
    contactName: '', contactPhone: '', contactTitle: '', segment: 'customer', source: '' }); // #656 담당자·구분·소개 경로
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tenant: string; inviteLink: string; mail: 'sent' | 'dev' | 'failed' } | null>(null);
  const toggle = (k: 'industries' | 'spaces', v: string) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api('/api/platform/tenants', { body: { ...f, planCode: f.planCode || 'trial', trialDays: f.planCode === 'trial' ? f.trialDays : undefined, memo: f.memo || undefined,
        contactName: f.contactName || undefined, contactPhone: f.contactPhone || undefined, contactTitle: f.contactTitle || undefined, segment: f.segment || undefined, source: f.source || undefined } });
      setResult(r); toast.ok(r.mail === 'sent' ? `${f.company} 회사를 만들고 ${f.ownerEmail} 로 초대 메일을 보냈습니다` : `${f.company} 회사를 만들었습니다 — 초대 링크를 직접 전달하세요`);
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="고객사 추가">
      {result ? (
        <div className="space-y-2 text-sm" data-testid="new-company-done">
          <p><b>{f.company}</b> 회사가 만들어졌습니다 (id {result.tenant}). 대표 {f.ownerName}({f.ownerEmail})이 초대 링크에서 비밀번호를 정하면 바로 시작합니다 — 운영자가 대신 로그인하는 기능은 없습니다.</p>
          <p className="text-xs">{result.mail === 'sent' ? '초대 메일을 보냈습니다. 같은 링크를 직접 전달해도 됩니다: ' : result.mail === 'failed' ? '초대 메일 발송에 실패했습니다(메일 설정 확인) — 아래 링크를 직접 전달하세요: ' : '메일이 설정되지 않아 링크를 직접 전달해야 합니다: '}<a className="underline" href={result.inviteLink} data-testid="new-company-link">{result.inviteLink}</a></p>
          <div className="flex justify-end"><Button onClick={() => onDone(result.tenant)} data-testid="new-company-open">회사 관리 열기</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3 text-sm" data-testid="new-company">
          <Field label="회사명"><input className={inputCls} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} required maxLength={60} data-testid="new-company-name" /></Field>
          <Field label="업종(여러 개 가능 · 첫 번째가 주 업종)">
            <div className="flex flex-wrap gap-1" data-testid="new-company-industries">{INDUSTRIES.map((k) => <button key={k} type="button" onClick={() => toggle('industries', k)} aria-pressed={f.industries.includes(k)}
              className={cx('rounded-full border px-2.5 py-0.5 text-xs', f.industries.includes(k) ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')}>{k}{f.industries[0] === k && f.industries.length > 1 ? ' · 주' : ''}</button>)}</div>
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="규모"><select className={inputCls} value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} data-testid="new-company-size">{Object.entries(SIZE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="요금제"><select className={inputCls} value={f.planCode} onChange={(e) => setF({ ...f, planCode: e.target.value })} data-testid="new-company-plan"><option value="trial">체험(카드 없음)</option>{(plans.data?.plans ?? []).filter((p) => p.active && p.code !== 'trial').map((p) => <option key={p.code} value={p.code}>{p.name}({p.code})</option>)}</select></Field>
            {f.planCode === 'trial' && <Field label="체험 기간(일)"><input type="number" min={1} max={90} className={inputCls} value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: Number(e.target.value) })} data-testid="new-company-trial-days" /></Field>}
            <Field label="시작 공간(업무는 항상)"><div className="flex items-center gap-3 py-2 text-xs">{(['sales', 'marketing'] as const).map((sp) => <label key={sp} className="flex items-center gap-1"><input type="checkbox" checked={f.spaces.includes(sp)} onChange={() => toggle('spaces', sp)} data-testid={`new-company-space-${sp}`} />{SPACE_LABEL[sp]}</label>)}</div></Field>
            <Field label="대표 이름"><input className={inputCls} value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} required maxLength={50} data-testid="new-company-owner" /></Field>
            <Field label="대표 이메일(초대 메일 받을 주소)"><input type="email" className={inputCls} value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} required data-testid="new-company-email" /></Field>
            <Field label="구분"><select className={inputCls} value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })} data-testid="new-company-segment"><option value="customer">일반 고객</option><option value="partner">설계 파트너 체험단</option></select></Field>
            <Field label="소개 경로(선택)"><input className={inputCls} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} maxLength={100} placeholder="지인·하이링크 고객·홈페이지 문의·광고" data-testid="new-company-source" /></Field>
            <Field label="담당자 이름(비우면 대표)"><input className={inputCls} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} maxLength={50} data-testid="new-company-contact-name" /></Field>
            <Field label="담당자 연락처(선택)"><input className={inputCls} value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} maxLength={30} placeholder="010-0000-0000" data-testid="new-company-contact-phone" /></Field>
            <Field label="담당자 직책(선택)"><input className={inputCls} value={f.contactTitle} onChange={(e) => setF({ ...f, contactTitle: e.target.value })} maxLength={30} data-testid="new-company-contact-title" /></Field>
          </div>
          <Field label="운영 메모(선택)"><textarea className={cx(inputCls, 'min-h-[56px]')} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} maxLength={2000} data-testid="new-company-memo" /></Field>
          <p className="text-xs text-ink-3">만들면 대표에게 초대 메일(7일 유효)이 갑니다. 비밀번호는 대표가 직접 정하고, 운영자가 대신 들어가 보는 기능은 없습니다(지원 모드는 고객사가 허용한 때만).</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy} data-testid="new-company-go">회사 만들기 · 초대 메일</Button></div>
        </form>
      )}
    </Modal>
  );
}

/** 대표 10/24 추가 ①: 회사별 마케팅 자동 제작 글 모델(원고·약한 첫 줄 다시 쓰기·수정본·블로그). 비우면 마케팅 요금제 값(없으면 빠른 모델) */
type Tier = 'fast' | 'default' | 'deep';
const TIER: Record<Tier, string> = { fast: '빠른 모델', default: '표준 모델', deep: '최상 모델' };
function MktWriteBox({ id, w, pick, setPick, run }: { id: string; w: { company: Tier | null; plan: { label: string; tier: Tier | null } | null; tier: Tier; source: string; model: string; perDraftKrw: number; byTier: Record<Tier, number>; blog?: { tier: Tier; perDraftKrw: number; upgraded: boolean; extraKrw: number } }; pick: string | null; setPick: (v: string) => void; run: (fn: () => Promise<any>, ok: string) => Promise<any> }) {
  const v = pick ?? w.company ?? '';
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-input border border-line p-3 text-xs" data-testid="company-mkt-write">
      <span className="min-w-0 flex-1 text-ink-2">마케팅 자동 제작 글 모델(원고·수정본) — 지금 <b className="text-ink" data-testid="company-mkt-write-now">{TIER[w.tier]}</b> ({w.model}) · 글 1건 약 {w.perDraftKrw.toLocaleString('ko-KR')}원 · {w.source === 'company' ? '회사 지정' : w.source === 'plan' ? `마케팅 요금제(${w.plan?.label ?? ''})` : '기본값'} · 품질 검사는 빠른 모델
        {w.blog && <> · 네이버 블로그는 {TIER[w.blog.tier]}(1건 약 {w.blog.perDraftKrw.toLocaleString('ko-KR')}원{w.blog.upgraded ? `, 빠른 모델보다 약 ${w.blog.extraKrw.toLocaleString('ko-KR')}원 더` : ''})</>}</span>
      <select className={cx(inputCls, 'h-8 w-auto py-1 text-xs')} value={v} onChange={(e) => setPick(e.target.value)} aria-label="마케팅 글 모델" data-testid="company-mkt-write-tier">
        <option value="">요금제 값({w.plan ? `${w.plan.label}: ${TIER[w.plan.tier ?? 'fast']}` : '빠른 모델'})</option>
        {(['fast', 'default', 'deep'] as const).map((k) => <option key={k} value={k}>{TIER[k]} · 글 1건 약 {w.byTier[k].toLocaleString('ko-KR')}원</option>)}
      </select>
      <Button size="sm" variant="secondary" onClick={() => run(() => api(`/api/platform/tenants/${id}/mkt-write`, { method: 'PUT', body: { tier: v || null } }), '글 모델을 바꿨습니다')} data-testid="company-mkt-write-save">저장</Button>
    </div>
  );
}

/** #656 고객사 관리 확장(대표 10/26 00:40) — 담당자·구분·소개 경로, 단계(체험/유료/보류/해지, 직접 정하거나 자동), 할인(다음 결제부터), 연락 기록(다음 연락일) */
function CrmBox({ id, t, stage, contacts, billing, run }: { id: string; t: any; stage: string; contacts: any[]; billing: any; run: (fn: () => Promise<any>, ok: string) => Promise<any> }) {
  const [p, setP] = useState({ contactName: t.contact_name ?? '', contactPhone: t.contact_phone ?? '', contactTitle: t.contact_title ?? '', segment: t.segment ?? 'customer', source: t.source ?? '' });
  const [st, setSt] = useState({ stage: t.lifecycle ?? '', note: t.lifecycle_note ?? '' });
  const [dc, setDc] = useState({ pct: String(billing?.discount_pct ?? 0), until: billing?.discount_until ?? '', note: billing?.discount_note ?? '' });
  const [log, setLog] = useState({ kind: 'call', summary: '', nextAt: '' });
  const today = todayKst();
  const small = cx(inputCls, 'mt-0.5 h-8 py-1 text-xs');
  return (
    <div className="space-y-3 rounded-input border border-line p-3" data-testid="company-crm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-ink-2">고객사 관리</span>
        <span className={cx('rounded-full px-2 py-0.5', STAGE_CLS[stage] ?? 'bg-slate-100 text-ink-2')} data-testid="company-stage-badge">{STAGE[stage] ?? stage}{t.lifecycle ? ' · 직접 정함' : ' · 자동'}</span>
        {t.segment === 'partner' && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-800">설계 파트너 체험단</span>}
        {t.lifecycle_note && <span className="text-ink-3">{t.lifecycle_note}</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-5">
        <label className="text-xs">담당자 이름<input className={small} value={p.contactName} onChange={(e) => setP({ ...p, contactName: e.target.value })} placeholder="비우면 대표" maxLength={50} data-testid="company-contact-name" /></label>
        <label className="text-xs">연락처<input className={small} value={p.contactPhone} onChange={(e) => setP({ ...p, contactPhone: e.target.value })} placeholder="010-0000-0000" maxLength={30} data-testid="company-contact-phone" /></label>
        <label className="text-xs">직책<input className={small} value={p.contactTitle} onChange={(e) => setP({ ...p, contactTitle: e.target.value })} maxLength={30} data-testid="company-contact-title" /></label>
        <label className="text-xs">구분<select className={small} value={p.segment} onChange={(e) => setP({ ...p, segment: e.target.value })} data-testid="company-segment"><option value="customer">일반 고객</option><option value="partner">설계 파트너 체험단</option></select></label>
        <label className="text-xs">소개 경로<input className={small} value={p.source} onChange={(e) => setP({ ...p, source: e.target.value })} placeholder="지인·하이링크 고객·문의·광고" maxLength={100} data-testid="company-source" /></label>
      </div>
      <div className="flex justify-end"><Button size="sm" variant="secondary" data-testid="company-profile-save" onClick={() => run(() => api(`/api/platform/tenants/${id}/profile`, { method: 'PUT', body: { contactName: p.contactName, contactPhone: p.contactPhone, contactTitle: p.contactTitle, segment: p.segment || 'customer', source: p.source } }), '담당자 정보를 저장했습니다')}>담당자 저장</Button></div>
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label>단계<select className={cx(small, 'w-auto')} value={st.stage} onChange={(e) => setSt({ ...st, stage: e.target.value })} data-testid="company-stage"><option value="">자동(구독 상태 따라)</option>{Object.entries(STAGE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="min-w-[200px] flex-1">사유<input className={small} value={st.note} onChange={(e) => setSt({ ...st, note: e.target.value })} placeholder="예: 11월 결제 협의 중" maxLength={300} data-testid="company-stage-note" /></label>
        <Button size="sm" variant="secondary" data-testid="company-stage-save" onClick={() => run(() => api(`/api/platform/tenants/${id}/lifecycle`, { method: 'PUT', body: { stage: st.stage || null, note: st.note || undefined } }), st.stage ? `단계를 '${STAGE[st.stage]}'로 정했습니다` : '단계를 자동으로 돌렸습니다')}>단계 저장</Button>
      </div>
      <div className="flex flex-wrap items-end gap-2 text-xs" data-testid="company-discount">
        <label>할인(%)<input type="number" min={0} max={100} className={cx(small, 'w-20')} value={dc.pct} onChange={(e) => setDc({ ...dc, pct: e.target.value })} data-testid="company-discount-pct" /></label>
        <label>기한(비우면 계속)<input type="date" className={cx(small, 'w-auto')} value={dc.until} onChange={(e) => setDc({ ...dc, until: e.target.value })} data-testid="company-discount-until" /></label>
        <label className="min-w-[160px] flex-1">사유<input className={small} value={dc.note} onChange={(e) => setDc({ ...dc, note: e.target.value })} placeholder="예: 설계 파트너 3개월 30%" maxLength={200} data-testid="company-discount-note" /></label>
        <Button size="sm" variant="secondary" data-testid="company-discount-save" onClick={() => run(() => api(`/api/platform/tenants/${id}/discount`, { method: 'PUT', body: { pct: Number(dc.pct) || 0, until: dc.until || null, note: dc.note || null } }), Number(dc.pct) ? '할인을 걸었습니다 — 다음 결제부터 적용' : '할인을 풀었습니다')}>할인 저장</Button>
        {billing?.discountApplied ? <span className="text-emerald-700" data-testid="company-discount-now">지금 {billing.discountApplied}% 적용 중{billing.billing_cycle ? ` · 다음 결제 ${Number(billing.expectedThisMonth ?? 0).toLocaleString('ko-KR')}원` : ' (정기 결제가 시작되면 반영)'}</span> : null}
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-ink-2">연락 기록 {contacts.length}건 — 전화·메일·미팅을 남기고 다음 연락일을 적으면 목록과 ‘오늘 볼 것’에 뜹니다</p>
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label>종류<select className={cx(small, 'w-auto')} value={log.kind} onChange={(e) => setLog({ ...log, kind: e.target.value })} data-testid="company-log-kind">{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="min-w-[200px] flex-1">내용<input className={small} value={log.summary} onChange={(e) => setLog({ ...log, summary: e.target.value })} placeholder="예: 대표와 통화 — 11/3 데모 약속" maxLength={1000} data-testid="company-log-summary" /></label>
          <label>다음 연락<input type="date" className={cx(small, 'w-auto')} value={log.nextAt} onChange={(e) => setLog({ ...log, nextAt: e.target.value })} data-testid="company-log-next" /></label>
          <Button size="sm" data-testid="company-log-add" disabled={!log.summary.trim()} onClick={async () => { const r = await run(() => api(`/api/platform/tenants/${id}/contacts`, { body: { kind: log.kind, summary: log.summary, nextAt: log.nextAt || null } }), '연락 기록을 남겼습니다'); if (r) setLog({ ...log, summary: '', nextAt: '' }); }}>기록</Button>
        </div>
        <ul className="mt-2 max-h-48 divide-y divide-line overflow-y-auto rounded-input border border-line text-xs" data-testid="company-logs">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-2 py-1" data-log={c.id}>
              <span className="shrink-0 text-ink-3">{fmtDateTime(c.at)}</span><span className="shrink-0 rounded-full bg-slate-100 px-1.5">{KIND_LABEL[c.kind] ?? c.kind}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap">{c.summary}</span>
              {c.next_at && <span className={cx('shrink-0', c.next_at <= today ? 'font-medium text-red-600' : 'text-ink-3')}>다음 {c.next_at}</span>}
              {c.by_name && <span className="shrink-0 text-ink-3">{c.by_name}</span>}
              <button type="button" className="text-ink-3 hover:text-red-600" aria-label="기록 지우기" data-testid={`company-log-delete-${c.id}`} onClick={() => confirm('이 연락 기록을 지울까요?') && run(() => api(`/api/platform/tenants/${id}/contacts/${c.id}`, { method: 'DELETE' }), '지웠습니다')}><Trash2 className="size-3.5" /></button>
            </li>
          ))}
          {!contacts.length && <li className="px-2 py-2 text-ink-3">아직 기록이 없습니다</li>}
        </ul>
      </div>
    </div>
  );
}
