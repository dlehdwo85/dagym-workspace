import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { closePoll, votePoll } from '@/lib/chat';

/** 메신저 2차 B9 투표: { vote: [보기 번호] } 투표(빈 배열 = 취소) · { close: true } 마감(만든 사람·방장) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const i = await body(req, z.object({ vote: z.array(z.number().int().min(0).max(20)).max(10).optional(), close: z.boolean().optional() }));
  if (i.close) return closePoll(user, params.id);
  return votePoll(user, params.id, i.vote ?? []);
});
