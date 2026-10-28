'use client';
import { useApi } from '@/components/client';
import { ErrorBox, Loading, cx, fmtDateTime } from '@/components/ui';

export default function Ops() {
  const { data, error, loading, reload } = useApi<any>('/api/admin/ops');
  const health = useApi<any>('/api/health');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  const h = health.data;
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">운영 상태</h1>
      <nav className="flex flex-wrap gap-1.5 text-sm" aria-label="운영 관리">
        {[['/admin/audit', '감사 기록'], ['/admin/org', '조직 구성'], ['/admin/holidays', '공휴일'], ['/admin/approvals', '결재선']].map(([h, l]) => (
          <a key={h} href={h} className="rounded-full border border-line bg-white px-3 py-1 font-medium text-ink-2 hover:border-slate-300 hover:text-ink">{l}</a>
        ))}
      </nav>
      {h && (
        <div className="grid gap-2 sm:grid-cols-5">
          {[['DB', h.db === 'ok' ? `정상 (${h.dbLatencyMs}ms)` : '오류', h.db === 'ok'], ['스케줄러', h.scheduler.lastTick ? `${h.scheduler.ageMinutes}분 전 실행` : '실행 기록 없음', h.scheduler.healthy],
            ['파일 저장소', h.config.fileStorage === 's3' ? 'S3 호환 저장소' : '로컬 디스크(운영 불가)', h.config.fileStorage === 's3'],
            ['푸시', `웹 ${h.config.webPush ? '설정됨' : '미설정'} · 앱 ${h.config.appPush ? '설정됨' : '미설정'}`, h.config.webPush && h.config.appPush],
            ['Google 동기화(선택)', h.config.googleCalendar ? '켜짐' : '꺼짐 — 핵심 기능과 무관', true]].map(([l, v, ok]) => (
            <div key={l as string} className={cx('rounded-lg border p-3', ok ? 'bg-white' : 'border-amber-300 bg-amber-50')}><div className="text-xs text-slate-500">{l}</div><div className="text-sm font-medium">{v}</div></div>
          ))}
        </div>
      )}
      <div className="grid gap-2 text-sm sm:grid-cols-5">
        {Object.entries({ 사용자: data.counts.users, 업무: data.counts.tasks, 일정: data.counts.events, 파일: data.counts.files, '파일 용량(MB)': (Number(data.counts.file_bytes) / 1024 / 1024).toFixed(1) }).map(([k, v]) => (
          <div key={k} className="rounded-lg border bg-white p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-lg font-semibold">{v as any}</div></div>
        ))}
      </div>
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">정기 작업 실행 기록</h2>
        {(() => {
          const last = data.jobs.find((j: any) => j.job === 'tick' && j.status === 'ok');
          const age = last ? Math.round((Date.now() - new Date(last.started_at).getTime()) / 60000) : null;
          return (
            <p className={cx('mb-2 rounded p-2 text-sm', age !== null && age <= 30 ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900')} data-testid="last-tick">
              마지막 정기 실행 {age === null ? '기록 없음' : `${age}분 전`}{last && ` · 원인: ${TRIGGER_LABEL[last.trigger] ?? last.trigger}`}
              <span className="block text-xs opacity-80">원인 — GitHub 예약(10분, 자주 건너뜀) · Vercel Cron(매일 09시, CRON_SECRET 필요) · 사용 중 요청 편승(앱을 쓰는 동안 10분마다)</span>
            </p>
          );
        })()}
        <ul className="space-y-1 text-xs">{data.jobs.map((j: any) => (
          <li key={j.id} className={cx(j.status === 'error' && 'text-red-700')}>{fmtDateTime(j.started_at)} · {j.job} ({TRIGGER_LABEL[j.trigger] ?? j.trigger}) · {j.status}
            {j.detail?.due && ` · 마감알림 ${j.detail.due.created}`}{j.detail?.recurring && ` · 반복생성 ${j.detail.recurring.spawned}`}{j.detail?.push && ` · 푸시 ${j.detail.push.sent}/${j.detail.push.claimed}`}</li>
        ))}{!data.jobs.length && <li className="text-slate-400">아직 실행 기록이 없습니다 — 스케줄러 연결을 확인하세요</li>}</ul>
      </section>
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">푸시 발송 (최근 7일)</h2>
        <p className="text-sm">{data.deliveries.map((d: any) => `${({ sent: '성공', failed: '실패', pending: '대기', skipped: '건너뜀' } as any)[d.status]} ${d.c}`).join(' · ') || '기록 없음'}</p>
        {data.noDevice?.length > 0 && (
          <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900" data-testid="no-device">
            휴대폰 알림을 받을 기기가 없는 사람: <b>{data.noDevice.map((u: any) => u.name).join(', ')}</b> — 앱에서 설정 → &ldquo;앱 알림 켜기&rdquo;를 눌러야 푸시가 갑니다(앱 안 알림 목록에는 그대로 쌓임).
          </p>
        )}
      </section>
      <section className="rounded-lg border bg-white p-4" data-testid="recent-notifications">
        <h2 className="mb-1 text-sm font-semibold">최근 알림 발송 기록 (50건)</h2>
        <p className="mb-2 text-xs text-ink-3">본인이 한 일(내가 나에게 배정 등)은 알림을 만들지 않습니다 — 본인 업무는 마감 알림(09시·마감 1시간 전)만 갑니다.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead><tr className="text-left text-ink-2"><th className="py-1 pr-2">시각</th><th className="pr-2">받는 사람</th><th className="pr-2">알림</th><th className="pr-2">기기</th><th>휴대폰 발송</th></tr></thead>
            <tbody>
              {data.recent?.map((n: any) => {
                const ds = n.deliveries as any[];
                const st = !n.devices && !ds.length ? '기기 없음' : !ds.length ? '대기(발송 전)' : ds.map((d) => `${d.channel === 'fcm' ? '앱' : '웹'} ${({ sent: '성공', failed: '실패', pending: '대기', skipped: '건너뜀' } as any)[d.status] ?? d.status}${d.error ? ` (${String(d.error).slice(0, 60)})` : ''}`).join(', ');
                return (
                  <tr key={n.id} className="border-t border-line align-top">
                    <td className="whitespace-nowrap py-1 pr-2 tabular-nums">{fmtDateTime(n.created_at)}</td>
                    <td className="whitespace-nowrap pr-2">{n.user_name}</td>
                    <td className="pr-2">{n.title}</td>
                    <td className="pr-2 tabular-nums">{n.devices}</td>
                    <td className={cx(ds.some((d) => d.status === 'failed') ? 'text-red-700' : !n.devices ? 'text-amber-700' : ds.every((d) => d.status === 'sent') && ds.length ? 'text-green-700' : '')}>{st}</td>
                  </tr>
                );
              })}
              {!data.recent?.length && <tr><td colSpan={5} className="py-2 text-ink-3">기록 없음</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">Google 동기화 오류·충돌</h2>
        <ul className="space-y-1 text-xs">{data.syncErrors.map((s: any) => <li key={s.id}>{fmtDateTime(s.created_at)} · {s.name} · {s.action} · {s.status} {s.detail?.error ?? ''}</li>)}{!data.syncErrors.length && <li className="text-slate-400">없음</li>}</ul>
      </section>
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">휴대폰 사진 고르기 진단 (최근 20건)</h2>
        <ul className="space-y-1 text-xs" data-testid="ops-pick-diag">{(data.pickDiag ?? []).map((e: any) => { const c = e.context ?? {}; const k = c.kinds ?? {};
          return <li key={e.id}>{fmtDateTime(e.created_at)} · {e.name ?? '?'} · {c.where === 'chat' ? '메신저' : '업무'} · {e.message}{c.kinds ? ` · HEIC ${k.heic ?? 0}·JPEG ${k.jpeg ?? 0}·PNG ${k.png ?? 0}·영상 ${k.video ?? 0}` : ''}{c.bytes ? ` · ${(c.bytes / 1048576).toFixed(1)}MB` : ''}{c.firstError ? ` · 첫 오류 ${c.firstError}` : ''} · {c.app ? '앱' : '웹'} · {String(c.ua ?? '').match(/(iPhone OS|Android) [\d_.]+/)?.[0]?.replace(/_/g, '.') ?? ''}</li>; })}
          {!(data.pickDiag ?? []).length && <li className="text-slate-400">없음</li>}</ul>
      </section>
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">오류 기록</h2>
        <ul className="space-y-1 text-xs">{data.errors.map((e: any) => <li key={e.id} className="text-red-700">{fmtDateTime(e.created_at)} · [{e.source}] {e.message}</li>)}{!data.errors.length && <li className="text-slate-400">없음</li>}</ul>
      </section>
    </div>
  );
}

const TRIGGER_LABEL: Record<string, string> = { scheduler: 'GitHub 예약', 'github-oidc': 'GitHub 예약', secret: 'Vercel Cron', piggyback: '사용 중 요청 편승', manual: '수동' };
