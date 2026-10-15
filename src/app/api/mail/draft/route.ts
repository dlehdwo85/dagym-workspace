import { handler, body } from '@/lib/api';
import { draftInput, draftMail } from '@/lib/mailbox';

/** V21 AI 초안(메일·문자) + 자료 추천 상위 3 — 초안만, 보내기는 사람 */
export const maxDuration = 60;
export const POST = handler(async ({ req, user }) => draftMail(user, await body(req, draftInput)));
