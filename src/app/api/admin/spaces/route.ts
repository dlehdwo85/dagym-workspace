import { handler, body, clientIp } from '@/lib/api';
import { setTenantSpace, spaceSettings, spaceToggleInput } from '@/lib/spaces';

/** V41 공간: 관리자 — 회사 공간 켜기/끄기(가격 결정 전, 결제 연동 없음) */
export const GET = handler(async ({ user }) => spaceSettings(user));
export const PUT = handler(async ({ req, user }) => setTenantSpace(user, await body(req, spaceToggleInput), clientIp(req)));
