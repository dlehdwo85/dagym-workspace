import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { assertSpace } from '@/lib/spaces';
import { isAdmin } from '@/lib/access';
import { forbidden } from '@/lib/errors';
import { tenantOf } from '@/lib/types';

export const maxDuration = 300;
const input = z.object({ ids: z.array(z.string().uuid()).max(10).optional() });
/** 188차 자동 제작 › 사진 AI 설명 [영상 장면 뽑기] — 관리자만. 운영(Vercel)은 ffmpeg 가 실린 합성 함수로 넘기고(via render-route), 그 밖은 그 자리에서 영상 6편까지
 *  ids = 그 영상만 다시 뽑기(실패·건너뜀 표시를 지우고) */
export const POST = handler(async ({ req, user }) => {
  await assertSpace(user, 'marketing');
  if (!isAdmin(user)) throw forbidden('영상 장면 뽑기는 관리자만 할 수 있습니다');
  const i = await body(req, input);
  const S = await import('@/lib/mktScenes');
  if (i.ids?.length) {
    const { db } = await import('@/lib/db');
    await db()`update library_files set meta = meta - 'scenes' where id = any(${i.ids}::uuid[]) and tenant = ${tenantOf(user)} and mime_type like 'video/%' and not (coalesce(meta->'scenes', '{}'::jsonb) ? 'frames')`;
  }
  // 운영은 이 함수에 ffmpeg 가 없어 합성 함수가 '아직' 영상을 이어서 뽑음(ids 는 위에서 '아직'으로 되돌림)
  return i.ids?.length && !process.env.VERCEL ? S.sceneBatch(tenantOf(user), { ids: i.ids, limit: 10, budgetMs: 200e3 }) : S.kickScenes(tenantOf(user), { limit: 6, budgetMs: 200e3 });
});
