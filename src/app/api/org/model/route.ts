import { handler, body, clientIp } from '@/lib/api';
import { requireAnyMenu } from '@/lib/menuPerms';
import { orgModelInput, orgModelView, setMultiSite } from '@/lib/orgModel';

/** 405차 범용화 조직 모델: "지점이 여러 곳" 설정 — 조회는 로그인한 누구나(화면 표시용), 저장은 회사 정보 편집 권한 */
export const GET = handler(async ({ user }) => orgModelView(user));
export const PUT = handler(async ({ req, user }) => { await requireAnyMenu(user, ['company', 'ops'], 'edit'); return setMultiSite(user, await body(req, orgModelInput), clientIp(req)); });
