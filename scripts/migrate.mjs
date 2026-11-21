// 사용법: DATABASE_URL=... node scripts/migrate.mjs [--soft-connect]
// --soft-connect (Vercel 빌드 명령): DB 에 접속조차 못 하면(쿼터 초과·장애) 경고만 남기고 0 으로 끝내 빌드를 막지 않는다.
//   DB 장애 중에도 핫픽스 배포가 되게 하려는 것. 마이그레이션 SQL 자체가 실패하면 그대로 실패(빌드 중단).
//   건너뛰면 /api/health 의 migrationBehind 가 true — DB 가 돌아온 뒤 다시 배포(Redeploy)하거나 `npm run db:migrate`.
import postgres from 'postgres';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 11/21(로컬 확인): Vercel 환경 변수 DATABASE_URL 이 'Preview, Production' 한 항목 — Preview 빌드도 운영 DB 를 본다.
// 빌드 명령(vercel.json)이 이 스크립트를 먼저 돌리므로, Vercel 빌드는 운영(VERCEL_ENV=production)일 때만 마이그레이션을 적용한다
// → main 에 들어가지 않은 브랜치의 마이그레이션이 Preview 빌드로 운영 DB 에 들어가지 않게. Vercel 이 아닌 곳(로컬·CI·시험)은 그대로.
// VERCEL_ENV 가 비어 있으면 운영인지 알 수 없으므로 건너뜀(운영이었다면 /api/health 의 migrationBehind 가 true 로 드러남 → Redeploy 또는 npm run db:migrate).
if (process.env.VERCEL === '1' && process.env.VERCEL_ENV !== 'production') {
  console.log(`[migrate] Vercel ${process.env.VERCEL_ENV || '환경 모름'} 빌드 — 운영 배포가 아니라 마이그레이션을 건너뜁니다(Preview 가 운영 DB 를 함께 쓰므로).`);
  process.exit(0);
}

const url = process.env.DATABASE_URL;
const soft = process.argv.includes('--soft-connect');
if (!url) { console.error('DATABASE_URL 이 없습니다'); process.exit(soft ? 0 : 1); }
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 15 });
// Windows 에서도 동작하도록 fileURLToPath 사용 (URL.pathname 은 /C:/... 를 돌려줌)
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

/** 접속·기록표 준비. 실패하면 soft 일 때 null(건너뜀), 아니면 그대로 던짐 */
async function applied() {
  try {
    await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    return new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  } catch (e) {
    if (!soft) throw e;
    console.warn(`[migrate] 경고: DB 에 접속하지 못해 마이그레이션을 건너뜁니다 — 빌드는 계속합니다. (${e.code ?? ''} ${e.message})`);
    console.warn('[migrate] DB 가 돌아오면 다시 배포하거나 npm run db:migrate 로 적용하세요. /api/health 의 migrationBehind 로 확인할 수 있습니다.');
    return null;
  }
}

try {
  const done = await applied();
  if (done) {
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
  }
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
