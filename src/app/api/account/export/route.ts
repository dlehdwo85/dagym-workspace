import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { exportMine } from '@/lib/account';

/** 내 데이터 내려받기 (JSON 파일) */
export const GET = handler(async ({ user }) => {
  const data = await exportMine(user);
  return new NextResponse(JSON.stringify(data, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="workin-export-${new Date().toISOString().slice(0, 10)}.json"` } });
});
