import { handler, body } from '@/lib/api';
import { fileInput, initFile } from '@/lib/agreements';

/** 계약서 파일 올리기 시작 → 올릴 주소. 다 올린 뒤 /api/agreements/files/:id (POST) 로 마무리 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => initFile(user, params.id, await body(req, fileInput)));
