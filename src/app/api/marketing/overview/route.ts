import { handler } from '@/lib/api';
import { overview } from '@/lib/marketing';

/** V41 4-2 마케팅 개요 숫자 카드 */
export const GET = handler(async ({ user }) => overview(user));
