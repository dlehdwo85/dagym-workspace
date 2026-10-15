import { handler, body } from '@/lib/api';
import { mailModeInput, setMailMode } from '@/lib/mailbox';

/** V29 회사 기본 발송 방식: auto · workin(워크인 발송) · smtp(회사 메일 계정) */
export const PUT = handler(async ({ req, user }) => setMailMode(user, await body(req, mailModeInput)));
