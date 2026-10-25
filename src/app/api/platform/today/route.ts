import { handler } from '@/lib/api';
import { platformToday } from '@/lib/platformAdmin';

/** #565 플랫폼 운영 '오늘 볼 것' 숫자(슈퍼관리자만) */
export const GET = handler(async ({ user }) => platformToday(user));
