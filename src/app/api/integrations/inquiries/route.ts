import { after } from 'next/server';
import { handler } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { receiveInquiry, summarizeInquiry } from '@/lib/inquiries';

/** 16차: 다짐·하이링크 웹사이트 → 워크인 문의 등록 (Authorization: Bearer <연동 토큰>) */
export const POST = handler(async ({ req }) => {
  let json: unknown;
  try { json = await req.json(); } catch { throw badRequest('요청 본문이 올바른 JSON 이 아닙니다'); }
  const r = await receiveInquiry(req.headers.get('authorization'), json);
  if (!r.duplicate && r.taskId) {
    after(async () => {
      const { dispatchPending } = await import('@/lib/push');
      await dispatchPending().catch(() => {});
      await summarizeInquiry(r.taskIds, (r as { ceoId: string }).ceoId);
    });
  }
  return { ok: true, duplicate: r.duplicate, taskId: r.taskId, taskIds: r.taskIds };
}, { public: true });
