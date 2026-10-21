'use client';
import { useSession } from '@/components/session';
import { cx } from '@/components/ui';
import { ROLE_LABEL, type Role } from '@/lib/types';
import { GUEST_BADGE, ROLE_BADGE_EN } from '@/lib/roleBadgeConst';

const COLOR: Record<string, string> = { owner: 'bg-amber-100 text-amber-800', admin: 'bg-violet-100 text-violet-800', dept_lead: 'bg-sky-100 text-sky-800', site_manager: 'bg-emerald-100 text-emerald-800', staff: 'bg-slate-100 text-slate-700', guest: 'bg-slate-100 text-slate-500' };

/** 대표 10/20 15:05 (#101) 이름 옆 권한 배지 — 회사 설정(영어 CEO·Admin·Lead·Ops·Member·Guest / 한글 / 끄기)을 따른다. 심사용·체험 계정은 Guest */
export function RoleBadge({ role, guest, className, size = 'xs' }: { role: Role | string | null | undefined; guest?: boolean | null; className?: string; size?: 'xs' | 'sm' }) {
  const { tenant } = useSession();
  const mode = tenant?.roleBadge ?? 'en';
  if (mode === 'off' || !role) return null;
  const r = role as Role;
  const text = guest ? (mode === 'en' ? GUEST_BADGE : '게스트') : mode === 'en' ? ROLE_BADGE_EN[r] : ROLE_LABEL[r];
  if (!text) return null;
  return <span className={cx('inline-flex shrink-0 items-center rounded-full px-1.5 font-medium leading-4', size === 'xs' ? 'text-[10px]' : 'text-[11px]', COLOR[guest ? 'guest' : r] ?? COLOR.staff, className)} data-testid="role-badge" data-role={guest ? 'guest' : r}>{text}</span>;
}
/** 서버·메일 등 React 밖에서 쓸 글자 */
export const roleBadgeText = (role: Role | string | null | undefined, mode: 'en' | 'ko' | 'off', guest?: boolean | null) => {
  if (mode === 'off' || !role) return '';
  if (guest) return mode === 'en' ? GUEST_BADGE : '게스트';
  return mode === 'en' ? ROLE_BADGE_EN[role as Role] ?? '' : ROLE_LABEL[role as Role] ?? '';
};
