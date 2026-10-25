import { handler, body } from '@/lib/api';
import { markInput, markPhoto } from '@/lib/mktPhotos';

/** #235 ⓒ 사람이 고친 판정: { text: 'none' | 'has' | 'auto' } = 글자 없음(바탕으로 씀) · 글자 있음(쓰지 않음) · AI 판정대로 — 관리자만 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => markPhoto(user, params.id, await body(req, markInput)));
