import { currentUser } from '@/lib/auth';
import { menuLevels } from '@/lib/menuPerms';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  // V14 7번: 관리 메뉴 중 하나라도 켜져 있으면 들어올 수 있고, 각 화면·API 가 자기 메뉴 권한을 다시 확인한다
  const m = u ? await menuLevels(u) : {};
  const any = ['admin_users', 'ops', 'usage', 'ai_logs', 'team_reports', 'revenue'].some((k) => (m[k] ?? 'none') !== 'none');
  if (!u || !any) {
    return <div className="rounded-lg border bg-white p-6 text-sm"><p className="font-semibold">접근 권한이 없습니다</p><p className="mt-1 text-slate-500">대표가 사용자 관리 → 메뉴 권한에서 켜 준 관리 메뉴만 볼 수 있습니다.</p></div>;
  }
  return <>{children}</>;
}
