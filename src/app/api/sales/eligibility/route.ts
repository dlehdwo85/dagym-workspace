import { z } from 'zod';
import { body, handler } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { readEligibility } from '@/lib/sales/eligibility';
import { assertSpace } from '@/lib/spaces';

export const maxDuration = 60;
/** 252차 #786 [공고문 다시 읽기] — 첨부 공고문의 '참가자격' 절을 지금 다시 읽어 저장(영업 공간 사람) */
export const POST = handler(async ({ req, user }) => {
  await assertSpace(user, 'sales');
  const { id } = await body(req, z.object({ id: z.string().min(1).max(200) }));
  const e = await readEligibility(id);
  if (!e) throw notFound();
  return { eligibility: e };
});
