import { handler, body } from '@/lib/api';
import { INTERVIEW, companyDraft, draftInput } from '@/lib/ai/companyDraft';

/** 로컬 10/19: 회사 정보 'AI 로 정리' — 글·홈페이지·회사소개서·인터뷰 답 → 칸별 초안(저장 안 함). GET = 인터뷰 질문 5개 */
export const GET = handler(async () => ({ questions: INTERVIEW }));
export const POST = handler(async ({ req, user }) => companyDraft(user, await body(req, draftInput)));
