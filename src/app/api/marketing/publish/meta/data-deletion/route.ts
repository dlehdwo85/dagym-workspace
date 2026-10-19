import { NextResponse, type NextRequest } from 'next/server';
import { metaDataDeletion } from '@/lib/mktChannels';

/** Meta 데이터 삭제 콜백(앱 설정에 등록): signed_request 확인 → 그 사용자가 연결한 게시 계정 삭제 → { url, confirmation_code } */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    return NextResponse.json(await metaDataDeletion(String(form.get('signed_request') ?? '')));
  } catch (e: any) {
    return NextResponse.json({ error: { message: String(e?.message ?? 'error') } }, { status: e?.status ?? 400 });
  }
}
