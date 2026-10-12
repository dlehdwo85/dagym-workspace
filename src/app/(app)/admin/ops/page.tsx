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
        <ul className="space-y-1 text-xs">{data.jobs.map((j: any) => (
          <li key={j.id} className={cx(j.status === 'error' && 'text-red-700')}>{fmtDateTime(j.started_at)} · {j.job} ({j.trigger}) · {j.status}
            {j.detail?.due && ` · 마감알림 ${j.detail.due.created}`}{j.detail?.recurring && ` · 반복생성 ${j.detail.recurring.spawned}`}{j.detail?.push && ` · 푸시 ${j.detail.push.sent}/${j.detail.push.claimed}`}</li>
        ))}{!data.jobs.length && <li className="text-slate-400">아직 실행 기록이 없습니다 — 스케줄러 연결을 확인하세요</li>}</ul>
      </section>
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">푸시 발송 (최근 7일)</h2>
        <p className="text-sm">{data.deliveries.map((d: any) => `${({ sent: '성공', failed: '실패', pending: '대기', skipped: '건너뜀' } as any)[d.status]} ${d.c}`).join(' · ') || '기록 없음'}</p>
      </section>
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">Google 동기화 오류·충돌</h2>
        <ul className="space-y-1 text-xs">{data.syncErrors.map((s: any) => <li key={s.id}>{fmtDateTime(s.created_at)} · {s.name} · {s.action} · {s.status} {s.detail?.error ?? ''}</li>)}{!data.syncErrors.length && <li className="text-slate-400">없음</li>}</ul>
      </section>
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">오류 기록</h2>
        <ul className="space-y-1 text-xs">{data.errors.map((e: any) => <li key={e.id} className="text-red-700">{fmtDateTime(e.created_at)} · [{e.source}] {e.message}</li>)}{!data.errors.length && <li className="text-slate-400">없음</li>}</ul>
      </section>
    </div>
  );
}
