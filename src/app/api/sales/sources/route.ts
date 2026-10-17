import { handler } from '@/lib/api';
import { listSources } from '@/lib/sales/sources';

/** V41 단계 3: 영업 공간 원천 카탈로그 + 회사 설정 */
export const GET = handler(async ({ user }) => listSources(user));
