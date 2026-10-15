import { handler, body } from '@/lib/api';
import { learnInput, learnVoice } from '@/lib/voice';

/** V24 보정 받아들임/되돌림 기록 */
export const POST = handler(async ({ req, user }) => learnVoice(user, await body(req, learnInput)));
