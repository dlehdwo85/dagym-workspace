import { handler } from '@/lib/api';
import { deletePlanFor } from '@/lib/taskEventDelete';

/** 361차 #977 업무 삭제 창: 함께 지울 수 있는 연결 일정(기본 체크·남김 이유·참석자 수). 읽기만 — 묶음이면 ?batch=1 */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => deletePlanFor(user, params.id, req.nextUrl.searchParams.get('batch') === '1'));
