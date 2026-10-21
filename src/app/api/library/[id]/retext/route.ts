import { handler } from '@/lib/api';
import { retextLibraryFile } from '@/lib/library';

/** 로컬 10/21 11:05: 본문 다시 추출(바로) — 올린 사람·관리자 */
export const POST = handler<{ id: string }>(async ({ user, params }) => retextLibraryFile(user, params.id));
