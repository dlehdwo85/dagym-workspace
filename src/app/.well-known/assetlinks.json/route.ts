import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
// Android 앱 링크 검증. ANDROID_CERT_SHA256 = 앱 서명 인증서 SHA-256 (콤마로 여러 개: 업로드 키·Play 앱 서명 키)
export async function GET() {
  const fps = (process.env.ANDROID_CERT_SHA256 ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return NextResponse.json(fps.length ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'kr.co.dagym.workos', sha256_cert_fingerprints: fps } }] : []);
}
