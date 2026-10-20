import { handler, body } from '@/lib/api';
import { saveSheet, sheetEditInput, sheetLayout } from '@/lib/attachmentEdit';

/** xlsx 칸 고치기: 시트·칸 값 읽기 · 값 바꿔 새 버전(서식·수식 그대로) */
export const GET = handler<{ id: string }>(async ({ user, params }) => sheetLayout(user, params.id));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => saveSheet(user, params.id, await body(req, sheetEditInput)));
