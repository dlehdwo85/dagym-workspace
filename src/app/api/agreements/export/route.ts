import { handler } from '@/lib/api';
import { exportAgreements } from '@/lib/agreements';
import { xlsxResponse } from '@/lib/xlsx';

/** 계약 목록 엑셀(금액·담당자·만료일·상태) */
export const GET = handler(async ({ user }) => { const f = await exportAgreements(user); return xlsxResponse(f.data, f.fileName); });
