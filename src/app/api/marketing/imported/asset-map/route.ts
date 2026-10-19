import { handler, body } from '@/lib/api';
import { assetMapInput, saveAssetMap } from '@/lib/opsConvert';

/** 운영실 자산 'id → 주소' 목록 올리기(관리자) — 변환 [미리보기]·[옮기기]가 이 목록으로 시안 파일을 찾음 */
export const POST = handler(async ({ req, user }) => saveAssetMap(user, await body(req, assetMapInput)));
