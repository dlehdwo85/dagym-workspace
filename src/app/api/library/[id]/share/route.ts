import { handler, body, clientIp } from '@/lib/api';
import { itemShareInput, setFileShare } from '@/lib/shareMode';

/** #1129 '우리 팀' 자료 한 건의 공개 범위(null = 회사 설정 따름 · 'team' · 'company') */
export const PUT = handler<{ id: string }>(async ({ req, user, params }) => setFileShare(user, params.id, await body(req, itemShareInput), clientIp(req)));
