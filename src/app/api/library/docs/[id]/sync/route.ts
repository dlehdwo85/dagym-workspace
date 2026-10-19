import { handler, body } from '@/lib/api';
import { syncDoc, syncInput } from '@/lib/libDocs';

/** 한 번의 왕복으로 보내기·받기(짧은 폴링, 외부 실시간 서비스 없음) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => syncDoc(user, params.id, await body(req, syncInput)));
