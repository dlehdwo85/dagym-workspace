import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { createJoinLink, disableJoinLink, domainInput, joinAdminView, linkInput, setJoinDomain } from '@/lib/joinLinks';

/** #1176 회사 초대 링크·합류 신청·회사 메일 도메인(대표·관리자) — GET 지금 상태 · POST {action: link|disable|domain} */
export const GET = handler(async ({ user }) => joinAdminView(user));
export const POST = handler(async ({ req, user }) => {
  const raw = await req.json().catch(() => ({}));
  const action = z.enum(['link', 'disable', 'domain']).parse(raw?.action);
  if (action === 'link') return createJoinLink(user, linkInput.parse(raw), clientIp(req));
  if (action === 'disable') return disableJoinLink(user, clientIp(req));
  return setJoinDomain(user, domainInput.parse(raw), clientIp(req));
});
