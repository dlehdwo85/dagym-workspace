import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, ListPartsCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, writeFile, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { hmac } from './crypto';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** 대표 10/20 17:00 (#109): 영상은 100MB 까지 — 8MB 조각으로 나눠 올린다(조각 업로드는 20MB 넘는 파일부터) */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const PART_SIZE = 8 * 1024 * 1024;
export const MULTIPART_FROM = 20 * 1024 * 1024;
export const isVideoMime = (mime: string | null | undefined) => /^video\//i.test(mime ?? '');
export const maxUploadBytes = (mime: string | null | undefined) => (isVideoMime(mime) ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES);
export const tooLargeMsg = (mime: string | null | undefined) => `${isVideoMime(mime) ? '영상' : '파일'}은 ${maxUploadBytes(mime) / 1024 / 1024}MB 까지 올릴 수 있습니다`;
/** 서버 경유 업로드 최대 크기 (Vercel 함수 요청 본문 한도 4.5MB 아래) */
export const FALLBACK_MAX = 4 * 1024 * 1024;
const LOCAL_DIR = process.env.LOCAL_UPLOAD_DIR ?? path.join(process.cwd(), '.data', 'uploads');

/**
 * S3_* 환경변수를 읽을 때 앞뒤 공백·줄바꿈·따옴표를 없앤다(Vercel 에 붙여 넣다 섞이면
 * "Invalid character in header content [authorization]"·서명 불일치로 업로드가 모두 실패).
 */
const clean = (v: string | undefined) => (v ?? '').trim().replace(/^(['"])(.*)\1$/s, '$2').trim();
export const s3Env = () => ({
  bucket: clean(process.env.S3_BUCKET), keyId: clean(process.env.S3_ACCESS_KEY_ID), secret: clean(process.env.S3_SECRET_ACCESS_KEY),
  endpoint: clean(process.env.S3_ENDPOINT), region: clean(process.env.S3_REGION) || 'auto',
});
/** 값은 노출하지 않고 형식 이상만 (공백·줄바꿈·따옴표가 섞였는지, 안쪽에 남은 공백이 있는지) */
export function s3EnvWarnings() {
  const w: string[] = [];
  for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT', 'S3_REGION']) {
    const raw = process.env[k];
    if (raw === undefined) continue;
    if (raw !== raw.trim() || /^['"]|['"]$/.test(raw.trim())) w.push(`${k}: 앞뒤 공백·줄바꿈·따옴표가 섞여 있음(자동으로 지워서 사용 중 — Vercel 값을 다시 붙여 넣기 권장)`);
    if (/\s/.test(clean(raw))) w.push(`${k}: 값 안에 공백·줄바꿈이 있음(잘못 붙여 넣었을 가능성 — 다시 확인 필요)`);
  }
  return w;
}

export function s3Configured() {
  const e = s3Env();
  return !!(e.bucket && e.keyId && e.secret);
}

let client: S3Client | null = null;
function s3() {
  client ??= new S3Client({
    region: s3Env().region,
    endpoint: s3Env().endpoint || undefined,
    forcePathStyle: !!s3Env().endpoint,
    // R2 는 SDK 기본 체크섬(x-amz-checksum-crc32·x-amz-sdk-checksum-algorithm)을 presigned PUT 에서 받아 주지 않아
    // 브라우저 업로드가 CORS 헤더 없는 오류("Failed to fetch")가 된다 → 필요할 때만 계산
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: s3Env().keyId, secretAccessKey: s3Env().secret },
  });
  return client;
}

export type UploadTarget = { method: 'PUT'; url: string; headers: Record<string, string>; fallback?: string; fallbackMax?: number; multipart?: { uploadId: string; partSize: number; parts: { n: number; url: string }[] } };
/** 업로드 대상: S3 면 presigned PUT, 로컬이면 서명된 내부 업로드 URL */
export async function uploadTarget(key: string, mime: string): Promise<UploadTarget> {
  const exp = Date.now() + 600_000;
  const sig = hmac(`put:${key}:${exp}`);
  const viaServer = `/api/files/local?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  if (s3Configured()) {
    const url = await getSignedUrl(s3(), new PutObjectCommand({ Bucket: s3Env().bucket, Key: key, ContentType: mime }), { expiresIn: 600 });
    // fallback: 저장소로 바로 보내기가 실패하면(브라우저·CORS·네트워크) 작은 파일은 서버를 거쳐 저장 (Vercel 요청 크기 한도 4MB)
    return { method: 'PUT' as const, url, headers: { 'content-type': mime }, fallback: viaServer, fallbackMax: FALLBACK_MAX };
  }
  return { method: 'PUT' as const, url: viaServer, headers: { 'content-type': mime } };
}

/** 큰 파일(영상)은 조각으로: S3 면 멀티파트(조각마다 presigned PUT, 완료는 서버가 ListParts 로 ETag 를 모아 합침 — 브라우저 CORS 에 ETag 노출이 없어도 됨), 로컬이면 `key.partN` 조각 파일을 완료 때 이어 붙인다 */
export async function multipartTarget(key: string, mime: string, size: number): Promise<UploadTarget> {
  const n = Math.max(1, Math.ceil(size / PART_SIZE));
  if (s3Configured()) {
    const c = await s3().send(new CreateMultipartUploadCommand({ Bucket: s3Env().bucket, Key: key, ContentType: mime }));
    const parts = await Promise.all(Array.from({ length: n }, async (_, i) => ({ n: i + 1, url: await getSignedUrl(s3(), new UploadPartCommand({ Bucket: s3Env().bucket, Key: key, UploadId: c.UploadId!, PartNumber: i + 1 }), { expiresIn: 3600 }) })));
    return { method: 'PUT' as const, url: '', headers: {}, multipart: { uploadId: c.UploadId!, partSize: PART_SIZE, parts } };
  }
  const exp = Date.now() + 3600_000;
  const parts = Array.from({ length: n }, (_, i) => { const pk = `${key}.part${i + 1}`; return { n: i + 1, url: `/api/files/local?key=${encodeURIComponent(pk)}&exp=${exp}&sig=${hmac(`put:${pk}:${exp}`)}` }; });
  return { method: 'PUT' as const, url: '', headers: { 'content-type': mime }, multipart: { uploadId: `local-${n}`, partSize: PART_SIZE, parts } };
}
/** 조각 업로드 완료 — 올린 조각을 한 파일로. 실패하면 조각을 버린다 */
export async function completeMultipart(key: string, uploadId: string) {
  if (s3Configured()) {
    const parts: { ETag: string; PartNumber: number }[] = [];
    let marker: string | undefined;
    do {
      const l = await s3().send(new ListPartsCommand({ Bucket: s3Env().bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
      for (const p of l.Parts ?? []) parts.push({ ETag: p.ETag!, PartNumber: p.PartNumber! });
      marker = l.IsTruncated ? l.NextPartNumberMarker : undefined;
    } while (marker);
    if (!parts.length) { await s3().send(new AbortMultipartUploadCommand({ Bucket: s3Env().bucket, Key: key, UploadId: uploadId })).catch(() => {}); throw new Error('올라온 조각이 없습니다'); }
    parts.sort((a, b) => a.PartNumber - b.PartNumber);
    await s3().send(new CompleteMultipartUploadCommand({ Bucket: s3Env().bucket, Key: key, UploadId: uploadId, MultipartUpload: { Parts: parts } }));
    return;
  }
  const n = Number(/^local-(\d+)$/.exec(uploadId)?.[1]);
  if (!n || n > 64) throw new Error('잘못된 조각 업로드입니다');
  const bufs: Buffer[] = [];
  for (let i = 1; i <= n; i++) {
    const b = await readLocal(`${key}.part${i}`).catch(() => null);
    if (!b) throw new Error(`조각 ${i}/${n} 이 올라오지 않았습니다`);
    bufs.push(b);
  }
  await writeLocal(key, Buffer.concat(bufs));
  for (let i = 1; i <= n; i++) await unlink(path.join(LOCAL_DIR, `${key}.part${i}`)).catch(() => {});
}
/** 크기·종류에 맞는 업로드 대상(조각 또는 한 번에) */
export const uploadTargetFor = (key: string, mime: string, size: number): Promise<UploadTarget> => (size > MULTIPART_FROM ? multipartTarget(key, mime, size) : uploadTarget(key, mime));

export function verifyLocalSig(kind: 'put' | 'get', key: string, exp: string, sig: string) {
  return Number(exp) > Date.now() && hmac(`${kind}:${key}:${exp}`) === sig && !key.includes('..');
}

export async function writeLocal(key: string, data: Buffer) {
  const p = path.join(LOCAL_DIR, key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data);
}
export async function readLocal(key: string) {
  return readFile(path.join(LOCAL_DIR, key));
}

/** 업로드 완료 확인 (크기 반환, 없으면 null) */
export async function objectSize(key: string): Promise<number | null> {
  try {
    if (s3Configured()) {
      const h = await s3().send(new HeadObjectCommand({ Bucket: s3Env().bucket, Key: key }));
      return h.ContentLength ?? 0;
    }
    return (await stat(path.join(LOCAL_DIR, key))).size;
  } catch {
    return null;
  }
}

/** 권한 확인 후 발급하는 짧은 수명의 다운로드 URL */
export async function downloadUrl(key: string, fileName: string, inline: boolean, ttlSec = 120) {
  const disp = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  if (s3Configured()) {
    return getSignedUrl(s3(), new GetObjectCommand({ Bucket: s3Env().bucket, Key: key, ResponseContentDisposition: disp }), { expiresIn: ttlSec });
  }
  const exp = Date.now() + ttlSec * 1000;
  return `/api/files/local?key=${encodeURIComponent(key)}&exp=${exp}&sig=${hmac(`get:${key}:${exp}`)}&name=${encodeURIComponent(fileName)}&inline=${inline ? 1 : 0}`;
}

/** 서버가 직접 파일을 저장 (공개 신고 양식 사진처럼 서명 URL 을 줄 수 없는 경우) */
export async function putObject(key: string, data: Buffer, mime: string) {
  if (s3Configured()) {
    await s3().send(new PutObjectCommand({ Bucket: s3Env().bucket, Key: key, Body: data, ContentType: mime }));
  } else await writeLocal(key, data);
}

/** 서버가 파일 내용을 읽음 (자료실 글자 추출·AI 읽기) */
export async function getObject(key: string): Promise<Buffer> {
  if (s3Configured()) {
    const r = await s3().send(new GetObjectCommand({ Bucket: s3Env().bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  return readLocal(key);
}
