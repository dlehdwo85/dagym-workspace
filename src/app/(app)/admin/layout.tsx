import { currentUser } from '@/lib/auth';
import { menuLevels } from '@/lib/menuPerms';
import { ADMIN_MENU_KEYS } from '@/lib/adminPages';
import { AdminGate, NoAccess } from '@/components/AdminGate';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  // V14 7번 · V36 3: 관리 메뉴(ADMIN_PAGES) 중 하나라도 켜져 있으면 들어오고, 화면마다 자기 메뉴 권한을 다시 확인한다(API 도 각자 확인)
  const m = u ? await menuLevels(u) : {};
  if (!u || !ADMIN_MENU_KEYS.some((k) => (m[k] ?? 'none') !== 'none')) return <NoAccess />;
  return <AdminGate levels={m}>{children}</AdminGate>;
}
