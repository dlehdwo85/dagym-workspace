import { handler, body } from '@/lib/api';
import { listTrash, trashContents, trashInput } from '@/lib/mktTrash';

/** 183차 #177 마케팅 콘텐츠 휴지통(관리자): GET 목록(지운 사람·원래 상태·30일 뒤 영구 삭제 예정일) · POST ids[] 여러 건 휴지통으로 — 승인함 '수정 요청·보류'·'초안 보관' 칸 [골라서 지우기] */
export const GET = handler(async ({ user }) => listTrash(user));
export const POST = handler(async ({ req, user }) => trashContents(user, await body(req, trashInput)));
