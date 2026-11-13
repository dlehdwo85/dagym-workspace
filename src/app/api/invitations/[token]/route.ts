import { handler } from '@/lib/api';
import { invitationInfo } from '@/lib/admin';
import { type Role } from '@/lib/types';
import { termsOf } from '@/lib/termsServer';

export const GET = handler<{ token: string }>(async ({ params }) => {
  const inv = await invitationInfo(params.token);
  return { email: inv.email, name: inv.name, role: inv.role, roleLabel: (await termsOf(inv.tenant)).role[inv.role as Role], /* 범용화 2단계: 초대한 회사의 역할 이름 */ invitedBy: inv.invited_by_name, expiresAt: inv.expires_at };
}, { public: true });
