import { handler, body, clientIp } from '@/lib/api';
import { itemShareInput, setTaskShare } from '@/lib/shareMode';

/** #1129 이 업무만 공개 범위(null = 회사 설정 따름 · 'team' · 'company') */
export const PUT = handler<{ id: string }>(async ({ req, user, params }) => setTaskShare(user, params.id, await body(req, itemShareInput), clientIp(req)));
