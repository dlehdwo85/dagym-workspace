'use client';
import { useApi } from '@/components/client';
import { ErrorBox, Skeleton, cx, fmtDateTime } from '@/components/ui';

type DayRow = { day: string; p75: number | null; max: number | null; n: number; bad: number } | null;
type Target = { key: string; label: string; path: string; threshold: number; last: { at: string; ms: number; status: number; ok: boolean } | null; week: { n: number; p75: number; max: number; bad: number } | null; byDay: DayRow[] };
type Metric = { p75: number | null; max: number; n: number; today: number | null } | null;
type Screen = { client: 'web' | 'app'; screen: string; n: number; threshold: number; first: Metric; list: Metric };
type Data = { days: string[]; thresholds: { api: number; screen: number }; targets: Target[]; screens: Screen[]; slowTop: { kind: 'api' | 'screen'; label: string; p75: number; threshold: number; ratio: number; n: number }[]; alerts: { title: string; at: string }[]; probe: { lastAt: string | null; everyMinutes: number; on: boolean } };

const sec = (ms: number | null | undefined) => (ms === null || ms === undefined ? '–' : ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}초` : `${ms}ms`);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const over = (v: number | null | undefined, th: number) => typeof v === 'number' && v > th;

/** 7일 막대 — 하루 p75, 기준선 점선, 넘은 날은 빨강. 한 축·얇은 막대·값 직접 표시 */
function Bars({ rows, days, threshold }: { rows: DayRow[]; days: string[]; threshold: number }) {
  const W = 20, H = 44, top = 10; const w = days.length * W;
  const maxV = Math.max(threshold * 1.3, ...rows.map((r) => r?.p75 ?? 0));
  const y = (v: number) => top + (H - top) * (1 - Math.min(v, maxV) / maxV);
  return (
    <svg width={w} height={H + 14} viewBox={`0 0 ${w} ${H + 14}`} role="img" aria-label="최근 7일 p75" className="shrink-0">
      <line x1={0} x2={w} y1={y(threshold)} y2={y(threshold)} className="stroke-ink-3" strokeDasharray="2 2" strokeWidth={1} />
      {rows.map((r, i) => {
        const v = r?.p75 ?? null; const bh = v === null ? 0 : H - y(v);
        return (
          <g key={days[i]}>
            {v !== null && <rect x={i * W + 5} y={y(v)} width={W - 10} height={Math.max(1, bh)} rx={2} className={over(v, threshold) ? 'fill-red-500' : 'fill-brand-500'} />}
            {v !== null && <text x={i * W + W / 2} y={y(v) - 2} textAnchor="middle" className="fill-ink-2" fontSize={7}>{v >= 1000 ? (v / 1000).toFixed(1) : v}</text>}
            <text x={i * W + W / 2} y={H + 11} textAnchor="middle" className="fill-ink-3" fontSize={7}>{md(days[i])}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** #948 플랫폼 운영 › 속도: 핵심 API 30분 검침(7일)·실제 화면(웹·앱) p75·느린 곳 상위 5·최근 알림 */
export function PlatformSpeed() {
  const { data, error, loading, reload } = useApi<Data>('/api/platform/perf');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Skeleton rows={6} />;
  if (!data) return null;
  const { api, screen } = data.thresholds;
  const cell = 'px-2 py-1.5';
  return (
    <section className="rounded-card border border-line bg-white shadow-card" data-testid="platform-speed">
      <div className="border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold">속도 <span className="ml-1 text-xs font-normal text-ink-3">핵심 API 는 {data.probe.everyMinutes}분마다 서버가 직접 검침 · 실제 화면은 사용자가 연 화면의 표시 시간(웹·앱) · 최근 {data.days.length}일</span></h2>
        <p className="mt-0.5 text-[11px] text-ink-3">기준: API {api / 1000}초 · 화면 {screen / 1000}초. API 는 2번 연속, 화면은 이틀 연속 p75 가 넘으면 플랫폼 운영자에게 알림(하루 1번). p75 = 4번 중 3번은 이 시간 안.
          {' '}마지막 검침 {data.probe.lastAt ? fmtDateTime(data.probe.lastAt) : '아직 없음'}{!data.probe.on && <span className="ml-1 text-amber-700">· 검침 꺼짐(PERF_PROBE=off 또는 APP_URL 없음)</span>}</p>
      </div>
      <div className="grid gap-3 p-3 md:grid-cols-2">
        <div data-testid="speed-top">
          <h3 className="text-xs font-semibold">느린 곳 상위 5 <span className="font-normal text-ink-3">(기준 대비)</span></h3>
          {data.slowTop.length === 0 ? <p className="mt-1 text-xs text-ink-3">아직 기록이 없습니다.</p> : (
            <ol className="mt-1 space-y-1 text-sm">
              {data.slowTop.map((s, i) => (
                <li key={s.label} className="flex items-center gap-2" data-testid="speed-top-row">
                  <span className="w-4 text-right text-xs text-ink-3">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{s.kind === 'api' ? 'API' : '화면'} · {s.label}</span>
                  <span className={cx('tabular-nums', s.ratio > 1 ? 'font-semibold text-red-700' : 'text-ink-2')}>{sec(s.p75)}</span>
                  <span className="text-[11px] text-ink-3">{s.ratio > 1 ? `기준의 ${s.ratio.toFixed(1)}배` : '기준 안'} · {s.n}번</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div data-testid="speed-alerts">
          <h3 className="text-xs font-semibold">최근 알림 {data.alerts.length}건</h3>
          {data.alerts.length === 0 ? <p className="mt-1 text-xs text-ink-3">기준을 넘은 곳이 없었습니다.</p> : (
            <ul className="mt-1 space-y-1 text-xs">{data.alerts.map((a) => <li key={a.title} className="flex gap-2"><span className="shrink-0 text-ink-3">{fmtDateTime(a.at)}</span><span className="min-w-0 break-words">{a.title}</span></li>)}</ul>
          )}
        </div>
      </div>
      <div className="overflow-x-auto border-t border-line" data-testid="speed-targets">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="text-left text-xs text-ink-3"><th className={cell}>핵심 API</th><th className={cx(cell, 'text-right')}>7일 p75</th><th className={cx(cell, 'text-right')}>최대</th><th className={cx(cell, 'text-right')}>검침·오류</th><th className={cell}>마지막</th><th className={cell}>날짜별 p75</th></tr></thead>
          <tbody>
            {data.targets.map((t) => (
              <tr key={t.key} className="border-t border-line" data-testid={`speed-target-${t.key}`}>
                <td className={cell}><div>{t.label}</div><div className="text-[11px] text-ink-3">{t.path}</div></td>
                <td className={cx(cell, 'text-right tabular-nums', over(t.week?.p75, api) && 'font-semibold text-red-700')}>{sec(t.week?.p75)}</td>
                <td className={cx(cell, 'text-right tabular-nums')}>{sec(t.week?.max)}</td>
                <td className={cx(cell, 'text-right tabular-nums')}>{t.week?.n ?? 0}번{t.week?.bad ? <span className="ml-1 text-red-700">· 오류 {t.week.bad}</span> : null}</td>
                <td className={cx(cell, 'text-xs')}>{t.last ? <><span className={cx('tabular-nums', (!t.last.ok || t.last.ms > api) && 'font-semibold text-red-700')}>{t.last.ok ? sec(t.last.ms) : `오류 ${t.last.status || '응답 없음'}`}</span><span className="ml-1 text-ink-3">{fmtDateTime(t.last.at)}</span></> : <span className="text-ink-3">–</span>}</td>
                <td className={cell}><Bars rows={t.byDay} days={data.days} threshold={api} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto border-t border-line" data-testid="speed-screens">
        <h3 className="px-3 pt-2 text-xs font-semibold">실제 화면(웹·앱) <span className="font-normal text-ink-3">최근 {data.days.length}일 · 첫 표시 = 화면 틀이 보인 때 · 목록 표시 = 자료까지 보인 때 · 기준 {screen / 1000}초</span></h3>
        {data.screens.length === 0 ? <p className="px-3 pb-3 pt-1 text-xs text-ink-3">아직 기록이 없습니다. 직원이 화면을 열면 쌓입니다.</p> : (
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs text-ink-3"><th className={cell}>화면</th><th className={cell}>어디서</th><th className={cx(cell, 'text-right')}>첫 표시 p75</th><th className={cx(cell, 'text-right')}>오늘</th><th className={cx(cell, 'text-right')}>목록 표시 p75</th><th className={cx(cell, 'text-right')}>오늘</th><th className={cx(cell, 'text-right')}>최대</th><th className={cx(cell, 'text-right')}>횟수</th></tr></thead>
            <tbody>
              {data.screens.map((s) => (
                <tr key={`${s.client}|${s.screen}`} className="border-t border-line" data-testid="speed-screen-row">
                  <td className={cx(cell, 'font-mono text-xs')}>{s.screen}</td>
                  <td className={cell}><span className={cx('rounded-full border px-1.5 py-0.5 text-[11px]', s.client === 'app' ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-line text-ink-2')}>{s.client === 'app' ? '앱' : '웹'}</span></td>
                  <td className={cx(cell, 'text-right tabular-nums', over(s.first?.p75, screen) && 'font-semibold text-red-700')}>{sec(s.first?.p75)}</td>
                  <td className={cx(cell, 'text-right tabular-nums text-ink-2')}>{sec(s.first?.today)}</td>
                  <td className={cx(cell, 'text-right tabular-nums', over(s.list?.p75, screen) && 'font-semibold text-red-700')}>{sec(s.list?.p75)}</td>
                  <td className={cx(cell, 'text-right tabular-nums text-ink-2')}>{sec(s.list?.today)}</td>
                  <td className={cx(cell, 'text-right tabular-nums')}>{sec(Math.max(s.first?.max ?? 0, s.list?.max ?? 0) || null)}</td>
                  <td className={cx(cell, 'text-right tabular-nums')}>{s.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
