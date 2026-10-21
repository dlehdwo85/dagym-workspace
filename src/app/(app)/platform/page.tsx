'use client';
import { PlatformFunnel } from '@/components/PlatformFunnel';
import { Suspense, useState } from 'react';
import { Building2, Check, Copy, KeyRound, X } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { AiForecast } from '@/components/AiForecast';
import { PlatformTenants } from '@/components/PlatformTenants';
import { PlatformHiggsfield } from '@/components/PlatformHiggsfield';
import { fmtBytes, lim, won } from '@/components/usage';
import { PlatformPayments } from '@/components/Billing';
import { PayTest } from '@/components/PayTest';
import { PlatformSettlement } from '@/components/PlatformSettlement';
import { PlatformSalesSources } from '@/components/sales/PlatformSalesSources';
import { PlatformCollectorSettings } from '@/components/sales/PlatformCollectorSettings';
import { PlatformMktPlans } from '@/components/platform/PlatformMktPlans';
import { PlatformSalesMigrate } from '@/components/sales/PlatformSalesMigrate';
import { PlatformOpsImport } from '@/components/marketing/PlatformOpsImport';
import { Button, ErrorBox, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

const num = (v: string) => (v.trim() === '' ? null : Number(v));
const cell = 'px-2 py-1.5';
const small = cx(inputCls, 'h-8 px-2 py-1 text-xs');

/** V10 플랫폼 운영(워크인 운영사 전용): 모든 회사 사용량·요금제 지정·요금제 숫자 변경·변경 요청 처리. 결제 연동 없음 */
export default function PlatformPage() {
  const { data, error, loading, reload } = useApi<any>('/api/platform');
  const [subs, setSubs] = useState<Record<string, any>>({});
  const [plans, setPlans] = useState<Record<string, any>>({});
  const tickets = useApi<{ tickets: any[] }>('/api/support/admin');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Skeleton rows={6} />;
  const save = async (url: string, body: unknown, done: () => void) => {
    try { await api(url, { method: 'PUT', body }); done(); reload(); toast.ok('저장했습니다'); } catch (e: any) { toast.error(e.message); }
  };
  const decide = async (id: string, approve: boolean) => {
    try { await api(`/api/platform/requests/${id}`, { body: { approve } }); reload(); toast.ok(approve ? '반영했습니다' : '반려했습니다'); } catch (e: any) { toast.error(e.message); }
  };
  const pctTone = (p: number | null) => (p === null ? 'text-ink-3' : p >= 100 ? 'font-semibold text-red-600' : p >= 80 ? 'text-amber-600' : 'text-ink-2');
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader title="플랫폼 운영" icon={Building2} sub="모든 회사의 사용량과 요금제. 요금제 숫자는 여기서 바꾸면 바로 적용됩니다(배포 없음). 결제 흐름은 아래 [결제 시험]에서 시험 상점으로 확인합니다." />
      {!!data.requests.filter((r: any) => r.status === 'pending').length && (
        <section className="rounded-card border border-amber-200 bg-amber-50 p-3" data-testid="platform-requests">
          <h2 className="text-sm font-semibold">변경 요청</h2>
          {data.requests.filter((r: any) => r.status === 'pending').map((r: any) => (
            <div key={r.id} className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1">{r.tenant_name} · {r.requested_by_name} · {r.plan_code ?? '옵션'}{r.addons && ` · ${Object.entries(r.addons).map(([k, v]) => `${k}×${v}`).join(', ')}`}{r.note && ` — ${r.note}`} <span className="text-xs text-ink-3">{fmtDateTime(r.created_at)}</span></span>
              <Button size="sm" onClick={() => decide(r.id, true)}><Check />반영</Button>
              <Button size="sm" variant="secondary" onClick={() => decide(r.id, false)}><X />반려</Button>
            </div>
          ))}
        </section>
      )}
      <PlatformTenants />
      <Signups />
      <PlatformPayments />
      <PlatformSettlement />
      <Suspense><PayTest /></Suspense>
      <InquiryLink />
      {/* V12 3번: 문의 접수함 */}
      <PlatformFunnel />
      <AiForecast />
      <PlatformHiggsfield />
      <PlatformSalesMigrate />
      <PlatformSalesSources />
      <PlatformCollectorSettings />
      <PlatformMktPlans />
      <PlatformOpsImport />
      <section id="support" className="rounded-card border border-line bg-white shadow-card" data-testid="support-inbox">
        <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">문의 접수함 {tickets.data && <span className="text-xs font-normal text-ink-3">미답변 {tickets.data.tickets.filter((t) => t.status === 'open').length}건</span>}</h2>
        <ul className="divide-y divide-line text-sm">
          {tickets.data?.tickets.slice(0, 30).map((t) => (
            <li key={t.id} className="p-3">
              <div className="flex justify-between gap-2"><b className="font-medium">[{({ question: '사용', bug: '오류', billing: '요금', idea: '제안' } as Record<string, string>)[t.category]}] {t.subject}</b><span className="text-xs text-ink-3">{t.user_name} · {t.tenant} · {fmtDateTime(t.created_at)}</span></div>
              <p className="mt-1 whitespace-pre-wrap text-ink-2">{t.body}</p>
              {t.answer ? <p className="mt-1 rounded bg-green-50 p-2 text-xs">답변: {t.answer}</p> : (
                <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); const a = (e.currentTarget.elements.namedItem('a') as HTMLInputElement).value;
                  try { await api(`/api/support/${t.id}`, { body: { answer: a } }); tickets.reload(); toast.ok('답변했습니다'); } catch (er: any) { toast.error(er.message); } }}>
                  <input name="a" className={small} placeholder="답변 (문의한 사람에게 알림)" aria-label={`${t.subject} 답변`} /><Button size="sm" type="submit">답변</Button>
                </form>
              )}
            </li>
          ))}
          {!tickets.data?.tickets.length && <li className="p-3 text-ink-3">문의가 없습니다</li>}
        </ul>
      </section>
      <section className="rounded-card border border-line bg-white shadow-card">
        <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">회사별 사용량</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm" data-testid="platform-tenants">
            <thead><tr className="text-left text-xs text-ink-3"><th className={cell}>회사</th><th className={cell}>저장공간</th><th className={cell}>AI(이번 달)</th><th className={cell}>사용자</th><th className={cell}>요금제</th><th className={cell}>추가 옵션</th><th className={cell}>갱신일·상태</th><th /></tr></thead>
            <tbody>
              {data.tenants.map((t: any) => {
                const e = subs[t.id] ?? { planCode: t.planCode, addons: t.addons ?? {}, periodEnd: t.periodEnd ? String(t.periodEnd).slice(0, 10) : '', status: t.status };
                const set = (patch: any) => setSubs({ ...subs, [t.id]: { ...e, ...patch } });
                return (
                  <tr key={t.id} className={cx('border-t border-line align-top', t.overLimit && 'bg-red-50/50')}>
                    <td className={cell}><div className="font-medium">{t.name}</div><div className="text-[11px] text-ink-3">{t.id}{t.overLimit && <b className="ml-1 text-red-600">한도 초과</b>}</div></td>
                    <td className={cx(cell, pctTone(t.pct.storage))}>{fmtBytes(t.usage.storageBytes)} / {lim(t.limits.storageGb, 'GB')}</td>
                    <td className={cx(cell, pctTone(t.pct.ai))}>{t.usage.aiRequests}회 / {lim(t.limits.aiRequests, '회')}<div className="text-[11px] text-ink-3">${t.usage.aiCostUsd}</div></td>
                    <td className={cx(cell, pctTone(t.pct.users))}>{t.usage.users}명 / {lim(t.limits.users, '명')}</td>
                    <td className={cell}>
                      <select className={small} value={e.planCode} onChange={(x) => set({ planCode: x.target.value })} aria-label={`${t.name} 요금제`}>
                        {data.plans.map((p: any) => <option key={p.code} value={p.code}>{p.name}</option>)}
                      </select>
                    </td>
                    <td className={cell}>
                      {data.addons.map((a: any) => (
                        <label key={a.code} className="mb-0.5 flex items-center gap-1 text-[11px]">
                          <input type="number" min={0} className={cx(small, 'w-14')} value={e.addons[a.code] ?? 0} onChange={(x) => set({ addons: { ...e.addons, [a.code]: Number(x.target.value) } })} aria-label={`${t.name} ${a.name}`} />{a.name}
                        </label>
                      ))}
                    </td>
                    <td className={cell}>
                      <input type="date" className={small} value={e.periodEnd} onChange={(x) => set({ periodEnd: x.target.value })} aria-label={`${t.name} 갱신일`} />
                      <select className={cx(small, 'mt-1')} value={e.status} onChange={(x) => set({ status: x.target.value })} aria-label={`${t.name} 상태`}>
                        <option value="active">사용 중</option><option value="trial">체험</option><option value="suspended">일시 중지</option>
                      </select>
                    </td>
                    <td className={cell}><Button size="sm" onClick={() => save(`/api/platform/tenants/${t.id}`, { ...e, periodEnd: e.periodEnd || null }, () => setSubs((s) => { const n = { ...s }; delete n[t.id]; return n; }))} aria-label={`${t.name} 저장`}>저장</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-card border border-line bg-white shadow-card">
        <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">요금제 (비우면 무제한·별도 협의)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm" data-testid="platform-plans">
            <thead><tr className="text-left text-xs text-ink-3"><th className={cell}>코드</th><th className={cell}>이름</th><th className={cell}>월 요금(원)</th><th className={cell}>1인 요금</th><th className={cell}>사용자</th><th className={cell}>저장(GB)</th><th className={cell}>AI 요청/월</th><th className={cell}>1인 저장·AI</th><th className={cell}>공개</th><th /></tr></thead>
            <tbody>
              {data.plans.map((p: any) => {
                const e = plans[p.code] ?? { name: p.name, monthlyKrw: p.monthly_krw ?? '', perUserKrw: p.per_user_krw ?? '', puStorage: p.limits.perUserStorageGb ?? '', puAi: p.limits.perUserAi ?? '', users: p.limits.users ?? '', storageGb: p.limits.storageGb ?? '', aiRequests: p.limits.aiRequests ?? '', public: p.public };
                const set = (patch: any) => setPlans({ ...plans, [p.code]: { ...e, ...patch } });
                return (
                  <tr key={p.code} className="border-t border-line">
                    <td className={cx(cell, 'text-xs text-ink-3')}>{p.code}</td>
                    <td className={cell}><input className={small} value={e.name} onChange={(x) => set({ name: x.target.value })} aria-label={`${p.code} 이름`} /></td>
                    <td className={cell}><input className={small} inputMode="numeric" value={e.monthlyKrw} onChange={(x) => set({ monthlyKrw: x.target.value })} aria-label={`${p.code} 월 요금`} /></td>
                    <td className={cell}><input className={small} inputMode="numeric" value={e.perUserKrw} onChange={(x) => set({ perUserKrw: x.target.value })} aria-label={`${p.code} 1인 요금`} /></td>
                    {(['users', 'storageGb', 'aiRequests'] as const).map((k) => <td key={k} className={cell}><input className={small} inputMode="numeric" value={e[k]} onChange={(x) => set({ [k]: x.target.value })} aria-label={`${p.code} ${k}`} /></td>)}
                    <td className={cell}><span className="flex gap-1"><input className={cx(small, 'w-12')} inputMode="numeric" value={e.puStorage} onChange={(x) => set({ puStorage: x.target.value })} aria-label={`${p.code} 1인 저장GB`} /><input className={cx(small, 'w-12')} inputMode="numeric" value={e.puAi} onChange={(x) => set({ puAi: x.target.value })} aria-label={`${p.code} 1인 AI`} /></span></td>
                    <td className={cell}><input type="checkbox" checked={e.public} onChange={(x) => set({ public: x.target.checked })} aria-label={`${p.code} 공개`} /></td>
                    <td className={cell}><Button size="sm" variant="secondary" onClick={() => save(`/api/platform/plans/${p.code}`, { name: e.name, monthlyKrw: num(String(e.monthlyKrw)), perUserKrw: num(String(e.perUserKrw)), public: e.public,
                      limits: { users: num(String(e.users)), storageGb: num(String(e.storageGb)), aiRequests: num(String(e.aiRequests)),
                        ...(num(String(e.puStorage)) ? { perUserStorageGb: num(String(e.puStorage))! } : {}), ...(num(String(e.puAi)) ? { perUserAi: num(String(e.puAi))! } : {}) } }, () => setPlans((s) => { const n = { ...s }; delete n[p.code]; return n; }))}>저장</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="px-3 py-2 text-xs text-ink-3">추가 옵션: {data.addons.map((a: any) => `${a.name} 월 ${won(a.monthly_krw)}`).join(' · ')} (옵션 숫자 변경은 API PUT /api/platform/addons/:code)</p>
      </section>
    </div>
  );
}

/** V15 신규 가입 목록 · 차단 · 최근 하루 가입 시도 */
function Signups() {
  const { data, reload } = useApi<any>('/api/platform/signups');
  if (!data) return null;
  const trial = async (id: string, body: any) => {
    try { await api(`/api/platform/tenants/${id}/trial`, { body }); reload(); toast.ok('바꿨습니다'); } catch (e: any) { toast.error(e.message); }
  };
  const setStatus = async (id: string, status: string) => {
    if (status === 'blocked' && !confirm('이 공간을 차단할까요? 모든 구성원이 바로 로그아웃됩니다.')) return;
    try { await api(`/api/platform/tenants/${id}/status`, { method: 'PUT', body: { status } }); reload(); toast.ok('바꿨습니다'); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <section className="rounded-card border border-line bg-white shadow-card" data-testid="platform-signups">
      <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">신규 가입 {data.tenants.length}곳
        <span className="ml-2 text-xs font-normal text-ink-3">최근 24시간 시도: {data.attempts.map((a: any) => `${({ ok: '성공', exists: '이미 있음', bot: '봇', rate: '제한', resend: '재발송' } as Record<string, string>)[a.reason] ?? a.reason} ${a.n}`).join(' · ') || '없음'}</span></h2>
      <div className="max-h-96 overflow-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead><tr className="text-left text-xs text-ink-3"><th className={cell}>공간</th><th className={cell}>대표</th><th className={cell}>사람·업무</th><th className={cell}>가입</th><th className={cell}>체험·요금</th><th className={cell}>상태</th><th /></tr></thead>
          <tbody>
            {data.tenants.map((t: any) => (
              <tr key={t.id} className={cx('border-t border-line', t.status !== 'active' && 'bg-slate-50 text-ink-3')}>
                <td className={cell}><div className="font-medium">{t.name}</div><div className="text-[11px] text-ink-3">{t.kind === 'personal' ? '개인' : '팀'} · {t.id}</div></td>
                <td className={cell}>{t.owner_email}{t.signup_pending && <span className="ml-1 text-[11px] text-amber-700">메일 미확인</span>}</td>
                <td className={cell}>{t.users}명 · 업무 {t.tasks}</td>
                <td className={cell}><div>{fmtDateTime(t.created_at)}</div><div className="text-[11px] text-ink-3">{t.created_ip}</div></td>
                <td className={cell} data-testid={`trial-${t.id}`}>
                  <div className="text-xs">{t.sub_status === 'trial' ? `체험 ~${String(t.trial_ends_at ?? '').slice(0, 10)}` : t.sub_status === 'expired' ? '체험 끝(읽기 전용)' : t.plan_code ?? '-'}{t.chosen_plan && <span className="ml-1 text-brand-700">신청: {t.chosen_plan}</span>}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {[7, 14].map((d) => <Button key={d} size="sm" variant="ghost" onClick={() => trial(t.id, { action: 'extend', days: d })}>+{d}일</Button>)}
                    {t.sub_status !== 'expired' && <Button size="sm" variant="ghost" onClick={() => trial(t.id, { action: 'end' })}>종료</Button>}
                    <Button size="sm" variant="ghost" onClick={() => { const code = prompt('전환할 요금제 코드 (personal · team · business)', t.chosen_plan ?? 'team'); if (code) trial(t.id, { action: 'convert', planCode: code }); }}>유료 전환</Button>
                  </div>
                </td>
                <td className={cell}>{({ active: '사용 중', blocked: '차단', deleted: '삭제' } as Record<string, string>)[t.status] ?? t.status}</td>
                <td className={cell}>{t.status === 'active' ? <Button size="sm" variant="secondary" onClick={() => setStatus(t.id, 'blocked')}>차단</Button> : t.status === 'blocked' ? <Button size="sm" variant="secondary" onClick={() => setStatus(t.id, 'active')}>해제</Button> : null}</td>
              </tr>
            ))}
            {!data.tenants.length && <tr><td className={cx(cell, 'text-ink-3')} colSpan={7}>아직 가입한 공간이 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
      {!!data.ips.length && <p className="border-t border-line px-3 py-2 text-xs text-ink-3">IP별(24시간): {data.ips.map((x: any) => `${x.ip ?? '?'} ${x.n}회(성공 ${x.ok})`).join(' · ')}</p>}
    </section>
  );
}

/** 16차: 다짐·하이링크 웹사이트 문의 → 워크인 업무. 다짐 회사 슈퍼관리자에게만 보인다(다른 회사는 API 404 → 섹션 없음) */
function InquiryLink() {
  const { data, reload } = useApi<any>('/api/platform/inquiries');
  const [shown, setShown] = useState<{ site: string; token: string } | null>(null);
  const [asg, setAsg] = useState<{ a: Record<string, string[]>; m: Record<string, string> } | null>(null);
  if (!data) return null;
  const cur = asg ?? { a: data.assignees ?? {}, m: data.modes ?? {} };
  const setList = (t: string, list: string[]) => setAsg({ ...cur, a: { ...cur.a, [t]: list } });
  const uname = (id: string) => data.users.find((u: any) => u.id === id)?.name ?? '?';
  const SITE: Record<string, string> = { dagym: '다짐', hilink: '하이링크' };
  const issue = async (site: string) => {
    try { const r = await api('/api/platform/inquiries/tokens', { body: { site } }); setShown({ site, token: r.token }); reload(); } catch (e: any) { toast.error(e.message); }
  };
  const revoke = async (id: string) => {
    if (!confirm('이 토큰을 폐기할까요? 이 토큰을 쓰는 사이트의 문의가 더 이상 워크인에 등록되지 않습니다.')) return;
    try { await api(`/api/platform/inquiries/tokens/${id}`, { method: 'DELETE' }); reload(); toast.ok('폐기했습니다'); } catch (e: any) { toast.error(e.message); }
  };
  const saveAsg = async () => {
    try { await api('/api/platform/inquiries/assignees', { method: 'PUT', body: { assignees: Object.fromEntries(data.types.map((t: string) => [t, cur.a[t] ?? []])), modes: Object.fromEntries(data.types.map((t: string) => [t, cur.m[t] ?? 'together'])) } }); setAsg(null); reload(); toast.ok('저장했습니다'); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <section className="rounded-card border border-line bg-white shadow-card" data-testid="inquiry-link">
      <h2 className="border-b border-line px-3 py-2 text-sm font-semibold">웹사이트 문의 연동 <span className="text-xs font-normal text-ink-3">다짐·하이링크 사이트 문의 → &lsquo;웹사이트 문의&rsquo; 프로젝트에 업무로 자동 등록</span></h2>
      <div className="space-y-3 p-3 text-sm">
        <p className="text-xs text-ink-3">주소: <code className="break-all">POST {data.endpoint || '/api/integrations/inquiries'}</code> · 헤더 <code>Authorization: Bearer 토큰</code> · 같은 lead_id 는 한 번만 등록</p>
        {shown && (
          <div className="rounded border border-amber-300 bg-amber-50 p-2" data-testid="inquiry-token-shown">
            <p className="text-xs font-semibold text-amber-800">{SITE[shown.site]} 토큰 — 지금 한 번만 보입니다. 사이트 환경변수에 넣어 주세요.</p>
            <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded bg-white px-2 py-1 text-xs">{shown.token}</code>
              <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(shown.token); toast.ok('복사했습니다'); }}><Copy />복사</Button>
              <Button size="sm" variant="ghost" onClick={() => setShown(null)}>닫기</Button></div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {Object.keys(SITE).map((s) => <Button key={s} size="sm" variant="secondary" onClick={() => issue(s)}><KeyRound />{SITE[s]} 토큰 발급</Button>)}
        </div>
        <ul className="divide-y divide-line rounded border border-line">
          {data.tokens.map((t: any) => (
            <li key={t.id} className={cx('flex flex-wrap items-center gap-2 px-2 py-1.5', t.revoked_at && 'text-ink-3')}>
              <span className="min-w-0 flex-1">{t.name} <span className="text-xs text-ink-3">…{t.hint} · 발급 {fmtDateTime(t.created_at)}{t.created_by_name && ` · ${t.created_by_name}`} · 마지막 사용 {t.last_used_at ? fmtDateTime(t.last_used_at) : '없음'}</span></span>
              {t.revoked_at ? <span className="text-xs">폐기됨</span> : <Button size="sm" variant="ghost" onClick={() => revoke(t.id)}>폐기</Button>}
            </li>
          ))}
          {!data.tokens.length && <li className="px-2 py-1.5 text-ink-3">발급한 토큰이 없습니다</li>}
        </ul>
        <div>
          <h3 className="text-xs font-semibold text-ink-2">유형별 기본 담당자 <span className="font-normal text-ink-3">(여러 명 가능 · 첫 사람이 주 담당 · 비워 두면 대표 · 알림은 전원)</span></h3>
          <div className="mt-1 space-y-2">
            {data.types.map((t: string) => {
              const list: string[] = cur.a[t] ?? [];
              return (
                <div key={t} className="rounded border border-line p-2 text-xs" data-testid={`inquiry-asg-${t}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <b className="w-28 shrink-0 font-medium">{t}</b>
                    {!list.length && <span className="text-ink-3">대표</span>}
                    {list.map((id, k) => (
                      <span key={id} className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5', k === 0 ? 'border-brand-300 bg-brand-50' : 'border-line bg-white')}>
                        {k === 0 && <span className="text-[10px] text-brand-700">주</span>}{uname(id)}
                        {k > 0 && <button type="button" className="text-ink-3" aria-label={`${uname(id)} 주 담당으로`} title="주 담당으로" onClick={() => setList(t, [id, ...list.filter((x) => x !== id)])}>↑</button>}
                        <button type="button" className="text-ink-3" aria-label={`${uname(id)} 빼기`} onClick={() => setList(t, list.filter((x) => x !== id))}><X className="size-3" /></button>
                      </span>
                    ))}
                    <select className={cx(small, 'w-auto')} value="" onChange={(e) => e.target.value && setList(t, [...list, e.target.value])} aria-label={`${t} 담당자 추가`}>
                      <option value="">+ 사람 추가</option>
                      {data.users.filter((u: any) => !list.includes(u.id)).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  {list.length > 1 && (
                    <div className="mt-1.5 flex flex-wrap gap-3 pl-[7.5rem] text-ink-2">
                      <label className="inline-flex items-center gap-1"><input type="radio" name={`mode-${t}`} checked={(cur.m[t] ?? 'together') === 'together'} onChange={() => setAsg({ ...cur, m: { ...cur.m, [t]: 'together' } })} />한 업무 — 주 담당 + 협업자</label>
                      <label className="inline-flex items-center gap-1"><input type="radio" name={`mode-${t}`} checked={cur.m[t] === 'each'} onChange={() => setAsg({ ...cur, m: { ...cur.m, [t]: 'each' } })} />담당자마다 각각 업무</label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {asg && <Button size="sm" className="mt-2" onClick={saveAsg}>담당자 저장</Button>}
        </div>
        {!!data.recent.length && (
          <div>
            <h3 className="text-xs font-semibold text-ink-2">최근 문의</h3>
            <ul className="mt-1 space-y-0.5 text-xs">
              {data.recent.map((q: any) => (
                <li key={q.lead_id}>{fmtDateTime(q.created_at)} · {SITE[q.site]} · {q.inquiry_type} · {q.task_id ? <a className="text-accent-600 underline" href={`/tasks/${q.task_id}`}>{q.title}</a> : q.organization ?? q.lead_id}{q.assignee_name && ` · ${q.assignee_name}`}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
