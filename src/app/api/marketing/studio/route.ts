import { handler, body } from '@/lib/api';
import { briefInput, createBrief, listBriefs } from '@/lib/mktStudio';

/** 대표 10/20 19:00 제작의뢰실: 의뢰 목록 · 새 의뢰(바로 AI 프롬프트 작성) */
export const GET = handler(async ({ user }) => listBriefs(user));
export const POST = handler(async ({ req, user }) => createBrief(user, await body(req, briefInput)));
