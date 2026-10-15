import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { setSupportConsent, supportConsent } from '@/lib/platformAdmin';

/** V28-3 고객사 대표: 워크인 지원 모드(읽기 전용 대리 접속) 허용 켜고 끄기 */
export const GET = handler(async ({ user }) => supportConsent(user));
export const PUT = handler(async ({ req, user }) => setSupportConsent(user, (await body(req, z.object({ on: z.boolean() }))).on, clientIp(req)));
