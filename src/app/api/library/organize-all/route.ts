import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { applyOrganizePreviews, organizeAll } from '@/lib/library';

export const maxDuration = 300;
/** V14 3번 관리자 "전체 정리" (10개씩, 화면이 남은 수만큼 반복). V14 18번: preview → 고른 것만 apply */
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ preview: z.boolean().optional(), apply: z.array(z.string().uuid()).max(500).optional() }));
  if (i.apply) return applyOrganizePreviews(user, i.apply);
  return organizeAll(user, { preview: i.preview });
});
