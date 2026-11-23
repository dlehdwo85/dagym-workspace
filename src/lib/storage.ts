import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, ListPartsCommand, AbortMultipartUploadCommand, ListMultipartUploadsCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, writeFile, readFile, stat, unlink, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { hmac } from './crypto';

/** 서버를 거치는 로컬(개발) 업로드 한 번의 최대 — 운영(S3)은 브라우저가 저장소로 바로 보냄 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/**
 * #1128(대표 11/23 '올리는 건 자유롭게 하되 최대 용량을 정할 수 있으면'): 파일 한 개 플랫폼 최대 2GB(영상 포함 같은 값) —
 * 회사 관리자가 50MB·200MB·1GB·2GB 중에서 정함(tenants.file_max_mb, 비면 2GB). 회사 전체 저장 한도(요금제)는 그대로.
 * 20MB 넘는 파일은 8MB 조각으로 브라우저가 저장소에 바로 올림(서버 크기 제약 없음). 예전 상한: 50MB·영상 100MB(#109).
 */
export const PLATFORM_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const FILE_MAX_CHOICES_MB = [50, 200, 1024, 2048] as const;
export const DEFAULT_FILE_MAX_MB = 2048;
/** 내용을 읽는 기능(AI 정리·글 뽑기·미리보기·브라우저에서 고치기)은 이 크기까지 — 넘으면 보관·내려받기만 */
export const CONTENT_READ_MAX = 50 * 1024 * 1024;
export const BIG_FILE_NOTE = '큰 파일은 보관·내려받기만 됩니다 — 50MB 넘는 파일은 AI 정리·글 뽑기·미리보기·브라우저에서 고치기를 하지 않습니다';
/** 서버가 파일 하나를 메모리로 한 번에 읽는 최대(안전장치 — 회의 녹음·영상 장면 등 예전 100~150MB 기능 포함) */
export const READ_GUARD_MAX = 200 * 1024 * 1024;
export const PART_SIZE = 8 * 1024 * 1024;
export const MULTIPART_FROM = 20 * 1024 * 1024;
export const isVideoMime = (mime: string | null | undefined) => /^video\//i.test(mime ?? '');
export const mbText = (mb: number) => (mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10}GB` : `${mb}MB`);
/** 회사의 파일 한 개 최대 크기(바이트) */
export async function tenantFileMaxBytes(tenant: string): Promise<number> {
  const { db } = await import('./db');
  const [t] = await db()<{ file_max_mb: number | null }[]>`select file_max_mb from tenants where id = ${tenant}`.catch(() => [] as never[]);
  const mb = t?.file_max_mb && (FILE_MAX_CHOICES_MB as readonly number[]).includes(t.file_max_mb) ? t.file_max_mb : DEFAULT_FILE_MAX_MB;
  return Math.min(mb * 1024 * 1024, PLATFORM_MAX_BYTES);
}
export const tooLargeMsg = (maxBytes: number) => `파일은 ${mbText(Math.round(maxBytes / 1024 / 1024))}까지 올릴 수 있습니다(회사 설정 — 관리 › 회사 정보에서 회사 관리자가 바꿀 수 있습니다)`;
/** 회사 상한을 넘으면 400 — 올리기 시작(init) 때 */
export async function assertFileSize(tenant: string, size: number) {
  const max = await tenantFileMaxBytes(tenant);
  if (size > max) { const { badRequest } = await import('./errors'); throw badRequest(tooLargeMsg(max)); }
}
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
    const ttl = size > 500 * 1024 * 1024 ? 6 * 3600 : 3600; // #1128: 큰 파일(최대 2GB)은 느린 연결에서 1시간이 넘을 수 있어 조각 주소를 6시간
    const parts = await Promise.all(Array.from({ length: n }, async (_, i) => ({ n: i + 1, url: await getSignedUrl(s3(), new UploadPartCommand({ Bucket: s3Env().bucket, Key: key, UploadId: c.UploadId!, PartNumber: i + 1 }), { expiresIn: ttl }) })));
    return { method: 'PUT' as const, url: '', headers: {}, multipart: { uploadId: c.UploadId!, partSize: PART_SIZE, parts } };
  }
  const exp = Date.now() + 3600_000;
  const parts = Array.from({ length: n }, (_, i) => { const pk = `${key}.part${i + 1}`; return { n: i + 1, url: `/api/files/local?key=${encodeURIComponent(pk)}&exp=${exp}&sig=${hmac(`put:${pk}:${exp}`)}` }; });
  return { method: 'PUT' as const, url: '', headers: { 'content-type': mime }, multipart: { uploadId: `local-${n}`, partSize: PART_SIZE, parts } };
}
/** 조각 업로드 완료 — 올린 조각을 한 파일로. 실패하면 조각을 버린다 */
/** 로컬 11/23(D-10 확인 중 발견): 완료 전에 멈춘 조각 올리기(창 닫기·지우기)는 저장소에 '미완료 업로드'로 남는다(서버는 uploadId 를 보관하지 않아
 *  지울 때 바로 취소할 수 없음). 하루 넘은 미완료 업로드를 취소해 공간·비용이 새지 않게 — 큰 파일 주소 유효 시간(최대 6시간)보다 충분히 김 */
export async function abortStaleUploads(maxAgeHours = 24) {
  if (!s3Configured()) return { aborted: 0, skipped: 'no_s3' as const };
  const cutoff = Date.now() - maxAgeHours * 3600e3;
  let aborted = 0, keyMarker: string | undefined, idMarker: string | undefined;
  for (let page = 0; page < 10; page++) {
    const r = await s3().send(new ListMultipartUploadsCommand({ Bucket: s3Env().bucket, KeyMarker: keyMarker, UploadIdMarker: idMarker, MaxUploads: 1000 }));
    for (const up of r.Uploads ?? []) {
      if (!up.Key || !up.UploadId || !up.Initiated || up.Initiated.getTime() > cutoff) continue;
      await s3().send(new AbortMultipartUploadCommand({ Bucket: s3Env().bucket, Key: up.Key, UploadId: up.UploadId })).then(() => { aborted++; }).catch(() => {});
    }
    if (!r.IsTruncated) break;
    keyMarker = r.NextKeyMarker; idMarker = r.NextUploadIdMarker;
  }
  return { aborted };
}
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
export async function downloadUrl(key: string, fileName: string, inline: boolean, ttlSec = 120, contentType?: string) {
  const disp = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  if (s3Configured()) {
    /* 336차: 창 안(iframe)에 띄우는 PDF 는 올릴 때 형식이 비어 있어도 브라우저가 내려받기로 돌리지 않게 응답 형식을 같이 서명 */
    return getSignedUrl(s3(), new GetObjectCommand({ Bucket: s3Env().bucket, Key: key, ResponseContentDisposition: disp, ...(inline && contentType ? { ResponseContentType: contentType } : {}) }), { expiresIn: ttlSec });
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
export async function getObject(key: string, max = READ_GUARD_MAX): Promise<Buffer> {
  if (s3Configured()) {
    const r = await s3().send(new GetObjectCommand({ Bucket: s3Env().bucket, Key: key }));
    // #1128 안전장치: 2GB 까지 올릴 수 있게 되어 큰 파일을 통째로 메모리에 읽지 않음
    if ((r.ContentLength ?? 0) > max) { (r.Body as { destroy?: () => void } | undefined)?.destroy?.(); throw new Error(BIG_FILE_NOTE); }
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  const b = await readLocal(key);
  if (b.length > max) throw new Error(BIG_FILE_NOTE);
  return b;
}

/** 상용화 B4 회사 파기: 경로(prefix) 아래 파일 열쇠를 최대 max 개 — S3 는 목록, 로컬은 폴더를 훑음 */
export async function listKeys(prefix: string, max = 1000): Promise<string[]> {
  if (!prefix || prefix === '/' || prefix.includes('..')) return [];
  if (s3Configured()) {
    const r = await s3().send(new ListObjectsV2Command({ Bucket: s3Env().bucket, Prefix: prefix, MaxKeys: Math.min(1000, max) }));
    return (r.Contents ?? []).map((o) => o.Key!).filter(Boolean);
  }
  const out: string[] = [];
  const walk = async (rel: string) => {
    if (out.length >= max) return;
    let ents: { name: string; isDirectory(): boolean }[];
    try { ents = await readdir(path.join(LOCAL_DIR, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) { if (out.length >= max) return; const k = `${rel}${e.name}`; if (e.isDirectory()) await walk(`${k}/`); else out.push(k); }
  };
  await walk(prefix.endsWith('/') ? prefix : `${prefix}/`);
  return out;
}
/** 상용화 B4 회사 파기: 파일 여러 개 지우기(없는 파일은 지난 것으로 봄) — 지운 개수 */
export async function deleteKeys(keys: string[]): Promise<number> {
  const ks = [...new Set(keys.filter((k) => k && !k.includes('..')))];
  if (!ks.length) return 0;
  if (s3Configured()) {
    let n = 0;
    for (let i = 0; i < ks.length; i += 1000) {
      const part = ks.slice(i, i + 1000);
      const r = await s3().send(new DeleteObjectsCommand({ Bucket: s3Env().bucket, Delete: { Objects: part.map((Key) => ({ Key })), Quiet: true } }));
      if (r.Errors?.length) throw new Error(`파일 ${r.Errors.length}개를 지우지 못했습니다: ${r.Errors[0]?.Code ?? ''}`);
      n += part.length;
    }
    return n;
  }
  for (const k of ks) await unlink(path.join(LOCAL_DIR, k)).catch((e) => { if (e?.code !== 'ENOENT') throw e; });
  return ks.length;
}
/** 로컬(개발·시험)에서 빈 폴더 정리 */
export async function removeLocalDir(prefix: string) {
  if (s3Configured() || !prefix || prefix.includes('..')) return;
  await rm(path.join(LOCAL_DIR, prefix), { recursive: true, force: true }).catch(() => {});
}
