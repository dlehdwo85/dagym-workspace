import { handler } from '@/lib/api';
import { quoteSmsText } from '@/lib/quotes';

/** 문자 시안(링크 14일) — 보내는 것은 휴대폰 문자앱 */
export const POST = handler<{ id: string }>(async ({ user, params }) => quoteSmsText(user, params.id));
