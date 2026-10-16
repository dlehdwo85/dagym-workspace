import { handler, body } from '@/lib/api';
import { structureInput, structureVoice } from '@/lib/voice';

/** 음성 등록: 말한 지시 → 업무명·담당·마감 정리(AI 1번, 없으면 ok:false) */
export const POST = handler(async ({ req, user }) => structureVoice(user, await body(req, structureInput)));
