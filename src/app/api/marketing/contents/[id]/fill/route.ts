import { handler } from '@/lib/api';
import { fillAction } from '@/lib/mktPhotoGen';

export const maxDuration = 120;
/** 189차 상세 '사진 기록' [빈 칸 생성으로 채우기] — 관리자만, 회사 설정과 상관없이 이 글만(크레딧 한도는 그대로) · { action: 'check' } = 진행 중인 생성 지금 확인 */
export const POST = handler<{ id: string }>(async ({ user, params, req }) => {
  const b = await req.json().catch(() => ({}));
  return fillAction(user, params.id, b?.action === 'check' ? 'check' : 'start');
});
