'use client';
import { useState } from 'react';
import { useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, fmtDateTime, inputCls } from '@/components/ui';

type Log = { id: string; action: string; detail: unknown; ip: string | null; created_at: string; actor_name: string | null; tenant: string | null; tenant_name: string | null; about: string | null; about_name: string | null };

/**
 * 407차 범용화(대표 11/14 '가안' · "슈퍼관리자 계정에서만 타 회사 … 정보 확인할 수 있도록"): 모든 회사 감사 기록.
 * 회사의 [감사 기록] 화면에는 그 회사 계정의 기록만 보인다. 다른 회사 기록, 플랫폼 운영 행위(고객사 추가·메모·요금제·지원 접속), 누구 것인지 알 수 없는 기록(없는 메일로 로그인 실패 등)은 여기서만 본다.
 */
export function PlatformAudit() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('all');
  const [before, setBefore] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<{ logs: Log[]; tenants: { id: string; name: string }[] }>(open ? `/api/platform/audit?scope=${encodeURIComponent(scope)}${before ? `&before=${before}` : ''}` : null, [open, scope, before]);
  const company = (l: Log) => (l.tenant ? l.tenant_name ?? l.tenant : l.about ? `플랫폼 운영 → ${l.about_name ?? l.about}` : '플랫폼 운영·회사 미상');
  return (
    <section className="rounded-card border border-line bg-white shadow-card" data-testid="platform-audit">
      <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-2 text-sm font-semibold">모든 회사 감사 기록
        <span className="text-xs font-normal text-ink-3">회사 화면에는 그 회사 기록만 보입니다. 다른 회사 기록과 플랫폼 운영 기록은 여기서만 봅니다.</span>
        <button type="button" className="ml-auto text-xs font-normal text-ink-2 underline" onClick={() => setOpen((v) => !v)} data-testid="platform-audit-toggle">{open ? '닫기' : '보기(100건씩)'}</button>
      </h2>
      {open && (
        <div className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-ink-2">회사
              <select className={inputCls + ' h-8 w-auto py-0 text-xs'} value={scope} onChange={(e) => { setScope(e.target.value); setBefore(null); }} data-testid="platform-audit-scope">
                <option value="all">전체</option>
                <option value="none">플랫폼 운영·회사 미상</option>
                {(data?.tenants ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            {before && <Button size="sm" variant="secondary" onClick={() => setBefore(null)}>처음으로</Button>}
          </div>
          {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Skeleton className="h-24" /> : (
            <div className="overflow-x-auto rounded-input border border-line">
              <table className="w-full min-w-[760px] text-xs" data-testid="platform-audit-table">
                <thead className="bg-slate-50 text-left text-ink-3"><tr><th className="p-2">시각</th><th className="p-2">회사</th><th className="p-2">사용자</th><th className="p-2">작업</th><th className="p-2">내용</th><th className="p-2">IP</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {(data?.logs ?? []).map((l) => (
                    <tr key={l.id} data-scope={l.tenant ?? 'none'}>
                      <td className="whitespace-nowrap p-2">{fmtDateTime(l.created_at)}</td>
                      <td className="whitespace-nowrap p-2">{l.tenant ? company(l) : <span className="text-ink-3">{company(l)}</span>}</td>
                      <td className="whitespace-nowrap p-2">{l.actor_name ?? '-'}</td>
                      <td className="whitespace-nowrap p-2">{l.action}</td>
                      <td className="max-w-xs truncate p-2 font-mono text-[11px] text-ink-3" title={JSON.stringify(l.detail)}>{JSON.stringify(l.detail)}</td>
                      <td className="whitespace-nowrap p-2">{l.ip ?? ''}</td>
                    </tr>
                  ))}
                  {data && !data.logs.length && <tr><td colSpan={6} className="p-3 text-center text-ink-3">기록이 없습니다</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {data && data.logs.length === 100 && <Button size="sm" variant="secondary" onClick={() => setBefore(data.logs[data.logs.length - 1].id)} data-testid="platform-audit-more">더 이전 기록</Button>}
        </div>
      )}
    </section>
  );
}
