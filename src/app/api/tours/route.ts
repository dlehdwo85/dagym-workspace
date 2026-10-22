import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { TOUR_IDS, markTourSeen, resetTours, seenTours, toursAuto } from '@/lib/tours';

/** #77 처음 사용 안내: GET = 본 투어·자동 여부, POST {tourId} = 봤음(끝까지·건너뛰기), DELETE = 다시 보기(초기화) */
export const GET = handler(async ({ user }) => ({ seen: await seenTours(user.id), auto: toursAuto(user) }));
export const POST = handler(async ({ req, user }) => {
  const { tourId } = await body(req, z.object({ tourId: z.enum(TOUR_IDS) }));
  if (!user.support) await markTourSeen(user.id, tourId); // 지원 모드(대신 보기)는 그 사람 기록을 바꾸지 않음
  return { ok: true };
});
export const DELETE = handler(async ({ user }) => { if (!user.support) await resetTours(user.id); return { ok: true }; });
