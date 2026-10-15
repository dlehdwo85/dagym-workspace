import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { recordStep } from '@/lib/funnel';

/** V32 3 가입 화면 단계 기록(로그인 전) — 브라우저 임의 id 와 단계만, 개인정보 없음 */
export const POST = handler(async ({ req }) => {
  const i = await body(req, z.object({ anon: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/), step: z.enum(['account_view', 'company_view']) }));
  await recordStep(i.step, { anon: i.anon });
  return { ok: true };
}, { public: true });
