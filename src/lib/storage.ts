import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { hmac } from './crypto';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** 서버 경유 업로드 최대 크기 (Vercel 함수 요청 본문 한도 4.5MB 아래) */
export const FALLBACK_MAX = 4 * 1024 * 1024;
const LOCAL_DIR = process.env.LOCAL_UPLOAD_DIR ?? path.join(process.cwd(), '.data', 'uploads');

export function s3Configured() {
  return !!(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY);
}

let client: S3Client | null = null;
function s3() {
  client ??= new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    // R2 는 SDK 기본 체크섬(x-amz-checksum-crc32·x-amz-sdk-checksum-algorithm)을 presigned PUT 에서 받아 주지 않아
    // 브라우저 업로드가 CORS 헤더 없는 오류("Failed to fetch")가 된다 → 필요할 때만 계산
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
  return client;
}

/** 업로드 대상: S3 면 presigned PUT, 로컬이면 서명된 내부 업로드 URL */
export async function uploadTarget(key: string, mime: string) {
  const exp = Date.now() + 600_000;
  const sig = hmac(`put:${key}:${exp}`);
  const viaServer = `/api/files/local?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
  if (s3Configured()) {
    const url = await getSignedUrl(s3(), new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, ContentType: mime }), { expiresIn: 600 });
    // fallback: 저장소로 바로 보내기가 실패하면(브라우저·CORS·네트워크) 작은 파일은 서버를 거쳐 저장 (Vercel 요청 크기 한도 4MB)
    return { method: 'PUT' as const, url, headers: { 'content-type': mime }, fallback: viaServer, fallbackMax: FALLBACK_MAX };
  }
  return { method: 'PUT' as const, url: viaServer, headers: { 'content-type': mime } };
}

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
      const h = await s3().send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
      return h.ContentLength ?? 0;
    }
    return (await stat(path.join(LOCAL_DIR, key))).size;
  } catch {
    return null;
  }
}

/** 권한 확인 후 발급하는 짧은 수명의 다운로드 URL */
export async function downloadUrl(key: string, fileName: string, inline: boolean) {
  const disp = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  if (s3Configured()) {
    return getSignedUrl(s3(), new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, ResponseContentDisposition: disp }), { expiresIn: 120 });
  }
  const exp = Date.now() + 120_000;
  return `/api/files/local?key=${encodeURIComponent(key)}&exp=${exp}&sig=${hmac(`get:${key}:${exp}`)}&name=${encodeURIComponent(fileName)}&inline=${inline ? 1 : 0}`;
}

/** 서버가 직접 파일을 저장 (공개 신고 양식 사진처럼 서명 URL 을 줄 수 없는 경우) */
export async function putObject(key: string, data: Buffer, mime: string) {
  if (s3Configured()) {
    await s3().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, Body: data, ContentType: mime }));
  } else await writeLocal(key, data);
}

/** 서버가 파일 내용을 읽음 (자료실 글자 추출·AI 읽기) */
export async function getObject(key: string): Promise<Buffer> {
  if (s3Configured()) {
    const r = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  return readLocal(key);
}
