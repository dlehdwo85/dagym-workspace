import { currentUser } from '@/lib/auth';
import { menuLevels } from '@/lib/menuPerms';
import { AdminGate, NoAccess } from '@/components/AdminGate';

/** 계약 관리 — 메뉴 권한 '계약 관리'가 없는 사람에게는 화면도 없다(금액·계약서가 보이는 화면. API 도 따로 404) */
export default async function AgreementsLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  const m = u ? await menuLevels(u) : {};
  if (!u || (m.agreements ?? 'none') === 'none') return <NoAccess what="계약 관리" />;
  return <AdminGate levels={m}>{children}</AdminGate>;
}
