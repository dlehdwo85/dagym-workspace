'use client';
import { useState } from 'react';
import { Building2, Check, X } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { fmtBytes, lim, won } from '@/components/usage';
import { Button, ErrorBox, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

const num = (v: string) => (v.trim() === '' ? null : Number(v));
const cell = 'px-2 py-1.5';
const small = cx(inputCls, 'h-8 px-2 py-1 text-xs');

/** V10 플랫폼 운영(워크인 운영사 전용): 모든 회사 사용량·요금제 지정·요금제 숫자 변경·변경 요청 처리. 결제 연동 없음 */
export default function PlatformPage() {
  const { data, error, loading, reload } = useApi<any>('/api/platform');
  const [subs, setSubs] = useState<Record<string, any>>({});
  const [plans, setPlans] = useState<Record<string, any>>({});
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
      <PageHeader title="플랫폼 운영" icon={Building2} sub="모든 회사의 사용량과 요금제. 요금제 숫자는 여기서 바꾸면 바로 적용됩니다(배포 없음). 결제는 아직 연결되지 않았습니다." />
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
          <table className="w-full min-w-[720px] text-sm" data-testid="platform-plans">
            <thead><tr className="text-left text-xs text-ink-3"><th className={cell}>코드</th><th className={cell}>이름</th><th className={cell}>월 요금(원)</th><th className={cell}>사용자</th><th className={cell}>저장(GB)</th><th className={cell}>AI 요청/월</th><th className={cell}>공개</th><th /></tr></thead>
            <tbody>
              {data.plans.map((p: any) => {
                const e = plans[p.code] ?? { name: p.name, monthlyKrw: p.monthly_krw ?? '', users: p.limits.users ?? '', storageGb: p.limits.storageGb ?? '', aiRequests: p.limits.aiRequests ?? '', public: p.public };
                const set = (patch: any) => setPlans({ ...plans, [p.code]: { ...e, ...patch } });
                return (
                  <tr key={p.code} className="border-t border-line">
                    <td className={cx(cell, 'text-xs text-ink-3')}>{p.code}</td>
                    <td className={cell}><input className={small} value={e.name} onChange={(x) => set({ name: x.target.value })} aria-label={`${p.code} 이름`} /></td>
                    <td className={cell}><input className={small} inputMode="numeric" value={e.monthlyKrw} onChange={(x) => set({ monthlyKrw: x.target.value })} aria-label={`${p.code} 월 요금`} /></td>
                    {(['users', 'storageGb', 'aiRequests'] as const).map((k) => <td key={k} className={cell}><input className={small} inputMode="numeric" value={e[k]} onChange={(x) => set({ [k]: x.target.value })} aria-label={`${p.code} ${k}`} /></td>)}
                    <td className={cell}><input type="checkbox" checked={e.public} onChange={(x) => set({ public: x.target.checked })} aria-label={`${p.code} 공개`} /></td>
                    <td className={cell}><Button size="sm" variant="secondary" onClick={() => save(`/api/platform/plans/${p.code}`, { name: e.name, monthlyKrw: num(String(e.monthlyKrw)), public: e.public,
                      limits: { users: num(String(e.users)), storageGb: num(String(e.storageGb)), aiRequests: num(String(e.aiRequests)) } }, () => setPlans((s) => { const n = { ...s }; delete n[p.code]; return n; }))}>저장</Button></td>
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
