// 사용법: DATABASE_URL=... node scripts/migrate.mjs
import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL 이 없습니다'); process.exit(1); }
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
// Windows 에서도 동작하도록 fileURLToPath 사용 (URL.pathname 은 /C:/... 를 돌려줌)
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

try {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const body = await readFile(path.join(dir, f), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${f})`;
    });
    console.log('applied', f);
  }
  console.log('migrations up to date');
} finally {
  await sql.end();
}
