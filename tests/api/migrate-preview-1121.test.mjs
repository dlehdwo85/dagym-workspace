// 11/21(로컬 확인): Vercel 의 DATABASE_URL 이 Preview·Production 한 항목 — Preview 빌드도 운영 DB 를 본다.
// 빌드 명령(vercel.json)이 scripts/migrate.mjs 를 먼저 돌리므로, Vercel 빌드는 운영(VERCEL_ENV=production)일 때만 DB 에 접속하고 Preview·환경 모름은 접속 전에 건너뛴다.
// Vercel 이 아닌 곳(로컬·CI·시험)은 예전 그대로. 마이그레이션을 다시 돌리지 않고 확인하려고, 닿지 않는 DB 주소로 '접속을 시도했는지'(실패 코드)를 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { DB_URL } from '../helpers.mjs';

const NOWHERE = 'postgres://nobody:nothing@127.0.0.1:1/none'; // 닿지 않는 주소 — 접속을 시도하면 실패
const run = (env, args = []) => new Promise((resolve) => execFile(process.execPath, ['scripts/migrate.mjs', ...args], { env: { PATH: process.env.PATH, ...env }, timeout: 60_000 }, (e, out, err) => resolve({ code: e ? (e.code ?? 1) : 0, out: out + err })));

test('Vercel Preview·개발·환경 모름: DB 에 접속하지 않고 건너뜀(0) — 운영 DB 를 건드리지 않음', async () => {
  for (const env of [{ VERCEL: '1', VERCEL_ENV: 'preview' }, { VERCEL: '1', VERCEL_ENV: 'development' }, { VERCEL: '1' }]) {
    const r = await run({ ...env, DATABASE_URL: NOWHERE });
    assert.equal(r.code, 0, `${JSON.stringify(env)}: ${r.out}`); assert.match(r.out, /운영 배포가 아니라 마이그레이션을 건너뜁니다/);
    assert.doesNotMatch(r.out, /ECONNREFUSED|applied|up to date/, '접속하지 않음');
  }
});

test('Vercel 운영 빌드·Vercel 밖(로컬·CI·시험): 예전 그대로 접속해 적용', async () => {
  for (const env of [{ VERCEL: '1', VERCEL_ENV: 'production' }, {}]) {
    const bad = await run({ ...env, DATABASE_URL: NOWHERE });
    assert.notEqual(bad.code, 0, `${JSON.stringify(env)}: 접속을 시도함(닿지 않는 주소라 실패) — ${bad.out.slice(0, 200)}`);
    assert.doesNotMatch(bad.out, /건너뜁니다\(Preview/);
    const ok = await run({ ...env, DATABASE_URL: DB_URL }, ['--soft-connect']);
    assert.equal(ok.code, 0, ok.out); assert.match(ok.out, /migrations up to date/);
  }
});
