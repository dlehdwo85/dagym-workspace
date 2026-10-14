import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { currentUser } from '@/lib/auth';
import { directory } from '@/lib/admin';
import { AppShell } from '@/components/AppShell';
import { googleSyncEnabled } from '@/lib/google/client';
import { aiEnabled } from '@/lib/ai/provider';
import { menuLevels } from '@/lib/menuPerms';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const dir = await directory(user);
  const menus = await menuLevels(user); // V13 메뉴 권한
  const session = {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, platformAdmin: !!user.platformAdmin },
    dir: JSON.parse(JSON.stringify(dir)),
    features: { googleSync: googleSyncEnabled(), ai: aiEnabled() && !user.isDemo && menus.assistant === 'use', library: !user.isDemo && menus.library !== 'none' },
    menus,
  };
  return <AppShell session={session}><Suspense>{children}</Suspense></AppShell>;
}
