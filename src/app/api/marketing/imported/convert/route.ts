import { handler, body } from '@/lib/api';
import { convertInput, convertOps } from '@/lib/opsConvert';

/** 운영실 기록 → 콘텐츠·결정·요청 기록 변환(관리자): preview = 건수·상태 매핑만, apply = 한 번만 생성 */
export const POST = handler(async ({ req, user }) => convertOps(user, await body(req, convertInput)));
