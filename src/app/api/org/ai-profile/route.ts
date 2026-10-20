import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { getAiProfile, saveAiProfile } from '@/lib/ai/persona';
import { INDUSTRIES } from '@/lib/industries';

/** 상용화: AI 비서가 알아야 할 우리 회사(업종·사업 소개·주요 고객·말투) — 회사 정보·디자인 권한 */
/** industries = 회사가 고른 업종들(첫 값 = 주 업종) · industryOptions = 고를 수 있는 목록 */
export const GET = handler(async ({ user }) => ({ ...(await getAiProfile(user)), industryOptions: INDUSTRIES }));
const txt = (n: number) => z.string().max(n).nullable().optional();
export const PUT = handler(async ({ req, user }) => saveAiProfile(user, await body(req, z.object({
  industry: z.string().max(40).refine((x) => !x || INDUSTRIES.includes(x), '업종 목록에서 고르세요').nullable().optional(),
  industries: z.array(z.string().max(40).refine((x) => INDUSTRIES.includes(x), '업종 목록에서 고르세요')).max(5).optional(), // 대표 10/20: 여러 개
  business: txt(1000), customers: txt(500), tone: txt(500), cautions: txt(500),
}))));
