import { handler, body } from '@/lib/api';
import { actContent, contentActInput } from '@/lib/mktAuto';

export const maxDuration = 120;
/** 관리자: 자동 시안 다시 만들기 · 콘텐츠 보관(숨김, 지우지 않음) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => actContent(user, params.id, await body(req, contentActInput)));
