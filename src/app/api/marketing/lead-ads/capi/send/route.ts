import { handler } from '@/lib/api';
import { capiSendNow } from '@/lib/metaCapi';

export const maxDuration = 60;
/** #499-3 [지금 보내기](관리자): 이 회사만 바로 만들고 보냄(평소에는 tick 이 하루 여러 번) */
export const POST = handler(async ({ user }) => capiSendNow(user));
