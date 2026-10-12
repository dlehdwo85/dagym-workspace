import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { currentUser } from '@/lib/auth';
import { directory } from '@/lib/admin';
import { AppShell } from '@/components/AppShell';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const dir = await directory(user);
  const session = {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    dir: JSON.parse(JSON.stringify(dir)),
  };
  return <AppShell session={session}><Suspense>{children}</Suspense></AppShell>;
}
