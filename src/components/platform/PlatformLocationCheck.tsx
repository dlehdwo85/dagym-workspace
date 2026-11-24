'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, fmtDateTime, inputCls, toast } from '@/components/ui';

type View = {
  month: string;
  kinds: { kind: string; n: number }[];
  viewers: { viewer: string | null; tenant_name: string | null; n: number; people: number; days: number }[];
  tenants: { tenant_name: string | null; collects: number }[];
  checks: { at: string; by: string | null; month: string | null; note: string | null; issues: number }[];
  issues: { code: string; label: string }[];
};
const KIND: Record<string, string> = { collect: '수집(출퇴근 때 위치)', provide: '제공(관리자에게 안/밖 결과)', consent: '동의', withdraw: '철회(좌표 파기)', purge: '보관 기간 파기' };

/**
 * D-18 위치정보 보호조치 ⑤⑥(로컬 11/24 위임): 월 점검 — 지난달 이용·제공 사실 확인자료 요약(누가 몇 명의 결과를 며칠 봤는지) · 자체 점검 결과 · [점검 완료] 기록.
 * 내부 관리 지침(docs/legal/LBS_INTERNAL_POLICY_2026-11-24.md): 위치정보관리책임자가 매달 1번 이 화면으로 점검하고 기록을 남긴다.
 */
export function PlatformLocationCheck() {
  const [month, setMonth] = useState('');
  const { data, reload } = useApi<View>(`/api/platform/location-check${month ? `?month=${month}` : ''}`, [month]);
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  async function done() {
    if (!data) return;
    setBusy(true);
    try { const r = await api<{ issues: unknown[] }>('/api/platform/location-check', { body: { month: data.month, note: note.trim() || undefined } }); toast.ok(`${data.month} 점검을 기록했습니다${r.issues.length ? ` — 확인할 것 ${r.issues.length}건` : ''}`); setNote(''); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <section id="lbs-check" className="rounded-card border border-line bg-white shadow-card" data-testid="lbs-check">
      <h2 className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm font-semibold">위치정보 월 점검
        <span className="text-xs font-normal text-ink-3">출퇴근 위치 — 이용·제공 사실 확인자료 · 자체 점검</span>
        <input type="month" className={`${inputCls} ml-auto h-8 w-auto py-0 text-xs`} value={month || data?.month || ''} onChange={(e) => setMonth(e.target.value)} aria-label="점검할 달" data-testid="lbs-check-month" />
      </h2>
      {!data ? <p className="px-3 py-2 text-sm text-ink-3">불러오는 중…</p> : (
        <div className="space-y-3 px-3 py-3 text-xs">
          <div className={data.issues.length ? 'rounded-input border border-red-200 bg-red-50 px-3 py-2 text-red-800' : 'rounded-input border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800'} data-testid="lbs-check-issues">
            {data.issues.length ? <><b>자체 점검 — 확인할 것 {data.issues.length}건</b><ul className="mt-1 list-disc pl-4">{data.issues.map((i) => <li key={i.code}>{i.label}</li>)}</ul></>
              : <b>자체 점검 이상 없음 — 좌표 암호화·6개월 파기·1년 보관·기록 해시가 맞습니다</b>}
          </div>
          <p className="text-ink-2" data-testid="lbs-check-kinds">{data.month} 확인자료: {data.kinds.length ? data.kinds.map((k) => `${KIND[k.kind] ?? k.kind} ${k.n}건`).join(' · ') : '없음'}</p>
          <div>
            <p className="font-semibold text-ink-2">위치 결과를 본 사람(관리자)</p>
            <table className="mt-1 w-full max-w-2xl text-left" data-testid="lbs-check-viewers">
              <thead><tr className="text-ink-3"><th className="py-0.5 font-medium">회사</th><th className="font-medium">본 사람</th><th className="text-right font-medium">건수</th><th className="text-right font-medium">대상 인원</th><th className="text-right font-medium">날 수</th></tr></thead>
              <tbody>{data.viewers.map((v, i) => <tr key={i} className="border-t border-line"><td className="py-0.5">{v.tenant_name ?? '-'}</td><td>{v.viewer ?? '(지운 계정)'}</td><td className="text-right tabular-nums">{v.n}</td><td className="text-right tabular-nums">{v.people}</td><td className="text-right tabular-nums">{v.days}</td></tr>)}
                {!data.viewers.length && <tr><td colSpan={5} className="py-1 text-ink-3">이 달에는 없음</td></tr>}</tbody>
            </table>
          </div>
          {!!data.tenants.length && <p className="text-ink-2">회사별 수집: {data.tenants.map((t) => `${t.tenant_name ?? '-'} ${t.collects}건`).join(' · ')}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${inputCls} h-8 max-w-md flex-1 py-0 text-xs`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="점검 메모(선택) — 예: 이상 없음, 관리자 1명 열람 많음 확인" aria-label="점검 메모" data-testid="lbs-check-note" />
            <Button size="sm" disabled={busy} onClick={done} data-testid="lbs-check-done">{data.month} 점검 완료 기록</Button>
          </div>
          <ul className="text-ink-3" data-testid="lbs-check-history">
            {data.checks.map((c, i) => <li key={i}>{fmtDateTime(c.at)} · {c.by ?? '-'} · {c.month} 점검{c.issues ? ` · 확인할 것 ${c.issues}건` : ' · 이상 없음'}{c.note ? ` — ${c.note}` : ''}</li>)}
            {!data.checks.length && <li>점검 기록 없음</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
