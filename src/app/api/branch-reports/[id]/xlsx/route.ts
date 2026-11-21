import { handler } from '@/lib/api';
import { exportReport } from '@/lib/branchReport';
import { xlsxResponse } from '@/lib/xlsx';

/** #1096 2단계 내려받기(엑셀) — 주간·월간 모두. 권한은 화면과 같음(볼 수 없으면 404) */
export const GET = handler<{ id: string }>(async ({ user, params }) => { const r = await exportReport(user, params.id); return xlsxResponse(r.data, r.fileName); });
