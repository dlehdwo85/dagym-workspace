import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { collectorsView, setCollectorEnabled } from '@/lib/sales/collectors';

/** 대표 10/21 08:45: 영업 수집기 12개 — 목록·상태·마지막 실행·회사별 켜기 */
export const GET = handler(async ({ user }) => collectorsView(user));
const input = z.object({ slug: z.string().min(1).max(60), enabled: z.boolean(), scope: z.enum(['tenant', 'global']).optional() });
export const PUT = handler(async ({ req, user }) => { const b = await body(req, input); return setCollectorEnabled(user, b.slug, b.enabled, b.scope ?? 'tenant'); });
