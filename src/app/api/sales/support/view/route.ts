import { handler, body } from '@/lib/api';
import { saveSupportView, supportViewInput } from '@/lib/sales/support';

/** #781 지원사업 정렬·D-day·종류 고른 것을 사람별로 기억(어느 기기에서나 같게) */
export const PUT = handler(async ({ req, user }) => saveSupportView(user, await body(req, supportViewInput)));
