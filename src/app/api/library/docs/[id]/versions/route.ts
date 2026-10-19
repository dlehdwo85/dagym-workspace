import { handler } from '@/lib/api';
import { listVersions, markVersion } from '@/lib/libDocs';

export const GET = handler<{ id: string }>(async ({ user, params }) => listVersions(user, params.id));
/** 지금 상태를 변경 기록으로 남김(되돌리기 전·사용자 요청) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => markVersion(user, params.id, req.nextUrl.searchParams.get('reason') === 'restore' ? 'restore' : 'manual'));
