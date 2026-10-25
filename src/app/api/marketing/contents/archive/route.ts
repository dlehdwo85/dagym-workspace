import { handler, body } from '@/lib/api';
import { archiveAll, archiveAllInput } from '@/lib/mktAuto';

/** 대표 10/25 22:20 전면 정리(로컬 요청 A): 미게시 글(초안·승인 대기·수정 요청·보류)을 한 번에 '취소'로 보관 — dryRun 이면 건수만. 관리자 */
export const POST = handler(async ({ req, user }) => archiveAll(user, await body(req, archiveAllInput)));
