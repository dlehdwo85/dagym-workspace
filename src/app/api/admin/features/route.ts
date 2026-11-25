import { handler, body, clientIp } from '@/lib/api';
import { forbidden } from '@/lib/errors';
import { isAdmin } from '@/lib/access';
import { tenantOf } from '@/lib/types';
import { featureInput, featureList, setFeature } from '@/lib/features';

/** #1181 상업화 마감 4번: 회사 설정 › 쓰는 기능(대표·관리자) — 고객이 끌 수 있는 기능만 · PUT {key, on} */
export const GET = handler(async ({ user }) => { if (!isAdmin(user)) throw forbidden('대표·관리자만 볼 수 있습니다'); return { features: await featureList(tenantOf(user), { customerOnly: true }) }; });
export const PUT = handler(async ({ req, user }) => setFeature(user, tenantOf(user), await body(req, featureInput), clientIp(req), { platform: false }));
