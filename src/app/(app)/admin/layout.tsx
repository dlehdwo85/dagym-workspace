import { currentUser } from '@/lib/auth';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  if (!u || (u.role !== 'owner' && u.role !== 'admin')) {
    return <div className="rounded-lg border bg-white p-6 text-sm"><p className="font-semibold">접근 권한이 없습니다</p><p className="mt-1 text-slate-500">관리자 메뉴는 대표와 본사 관리자만 사용할 수 있습니다.</p></div>;
  }
  return <>{children}</>;
}
