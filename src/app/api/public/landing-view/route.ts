import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { recordLandingView } from '@/lib/funnel';

/** 311차 #867 소개 페이지 방문 1번(로그인 전) — 페이지 이름만, 개인정보·브라우저 id 없음. 같은 브라우저는 하루 1번만 보냄 */
export const POST = handler(async ({ req }) => {
  const i = await body(req, z.object({ page: z.string().regex(/^[a-z0-9-]{1,40}$/) }));
  return { ok: await recordLandingView(i.page) };
}, { public: true });
