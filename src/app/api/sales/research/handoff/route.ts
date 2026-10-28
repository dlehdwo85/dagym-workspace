import { body, handler } from '@/lib/api';
import { handoffResearch, researchHandoffInput } from '@/lib/sales/research';

/** 247차 #777: [후속조사 넘기기] — 고른 준공·입주 시설을 후속조사 업무 하나로(담당 기본 = 담당자 지정 '영업 원천 · 시설') */
export const POST = handler(async ({ req, user }) => handoffResearch(user, await body(req, researchHandoffInput)));
