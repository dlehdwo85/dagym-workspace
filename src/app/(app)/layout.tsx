import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { Suspense } from 'react';
import { currentUser } from '@/lib/auth';
import { directory } from '@/lib/admin';
import { AppShell } from '@/components/AppShell';
import { googleSyncEnabled } from '@/lib/google/client';
import { aiEnabled } from '@/lib/ai/provider';
import { menuLevels } from '@/lib/menuPerms';
import { db } from '@/lib/db';
import { tenantOf } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  // V41 공간: 들어갈 수 없는 공간 주소는 화면을 그리기 전에 404
  const spaces = await (await import('@/lib/spaces')).userSpaces(user);
  const sp = /^\/s\/([^/]+)/.exec((await headers()).get('x-wos-path') ?? '')?.[1];
  if (sp && (sp === 'work' || !(spaces as string[]).includes(sp))) notFound();
  const dir = await directory(user);
  const menus = await menuLevels(user); // V13 메뉴 권한
  const [t] = await db()<{ name: string; kind: string; owner_user_id: string | null; onboarded_at: Date | null }[]>`select name, kind, owner_user_id, onboarded_at from tenants where id = ${tenantOf(user)}`;
  const trial = ['default', 'demo'].includes(tenantOf(user)) ? null : await (await import('@/lib/plans')).trialInfo(tenantOf(user)).catch(() => null);
  const billingLock = user.support ? null : await (await import('@/lib/plans')).billingLock(tenantOf(user)).catch(() => null); // V28 B2 미납
  const session = {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, platformAdmin: !!user.platformAdmin },
    support: user.support ?? null, // V28-3 지원 모드 빨간 띠
    dir: JSON.parse(JSON.stringify(dir)),
    features: { googleSync: googleSyncEnabled(), ai: aiEnabled() && !user.isDemo && menus.assistant === 'use', library: !user.isDemo && menus.library !== 'none' },
    menus,
    spaces, // V41 공간
    // V15 공간(회사) 이름 · 개인 공간 · 첫 로그인 안내(가입한 공간 대표만)
    tenant: { name: t?.name ?? '워크인', personal: t?.kind === 'personal', internal: ['default', 'demo'].includes(tenantOf(user)), inquiries: tenantOf(user) === 'default' && !user.isDemo, onboarding: !!t && t.owner_user_id === user.id && !t.onboarded_at && !['default', 'demo'].includes(tenantOf(user)),
      trial: trial ? { trial: trial.trial, readOnly: trial.readOnly, daysLeft: trial.daysLeft } : null, billingLock: billingLock as 'read_only' | 'suspended' | null },
  };
  return <AppShell session={session}><Suspense>{children}</Suspense></AppShell>;
}
