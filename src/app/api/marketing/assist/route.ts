import { handler, body } from '@/lib/api';
import { captionAssist, captionInput } from '@/lib/marketing';

/** 마케팅 AI 비서: 캡션 초안 3개 + 해시태그(게시는 승인 대기를 거쳐 사람이) */
export const POST = handler(async ({ req, user }) => captionAssist(user, await body(req, captionInput)));
