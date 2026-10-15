import { handler } from '@/lib/api';
import { listTaskOutbox, mailContext } from '@/lib/mailbox';

/** V21 업무 메일 시안 기본값(받는 사람·회사 명함·첨부) + 발송 기록. ?history=1 이면 기록만 */
export const GET = handler<{ id: string }>(async ({ req, user, params }) =>
  req.nextUrl.searchParams.get('history') ? listTaskOutbox(user, params.id) : mailContext(user, params.id));
