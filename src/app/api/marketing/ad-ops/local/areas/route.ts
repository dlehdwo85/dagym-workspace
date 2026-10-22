import { handler, body } from '@/lib/api';
import { areasInput, localAreas } from '@/lib/adOps';

export const maxDuration = 60;
/** 광고 최적화 1차 ② 동네 타깃: 기준 위치 반경 안 동네 이름 추천(AI 추정, 관리자) */
export const POST = handler(async ({ req, user }) => localAreas(user, await body(req, areasInput)));
