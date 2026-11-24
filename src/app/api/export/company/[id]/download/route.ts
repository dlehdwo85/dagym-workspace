import { NextResponse } from 'next/server';
import { handler, clientIp } from '@/lib/api';
import { companyExportDownload } from '@/lib/companyExport';

/** 회사 전체 내보내기 압축 파일 내려받기(?part=1…) — 그 회사 대표·관리자만, 7일 안, 받을 때마다 감사 기록. ?json=1 이면 주소만 */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const part = Math.max(1, Math.floor(Number(req.nextUrl.searchParams.get('part') ?? 1)) || 1);
  const abs = new URL(await companyExportDownload(user, params.id, part, clientIp(req)), req.nextUrl.origin).toString();
  return req.nextUrl.searchParams.get('json') === '1' ? { url: abs } : NextResponse.redirect(abs, 302);
});
