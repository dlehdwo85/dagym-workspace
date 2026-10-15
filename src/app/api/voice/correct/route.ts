import { handler, body } from '@/lib/api';
import { correctInput, correctVoice } from '@/lib/voice';

/** V24 음성 받아쓰기 보정(회사 단어장) */
export const POST = handler(async ({ req, user }) => correctVoice(user, await body(req, correctInput)));
