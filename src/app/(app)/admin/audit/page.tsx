'use client';
import { useApi } from '@/components/client';
import { ErrorBox, Loading, fmtDateTime } from '@/components/ui';

const A: Record<string, string> = { 'auth.login': '로그인', 'auth.login_failed': '로그인 실패', 'auth.login_blocked': '중지 계정 로그인 시도', 'user.invite': '직원 초대',
  'user.accept_invite': '초대 수락', 'user.update': '사용자 변경', 'user.password_reset_link': '비밀번호 재설정 링크 발급', 'user.password_reset': '비밀번호 재설정',
  'user.invite_revoke': '초대 취소', 'org.create': '조직 추가', 'org.update': '조직 변경', 'setup.owner_created': '대표 계정 생성' };

export default function Audit() {
  const { data, error, loading, reload } = useApi<{ logs: any[] }>('/api/admin/audit');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">감사 기록</h1>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-xs" data-testid="audit">
          <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-2">시각</th><th className="p-2">사용자</th><th className="p-2">작업</th><th className="p-2">내용</th><th className="p-2">IP</th></tr></thead>
          <tbody className="divide-y">{data!.logs.map((l) => (
            <tr key={l.id}><td className="whitespace-nowrap p-2">{fmtDateTime(l.created_at)}</td><td className="p-2">{l.actor_name ?? '-'}</td><td className="p-2">{A[l.action] ?? l.action}</td>
              <td className="max-w-md truncate p-2 font-mono text-[11px] text-slate-500" title={JSON.stringify(l.detail)}>{JSON.stringify(l.detail)}</td><td className="p-2">{l.ip ?? ''}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
