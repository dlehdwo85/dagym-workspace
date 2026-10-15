'use client';
import { useState } from 'react';
import { Eye, KeyRound, Lock, LockOpen, Search, ShieldOff, Trash2 } from 'lucide-react';
import { api, useApi } from './client';
import { fmtBytes } from './usage';
import { Button, Modal, cx, fmtDateTime, inputCls, toast } from './ui';

const cell = 'px-2 py-1.5';
const STATUS: Record<string, string> = { active: '사용 중', blocked: '정지', deleted: '삭제' };
const SUB: Record<string, string> = { trial: '체험', expired: '체험 끝(읽기 전용)', active: '사용', suspended: '중지' };

/** V28-3 슈퍼 계정: 회사 목록(검색·필터) → 상세(요금제·정지·체험·읽기 전용·삭제 예약·한도·사용자·지원 모드) */
export function PlatformTenants() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const list = useApi<{ tenants: any[] }>(`/api/platform/tenants?q=${encodeURIComponent(query)}&status=${status}`, [query, status]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="rounded-card border border-line bg-white shadow-card" data-testid="platform-company-list">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold">회사 관리 {list.data && <span className="text-xs font-normal text-ink-3">{list.data.tenants.length}곳</span>}</h2>
        <form className="ml-auto flex gap-1.5" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <input className={cx(inputCls, 'h-8 w-48 py-1 text-xs')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="회사·대표 이메일·id" aria-label="회사 찾기" />
          <Button size="sm" type="submit" variant="secondary"><Search />찾기</Button>
        </form>
        <select className={cx(inputCls, 'h-8 w-auto py-1 text-xs')} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="상태">
          <option value="">전체</option><option value="active">사용 중</option><option value="blocked">정지</option><option value="trial">체험·체험 끝</option><option value="deleting">삭제 예약</option>
        </select>
      </div>
      <div className="max-h-[28rem] overflow-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead><tr className="text-left text-xs text-ink-3"><th className={cell}>회사</th><th className={cell}>요금제</th><th className={cell}>상태</th><th className={cell}>인원</th><th className={cell}>저장</th><th className={cell}>AI(이번 달)</th><th className={cell}>청구·미납</th><th className={cell}>최근 접속</th><th className={cell}>가입</th><th className={cell} /></tr></thead>
          <tbody>
            {(list.data?.tenants ?? []).map((t) => (
              <tr key={t.id} className={cx('border-t border-line', t.status !== 'active' && 'bg-slate-50 text-ink-3')} data-tenant={t.id}>
                <td className={cell}><div className="font-medium">{t.name}</div><div className="text-[11px] text-ink-3">{t.id} · {t.owner_email ?? '-'}</div></td>
                <td className={cell}>{t.plan_code ?? '-'}<div className="text-[11px] text-ink-3">{SUB[t.sub_status] ?? ''}{t.sub_status === 'trial' && t.trial_ends_at ? ` ~${String(t.trial_ends_at).slice(0, 10)}` : ''}</div></td>
                <td className={cell}>{STATUS[t.status] ?? t.status}{t.delete_scheduled_at && <div className="text-[11px] text-red-600">삭제 예정 {String(t.delete_scheduled_at).slice(0, 10)}</div>}{t.support_consent_at && <div className="text-[11px] text-emerald-700">지원 허용</div>}</td>
                <td className={cell}>{t.users}명</td>
                <td className={cell}>{t.storage_bytes != null ? fmtBytes(Number(t.storage_bytes)) : '-'}</td>
                <td className={cell}>{t.ai_requests}회 · {Math.round(Number(t.ai_krw)).toLocaleString()}원</td>
                <td className={cell}>{t.billing_amount ? `${Number(t.billing_amount).toLocaleString()}원/${t.billing_cycle === 'annual' ? '년' : '월'}` : '-'}
                  {t.next_billing_on && <div className="text-[11px] text-ink-3">다음 {String(t.next_billing_on).slice(0, 10)}</div>}
                  {t.past_due_since && <div className="text-[11px] font-medium text-red-600">미납 {String(t.past_due_since).slice(0, 10)}~{t.billing_lock === 'suspended' ? ' · 이용 중지' : t.billing_lock === 'read_only' ? ' · 읽기 전용' : ''}</div>}
                  {t.last_payment && <div className="text-[11px] text-ink-3">최근 {String(t.last_payment.at).slice(0, 10)} {t.last_payment.status === 'paid' ? '성공' : t.last_payment.status}</div>}</td>
                <td className={cell}>{t.last_login_at ? fmtDateTime(t.last_login_at) : '-'}</td>
                <td className={cell}>{String(t.created_at).slice(0, 10)}</td>
                <td className={cell}><Button size="sm" variant="secondary" onClick={() => setOpen(t.id)} data-testid={`company-open-${t.id}`}>관리</Button></td>
              </tr>
            ))}
            {list.data && !list.data.tenants.length && <tr><td className={cx(cell, 'text-ink-3')} colSpan={10}>찾는 회사가 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <TenantDetail id={open} onClose={() => { setOpen(null); list.reload(); }} />}
    </section>
  );
}

function TenantDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useApi<any>(`/api/platform/tenants/${id}/detail`, [id]);
  const [ov, setOv] = useState<{ users: string; storageGb: string; aiRequests: string } | null>(null);
  const t = d.data?.tenant;
  const run = async (fn: () => Promise<any>, ok: string) => { try { const r = await fn(); toast.ok(ok); d.reload(); return r; } catch (e: any) { toast.error(e.message); } };
  if (!d.data) return <Modal open onClose={onClose} title="회사 관리" wide><p className="text-sm text-ink-3">불러오는 중…</p></Modal>;
  const internal = id === 'default' || id === 'demo';
  const o = d.data.subscription.overrides ?? {};
  const cur = ov ?? { users: o.users === undefined ? '' : String(o.users ?? ''), storageGb: o.storageGb === undefined ? '' : String(o.storageGb ?? ''), aiRequests: o.aiRequests === undefined ? '' : String(o.aiRequests ?? '') };
  const n = (v: string) => (v.trim() === '' ? undefined : v.trim() === '무제한' ? null : Number(v));
  return (
    <Modal open onClose={onClose} title={`회사 관리 — ${t.name}`} wide>
      <div className="space-y-4 text-sm" data-testid="company-detail">
        <p className="text-xs text-ink-2">{t.id} · 대표 {t.owner_email ?? '-'} · 요금제 {d.data.subscription.planCode}({SUB[d.data.subscription.status] ?? d.data.subscription.status}) · {STATUS[t.status] ?? t.status}
          {' '}· 사용 {d.data.usage.users}명 / 저장 {fmtBytes(d.data.usage.storageBytes)} / AI {d.data.usage.aiRequests}회</p>
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
                {d.data.payments.map((p: any) => <li key={p.id}>{String(p.paid_at ?? p.created_at).slice(0, 16).replace('T', ' ')} · {p.kind} {p.plan_code ?? ''} · {Number(p.amount).toLocaleString()}원 · <b className={p.status === 'paid' ? 'text-emerald-700' : p.status === 'failed' ? 'text-red-600' : ''}>{p.status}</b>{p.result_msg && ` · ${p.result_msg}`}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="rounded-input border border-line p-3">
          <p className="mb-2 text-xs font-medium text-ink-2">한도 개별 조정 (비우면 요금제 값, ‘무제한’ 입력 가능) — AI 크레딧 지급은 AI 한도를 올려 주세요</p>
          <div className="flex flex-wrap items-end gap-2">
            {([['users', '인원(명)'], ['storageGb', '저장(GB)'], ['aiRequests', 'AI(회/월)']] as const).map(([k, l]) => (
              <label key={k} className="text-xs">{l}<input className={cx(inputCls, 'mt-0.5 h-8 w-28 py-1 text-xs')} value={cur[k]} placeholder={String(d.data.limits[k] ?? '무제한')} onChange={(e) => setOv({ ...cur, [k]: e.target.value })} data-testid={`ov-${k}`} /></label>
            ))}
            <Button size="sm" onClick={() => run(() => api(`/api/platform/tenants/${id}/limits`, { method: 'PUT', body: { users: n(cur.users), storageGb: n(cur.storageGb), aiRequests: n(cur.aiRequests),
              clear: (['users', 'storageGb', 'aiRequests'] as const).filter((k) => cur[k].trim() === '') } }), '한도를 바꿨습니다')} data-testid="ov-save">저장</Button>
          </div>
        </div>
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
