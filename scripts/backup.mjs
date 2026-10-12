// DB 백업: pg_dump(custom) → AES-256 암호화 → 로컬 파일 + (설정 시) S3 호환 저장소 업로드
// 필요: DATABASE_URL, BACKUP_PASSPHRASE / 선택: BACKUP_DIR, BACKUP_S3_BUCKET(+ S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION)
import { execFileSync } from 'node:child_process';
import { createCipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const url = process.env.DATABASE_URL;
const pass = process.env.BACKUP_PASSPHRASE;
if (!url || !pass) { console.error('DATABASE_URL, BACKUP_PASSPHRASE 필요'); process.exit(1); }
const dir = process.env.BACKUP_DIR ?? '.data/backups';
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dump = execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', url], { maxBuffer: 1024 * 1024 * 1024 });
const salt = randomBytes(16), iv = randomBytes(12);
const key = scryptSync(pass, salt, 32);
const c = createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([c.update(dump), c.final()]);
const out = Buffer.concat([Buffer.from('WOSB1'), salt, iv, c.getAuthTag(), enc]);
const file = path.join(dir, `workos-${stamp}.dump.enc`);
writeFileSync(file, out);
const sha = createHash('sha256').update(out).digest('hex');
console.log(JSON.stringify({ file, bytes: out.length, dumpBytes: dump.length, sha256: sha }));

if (process.env.BACKUP_S3_BUCKET) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: process.env.S3_REGION || 'auto', endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
  const k = `db-backups/${path.basename(file)}`;
  await s3.send(new PutObjectCommand({ Bucket: process.env.BACKUP_S3_BUCKET, Key: k, Body: readFileSync(file), Metadata: { sha256: sha } }));
  console.log(JSON.stringify({ uploaded: `s3://${process.env.BACKUP_S3_BUCKET}/${k}` }));
}
