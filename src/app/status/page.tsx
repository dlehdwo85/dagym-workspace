'use client';
import { useEffect, useState } from 'react';

/** V12 3번 공개 서비스 상태 페이지 (로그인 없이) */
export default function StatusPage() {
  const [h, setH] = useState<any>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { fetch('/api/health').then((r) => r.json()).then(setH).catch(() => setErr(true)); }, []);
  const row = (label: string, ok: boolean | null, note?: string) => (
    <li className="flex items-center justify-between border-b border-slate-100 py-2.5 text-sm">
      <span>{label}</span><span className={ok === null ? 'text-slate-400' : ok ? 'text-green-700' : 'text-red-600'}>{ok === null ? '확인 중' : ok ? '정상' : '문제 있음'}{note ? ` · ${note}` : ''}</span>
    </li>
  );
  const ok = h?.ok && !err;
  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-bold">워크인 서비스 상태</h1>
      <p className={`mt-2 rounded-lg p-3 text-sm font-semibold ${h || err ? (ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700') : 'bg-slate-50 text-slate-500'}`} data-testid="status-summary">
        {!h && !err ? '확인 중…' : ok ? '모든 서비스가 정상입니다' : '일부 서비스에 문제가 있습니다 — 복구 중입니다'}
      </p>
      <ul className="mt-4">
        {row('웹·앱 서버', err ? false : h ? true : null)}
        {row('데이터베이스', h ? h.db === 'ok' : err ? false : null, h?.dbLatencyMs ? `${h.dbLatencyMs}ms` : undefined)}
        {row('알림·정기 실행', h ? !!h.scheduler?.healthy : null, h?.scheduler?.ageMinutes != null ? `${h.scheduler.ageMinutes}분 전` : undefined)}
        {row('파일 저장소', h ? h.config?.fileStorage === 's3' : null)}
      </ul>
      <p className="mt-4 text-xs text-slate-400">버전 {h?.commit ?? '-'} · <a className="underline" href="/help">도움말·문의</a></p>
    </main>
  );
}
