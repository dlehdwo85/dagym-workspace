import { handler } from '@/lib/api';
import { salesMigratePreview } from '@/lib/sales/migrate';

export const maxDuration = 300;
/** V41 단계 2 영업관리 이전 — 미리보기(원본 읽기만, 저장 없음). 적용은 로컬 대조·대표 확인 뒤 다음 단계 */
export const POST = handler(async ({ user }) => salesMigratePreview(user));
