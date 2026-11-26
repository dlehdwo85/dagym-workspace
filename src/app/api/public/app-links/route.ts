import { NextResponse } from 'next/server';
import { appStoreUrl } from '@/lib/appStore';
import { PLAY_URL } from '@/lib/storeLinks';

export const dynamic = 'force-dynamic';

/** #1177: 화면(초대 수락 등 브라우저 화면)이 쓰는 스토어 주소 — App Store 는 공개 조회로 찾으면 자동으로 채워짐(1시간 캐시) */
export async function GET() {
  return NextResponse.json({ play: PLAY_URL, appstore: await appStoreUrl() }, { headers: { 'cache-control': 'public, max-age=300' } });
}
