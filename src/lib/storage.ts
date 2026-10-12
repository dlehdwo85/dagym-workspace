import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { hmac } from './crypto';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
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
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  });
  return client;
}

/** 업로드 대상: S3 면 presigned PUT, 로컬이면 서명된 내부 업로드 URL */
export async function uploadTarget(key: string, mime: string) {
  if (s3Configured()) {
    const url = await getSignedUrl(s3(), new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key, ContentType: mime }), { expiresIn: 600 });
    return { method: 'PUT' as const, url, headers: { 'content-type': mime } };
  }
  const exp = Date.now() + 600_000;
  const sig = hmac(`put:${key}:${exp}`);
  return { method: 'PUT' as const, url: `/api/files/local?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`, headers: { 'content-type': mime } };
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
