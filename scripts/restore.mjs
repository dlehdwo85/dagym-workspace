// 복원: node scripts/restore.mjs <백업파일 또는 s3 키> — 대상 RESTORE_DATABASE_URL (운영 DB 덮어쓰기 방지를 위해 DATABASE_URL 과 다른 변수)
import { execFileSync } from 'node:child_process';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const src = process.argv[2];
const target = process.env.RESTORE_DATABASE_URL;
const pass = process.env.BACKUP_PASSPHRASE;
if (!src || !target || !pass) { console.error('사용법: RESTORE_DATABASE_URL=... BACKUP_PASSPHRASE=... node scripts/restore.mjs <파일|db-backups/키>'); process.exit(1); }
if (process.env.DATABASE_URL && target === process.env.DATABASE_URL && process.env.CONFIRM_OVERWRITE !== 'yes') {
  console.error('운영 DB 와 같은 주소입니다. 정말 덮어쓰려면 CONFIRM_OVERWRITE=yes'); process.exit(1);
}
let buf;
if (src.startsWith('db-backups/')) {
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: process.env.S3_REGION || 'auto', endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } });
  const r = await s3.send(new GetObjectCommand({ Bucket: process.env.BACKUP_S3_BUCKET, Key: src }));
  buf = Buffer.from(await r.Body.transformToByteArray());
} else buf = readFileSync(src);
if (buf.subarray(0, 5).toString() !== 'WOSB1') throw new Error('백업 파일 형식이 아닙니다');
const salt = buf.subarray(5, 21), iv = buf.subarray(21, 33), tag = buf.subarray(33, 49), data = buf.subarray(49);
const d = createDecipheriv('aes-256-gcm', scryptSync(pass, salt, 32), iv);
d.setAuthTag(tag);
const dump = Buffer.concat([d.update(data), d.final()]);
const tmp = path.join(mkdtempSync(path.join(tmpdir(), 'wos-')), 'db.dump');
writeFileSync(tmp, dump);
execFileSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--dbname', target, tmp], { stdio: 'inherit' });
console.log('복원 완료');
