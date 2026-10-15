import { handler } from '@/lib/api';
import { templateCsv } from '@/lib/taskImport';

/** V30 ① 예시 양식 CSV(회사 사람 이름으로 채움) */
export const GET = handler(async ({ user }) => new Response(await templateCsv(user), {
  headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('워크인_업무_가져오기_양식.csv')}` },
}));
