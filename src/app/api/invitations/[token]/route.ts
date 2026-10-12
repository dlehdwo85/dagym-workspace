import { handler } from '@/lib/api';
import { invitationInfo } from '@/lib/admin';
import { ROLE_LABEL, type Role } from '@/lib/types';

export const GET = handler<{ token: string }>(async ({ params }) => {
  const inv = await invitationInfo(params.token);
  return { email: inv.email, name: inv.name, role: inv.role, roleLabel: ROLE_LABEL[inv.role as Role], invitedBy: inv.invited_by_name, expiresAt: inv.expires_at };
}, { public: true });
