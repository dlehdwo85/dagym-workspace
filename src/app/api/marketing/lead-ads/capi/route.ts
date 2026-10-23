import { handler, body } from '@/lib/api';
import { capiInput, capiView, setCapi } from '@/lib/metaCapi';

/** #499-3 리드 단계 → Meta 전환 API: 설정·보낸 기록(토큰은 '저장됨'만) */
export const GET = handler(async ({ user }) => capiView(user));
/** 설정 저장(관리자) — 켜기·데이터 세트 ID·토큰(비우면 그대로)·CRM 이름·단계 이름표 */
export const PUT = handler(async ({ req, user }) => setCapi(user, await body(req, capiInput)));
