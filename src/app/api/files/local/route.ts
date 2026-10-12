import { NextResponse, type NextRequest } from 'next/server';
import { readLocal, verifyLocalSig, writeLocal, s3Configured, MAX_UPLOAD_BYTES } from '@/lib/storage';

// 로컬 디스크 저장소 (개발·검수 환경). 운영은 S3 호환 저장소를 사용한다.
export async function PUT(req: NextRequest) {
  if (s3Configured()) return NextResponse.json({ error: 'disabled' }, { status: 404 });
  const p = req.nextUrl.searchParams;
  const key = p.get('key') ?? '';
  if (!verifyLocalSig('put', key, p.get('exp') ?? '', p.get('sig') ?? '')) return NextResponse.json({ error: 'bad signature' }, { status: 403 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'too large' }, { status: 413 });
  await writeLocal(key, buf);
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  if (s3Configured()) return NextResponse.json({ error: 'disabled' }, { status: 404 });
  const p = req.nextUrl.searchParams;
  const key = p.get('key') ?? '';
  if (!verifyLocalSig('get', key, p.get('exp') ?? '', p.get('sig') ?? '')) return NextResponse.json({ error: 'expired' }, { status: 403 });
  const name = p.get('name') ?? 'file';
  const data = await readLocal(key).catch(() => null);
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const inline = p.get('inline') === '1';
  const ext = name.split('.').pop()?.toLowerCase();
  const type = inline ? ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream' : 'application/octet-stream';
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'content-type': type,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=60',
    },
  });
}
