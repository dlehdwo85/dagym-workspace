import { handler, body, clientIp } from '@/lib/api';
import { platformUserAction, userActionInput } from '@/lib/platformAdmin';

/** V28-3 사용자 잠금/해제·비밀번호 재설정 메일·2단계 인증 초기화(비밀번호는 보거나 정하지 않음) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => platformUserAction(user, params.id, await body(req, userActionInput), clientIp(req)));
