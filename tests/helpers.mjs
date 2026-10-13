import { spawn, execFileSync } from 'node:child_process';
import postgres from 'postgres';
import webpush from 'web-push';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// Windows·Linux 공통: 임시 폴더는 OS 기본값, Node·Next 는 경로 대신 실행 파일로 직접 호출
const TMP = path.join(tmpdir(), 'workos-test');
const NEXT_BIN = createRequire(import.meta.url).resolve('next/dist/bin/next');

export const PORT = Number(process.env.TEST_PORT ?? 3101);
export const BASE = `http://localhost:${PORT}`;
export const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://workos:workos@localhost:5432/workos_test';
export const FAKE = 'http://localhost:3199';

export async function resetDb() {
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  await sql.unsafe('drop schema public cascade; create schema public;');
  await sql.end();
  execFileSync(process.execPath, ['scripts/migrate.mjs'], { env: { ...process.env, DATABASE_URL: DB_URL }, stdio: 'pipe' });
}

export function testDb() {
  return postgres(DB_URL, { max: 2, onnotice: () => {}, types: { date: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x } } });
}

export function serverEnv() {
  const vapid = webpush.generateVAPIDKeys();
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    DATABASE_URL: DB_URL,
    APP_URL: BASE,
    APP_SECRET: 'test-secret-test-secret-test-secret-123',
    SETUP_SECRET: 'setup-test',
    CRON_SECRET: 'cron-test-secret',
    GOOGLE_CLIENT_ID: 'fake-client',
    GOOGLE_CLIENT_SECRET: 'fake-secret',
    GOOGLE_API_BASE: `${FAKE}/calendar/v3`,
    GOOGLE_OAUTH_BASE: FAKE,
    GOOGLE_AUTH_URL: `${FAKE}/auth`,
    GOOGLE_WEBHOOK_URL: `${BASE}/api/google/webhook`,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:test@example.com',
    FCM_API_BASE: FAKE,
    FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'fake-proj', client_email: 'svc@fake.iam', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `${FAKE}/token` }),
    LOCAL_UPLOAD_DIR: path.join(TMP, 'uploads'),
    OPENAI_API_KEY: 'sk-fake-test',
    PIGGYBACK_TICK: '0', // 요청 편승 정기 실행은 tests/api/piggyback.test.mjs 에서만 켬 (다른 시험의 실행 횟수가 흔들리지 않게)
    DUE_DIGEST_HOUR: '0', // 기한 지남·오늘 마감 하루 1회 알림을 시험 시각과 무관하게
    OPENAI_BASE_URL: `${FAKE}/openai/v1`,
    ANTHROPIC_API_KEY: 'sk-ant-fake-test',
    ANTHROPIC_BASE_URL: FAKE,
    AI_MONTHLY_BUDGET_USD: '30',
  };
}

export const TLS_DIR = path.join(TMP, 'tls');
/** 가짜 웹 푸시용 자체 서명 인증서 (테스트 서버 프로세스만 신뢰) */
export async function ensureTls() {
  mkdirSync(TLS_DIR, { recursive: true });
  if (!existsSync(`${TLS_DIR}/cert.pem`)) {
    // openssl 없이(Windows 포함) 자체 서명 인증서 생성
    const { generate } = await import('selfsigned');
    const pems = await generate([{ name: 'commonName', value: 'localhost' }], { days: 30, keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }] });
    writeFileSync(`${TLS_DIR}/key.pem`, pems.private);
    writeFileSync(`${TLS_DIR}/cert.pem`, pems.cert);
  }
  const bundle = `${TLS_DIR}/bundle.pem`;
  writeFileSync(bundle, (process.env.NODE_EXTRA_CA_CERTS && existsSync(process.env.NODE_EXTRA_CA_CERTS) ? readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf8') + '\n' : '') + readFileSync(`${TLS_DIR}/cert.pem`, 'utf8'));
  process.env.FAKE_TLS_KEY = `${TLS_DIR}/key.pem`;
  process.env.FAKE_TLS_CERT = `${TLS_DIR}/cert.pem`;
  return bundle;
}
export const FAKE_TLS = 'https://localhost:3200';

export async function startServer(extraEnv = {}) {
  const env = { ...process.env, ...serverEnv(), ...extraEnv, NODE_ENV: 'production', PORT: String(PORT), NODE_EXTRA_CA_CERTS: await ensureTls() };
  const proc = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return { proc, log: () => log }; } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  proc.kill();
  throw new Error('server did not start\n' + log);
}

/** 쿠키를 유지하는 간단한 HTTP 클라이언트 */
export class Client {
  constructor(name = '') { this.cookie = ''; this.name = name; }
  async req(method, path, body, headers = {}) {
    const h = { ...headers, origin: BASE };
    if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const sc = res.headers.getSetCookie?.() ?? [];
    for (const c of sc) {
      const [kv] = c.split(';');
      if (kv.startsWith('wos_session=')) this.cookie = kv.endsWith('=') ? '' : kv;
    }
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }
  get(p) { return this.req('GET', p); }
  post(p, b = {}, h) { return this.req('POST', p, b, h); }
  patch(p, b) { return this.req('PATCH', p, b); }
  del(p) { return this.req('DELETE', p); }
  async ok(method, path, body, headers) {
    const r = await this.req(method, path, body, headers);
    if (r.status >= 400) throw new Error(`${this.name} ${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

export async function tick() {
  const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } });
  return r.json();
}

/** 대표 + 조직 + 직원 기본 구성 */
export async function bootstrap() {
  const owner = new Client('owner');
  await owner.ok('POST', '/api/setup', { secret: 'setup-test', email: 'ceo@dagym.test', name: '김대표', password: 'owner-pass-1234' });
  const hq = '00000000-0000-0000-0000-000000000001';
  const siteA = (await owner.ok('POST', '/api/admin/org-units', { name: '다짐 강남점', type: 'branch', parentId: hq, brandId: 'dagym' })).id;
  const siteB = (await owner.ok('POST', '/api/admin/org-units', { name: '하이링크 판교 위탁현장', type: 'site', parentId: hq, brandId: 'hilink' })).id;
  const users = {};
  for (const [key, name, role, unit] of [['staffA', '이직원', 'staff', siteA], ['staffB', '박직원', 'staff', siteB], ['managerA', '최매니저', 'site_manager', siteA]]) {
    const inv = await owner.ok('POST', '/api/admin/users', { email: `${key}@dagym.test`, name, role, orgUnitIds: [unit] });
    const c = new Client(key);
    const token = inv.path.split('/').pop();
    await c.ok('POST', `/api/invitations/${token}/accept`, { password: `${key}-pass-1234` });
    const me = await c.ok('GET', '/api/auth/me');
    users[key] = { client: c, id: me.user.id, email: `${key}@dagym.test`, password: `${key}-pass-1234` };
  }
  const meOwner = await owner.ok('GET', '/api/auth/me');
  return { owner, ownerId: meOwner.user.id, hq, siteA, siteB, ...users };
}

export function seoulToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}
export function addDays(d, n) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
