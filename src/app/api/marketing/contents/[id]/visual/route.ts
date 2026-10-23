import { handler } from '@/lib/api';
import { makeVisualNow } from '@/lib/mktAutoVisual';

export const maxDuration = 60;
/** #516 [지금 만들기]: 시안 없는 피드·스토리에 서버가 시안을 그려 붙이고 재승인 대기(크레딧 0) · { redraw: true } = [다시 그리기(무료)] */
export const POST = handler<{ id: string }>(async ({ user, params, req }) => {
  const b = await req.json().catch(() => ({}));
  return makeVisualNow(user, params.id, { redraw: b?.redraw === true });
});
