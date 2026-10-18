import { handler, body } from '@/lib/api';
import { brandCreateInput, createBrandWithKit } from '@/lib/mktAuto';

/** 자동 제작 › 브랜드 추가(+ 시험 모드) */
export const POST = handler(async ({ req, user }) => createBrandWithKit(user, await body(req, brandCreateInput)));
