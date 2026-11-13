import { handler, body, clientIp } from '@/lib/api';
import { requireAnyMenu } from '@/lib/menuPerms';
import { setTerms, termsInput, termsView } from '@/lib/termsServer';

/** 범용화 2단계: 이 회사의 용어(역할 이름) — 조회는 로그인한 누구나(화면 표시용), 저장은 회사 정보 편집 권한 */
export const GET = handler(async ({ user }) => termsView(user));
export const PUT = handler(async ({ req, user }) => { await requireAnyMenu(user, ['company', 'ops'], 'edit'); return setTerms(user, await body(req, termsInput), clientIp(req)); });
