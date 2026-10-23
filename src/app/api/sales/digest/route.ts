import { handler } from '@/lib/api';
import { previewDigest, todayDigest } from '@/lib/sales/digest';

/** 오늘 다이제스트(보냈으면 보낸 것, 아니면 지금 기준 미리보기). #510 ?preview=html|text → 지금 메일을 만들면 이렇게(보내지 않음) */
export const GET = handler(async ({ req, user }) => {
  const pv = req.nextUrl.searchParams.get('preview');
  return pv === 'html' || pv === 'text' ? previewDigest(user, pv) : todayDigest(user);
});
