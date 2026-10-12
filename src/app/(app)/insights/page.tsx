'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowDownUp, BarChart3, MapPin } from 'lucide-react';
import { useApi } from '@/components/client';
import { useSession, canManage } from '@/components/session';
import { BRAND_TONE, ErrorBox, PageHeader, Skeleton, cx, fmtDate } from '@/components/ui';
import { UNIT_TYPE_LABEL } from '@/lib/types';

type Site = any;
const COLS: { key: string; label: string; hint: string; fmt: (s: Site) => string; tone?: (s: Site) => string; sortVal: (s: Site) => number }[] = [
  { key: 'onTime', label: '기한 준수율', hint: '기간 중 완료한 업무 중 마감일 안에 끝낸 비율', fmt: (s) => (s.onTimeRate === null ? '—' : `${s.onTimeRate}%`), tone: (s) => (s.onTimeRate === null ? '' : s.onTimeRate >= 90 ? 'text-emerald-600' : s.onTimeRate >= 70 ? 'text-amber-600' : 'text-red-600'), sortVal: (s) => s.onTimeRate ?? -1 },
  { key: 'avgDays', label: '평균 처리', hint: '등록부터 완료까지 평균 일수', fmt: (s) => (s.avgDays === null ? '—' : `${s.avgDays}일`), sortVal: (s) => s.avgDays ?? 999 },
  { key: 'done', label: '완료', hint: '기간 중 완료 건수', fmt: (s) => String(s.done), sortVal: (s) => s.done },
  { key: 'overdue', label: '지연', hint: '지금 마감이 지난 미완료 업무', fmt: (s) => String(s.overdue), tone: (s) => (s.overdue ? 'text-red-600' : ''), sortVal: (s) => s.overdue },
  { key: 'complaints', label: '미해결 민원', hint: '현장 QR 회원 민원 중 미완료', fmt: (s) => String(s.openComplaints), tone: (s) => (s.openComplaints ? 'text-violet-600' : ''), sortVal: (s) => s.openComplaints },
  { key: 'insp', label: '점검 수행률', hint: '기간 중 마감인 점검 업무 중 완료 비율', fmt: (s) => (s.inspectionRate === null ? '—' : `${s.inspectionRate}% (${s.inspection.done}/${s.inspection.total})`), tone: (s) => (s.inspectionRate === null ? '' : s.inspectionRate >= 90 ? 'text-emerald-600' : 'text-amber-600'), sortVal: (s) => s.inspectionRate ?? -1 },
];

function Spark({ points }: { points: { done: number; onTimeRate: number | null }[] }) {
  const max = Math.max(1, ...points.map((p) => p.done));
  return (
    <span className="inline-flex h-7 items-end gap-[3px]" aria-label={`주별 완료 ${points.map((p) => p.done).join(', ')}건`}>
      {points.map((p, i) => <span key={i} className={cx('w-2.5 rounded-t-[2px]', p.done ? 'bg-accent-500' : 'bg-slate-200')} style={{ height: p.done ? `${Math.max(15, (p.done / max) * 100)}%` : 3 }} title={`${p.done}건${p.onTimeRate !== null ? ` · 준수 ${p.onTimeRate}%` : ''}`} />)}
    </span>
  );
}

/** B-14 현장 비교 대시보드 */
export default function InsightsPage() {
  const { user, dir } = useSession();
  const [weeks, setWeeks] = useState(4);
  const [brand, setBrand] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'overdue', dir: -1 });
  const { data, error, loading, reload } = useApi<any>(`/api/insights/sites?weeks=${weeks}${brand ? `&brand=${brand}` : ''}`);
  const rows = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key)!;
    return [...(data?.sites ?? [])].sort((a, b) => (col.sortVal(a) - col.sortVal(b)) * sort.dir);
  }, [data, sort]);
  if (!canManage(user.role)) return <ErrorBox error={{ status: 403, message: '현장 비교는 현장 관리자 이상이 봅니다.' }} />;
  return (
    <div className="space-y-4">
      <PageHeader title="현장 비교" icon={BarChart3} sub={data ? `${fmtDate(data.from)} ~ ${fmtDate(data.to)} · 지점·위탁현장별` : '지점·위탁현장별 운영 지표'} actions={<>
        <div className="flex rounded-input border border-line bg-white p-0.5 text-sm shadow-card" role="group" aria-label="기간">
          {[4, 8, 12].map((w) => <button key={w} onClick={() => setWeeks(w)} aria-pressed={weeks === w} className={cx('rounded-md px-3 py-1.5 font-medium', weeks === w ? 'bg-brand-600 text-white' : 'text-ink-2 hover:bg-slate-100')}>{w}주</button>)}
        </div>
        <select className="h-9 rounded-input border border-line bg-white px-2 text-sm shadow-card" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="브랜드">
          <option value="">전체 브랜드</option>{dir.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </>} />
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Skeleton rows={5} /> : !rows.length ? (
        <p className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-2">비교할 현장이 없습니다</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-card border border-line bg-white shadow-card md:block">
            <table className="w-full text-sm" data-testid="site-compare">
              <thead className="bg-slate-50 text-left text-xs text-ink-2">
                <tr>
                  <th className="px-4 py-2.5 font-medium">현장</th>
                  {COLS.map((c) => (
                    <th key={c.key} className="px-3 py-2.5 text-right font-medium" title={c.hint}>
                      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))} aria-label={`${c.label} 순 정렬`}>
                        {c.label}<ArrowDownUp className={cx('size-3', sort.key === c.key ? 'text-accent-600' : 'text-ink-3')} />
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-2.5 font-medium">주별 완료</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/tasks?orgUnitId=${s.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        {s.brand_id && <span className="size-2 rounded-full" style={{ background: BRAND_TONE[s.brand_id]?.hex }} />}{s.name}
                      </Link>
                      <span className="text-xs text-ink-3">{UNIT_TYPE_LABEL[s.type as keyof typeof UNIT_TYPE_LABEL]} · 진행 {s.open}</span>
                    </td>
                    {COLS.map((c) => <td key={c.key} className={cx('px-3 py-3 text-right font-semibold tabular-nums', c.tone?.(s))}>{c.fmt(s)}</td>)}
                    <td className="px-4 py-3"><Spark points={s.trend} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {rows.map((s) => (
              <div key={s.id} className="rounded-card border border-line bg-white p-4 shadow-card">
                <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 font-semibold"><MapPin className="size-4 text-ink-3" />{s.name}</span><Spark points={s.trend} /></div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {COLS.map((c) => <div key={c.key}><dt className="text-[11px] text-ink-3">{c.label}</dt><dd className={cx('text-sm font-bold tabular-nums', c.tone?.(s))}>{c.fmt(s).split(' ')[0]}</dd></div>)}
                </dl>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-2">기한 준수율 90% 이상 초록, 70% 이상 주황, 그 아래 빨강. 머리글을 누르면 정렬합니다. 미해결 민원은 현장 QR 회원 민원으로 들어온 미완료 업무입니다.</p>
        </>
      )}
    </div>
  );
}
