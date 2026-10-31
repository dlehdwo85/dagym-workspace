'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { adminPageFor } from '@/lib/adminPages';
import { BackBar } from './BackBar';
import { useInApp } from './inApp';

/** V36 3: 관리 화면마다 자기 메뉴 권한 확인 — 없으면 무엇이 필요한지·누구에게 요청할지 안내(서버 API 도 따로 403/404) */
export function AdminGate({ levels, children }: { levels: Record<string, string>; children: React.ReactNode }) {
  const page = adminPageFor(usePathname() ?? '');
  const inApp = useInApp(); // 스토어 심사(#839): 앱 안 경로 이름에 '요금제' 없음
  if (page && (levels[page.menu] ?? 'none') === 'none') return <NoAccess what={page.label} />;
  // #429 관리 하위 화면 '← 이전 화면'·경로(관리 › 사용자 관리) — 결재 설정처럼 탭이 있는 화면은 화면이 직접 그린다
  return <>{page && !page.selfBack && <BackBar fallback={page.parent?.href ?? '/'} crumbs={[page.parent ?? { label: '관리' }, { label: inApp && page.href === '/admin/usage' ? '사용량' : page.label }]} />}{children}</>;
}
export function NoAccess({ what }: { what?: string }) {
  return (
    <div className="mx-auto mt-6 max-w-lg rounded-card border border-line bg-white p-6 text-sm shadow-card" data-testid="admin-no-access">
      <p className="flex items-center gap-2 text-base font-semibold"><ShieldAlert className="size-5 text-amber-600" />{what ? `"${what}" 화면 권한이 없습니다` : '관리 화면 권한이 없습니다'}</p>
      <p className="mt-2 text-ink-2">관리 메뉴는 회사 관리자 화면입니다. 필요하면 대표에게 <b>사용자 관리 → 메뉴 권한</b>에서 이 메뉴를 켜 달라고 요청하세요.</p>
      <Link href="/" className="mt-4 inline-block rounded-input bg-brand-600 px-4 py-2 font-medium text-white">홈으로</Link>
    </div>
  );
}
