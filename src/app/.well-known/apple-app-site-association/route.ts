import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
// iOS 유니버설 링크. APPLE_TEAM_ID 설정 시 활성화
export async function GET() {
  const team = process.env.APPLE_TEAM_ID;
  const details = team ? [{ appIDs: [`${team}.kr.co.dagym.workos`], components: [{ '/': '/tasks/*' }, { '/': '/calendar*' }, { '/': '/notifications*' }] }] : [];
  return NextResponse.json({ applinks: { details } });
}
