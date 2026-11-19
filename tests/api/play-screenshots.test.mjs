// scripts/play-screenshots.mjs 를 가짜 Google Play 서버로 시험(로컬 11/19 요청: 스토어 스크린샷을 API 로 교체 — 실제 Play 호출은 대표 승인 뒤 로컬이 Actions 에서)
// ⓐ plan: 읽기만 — 지금 장과 올릴 파일을 견줘 보고, 수정 묶음을 버림(지우기·올리기·반영 없음)
// ⓑ apply: 모두 지우기 → 파일 이름 순서대로 올리기 → 반영(commit) · 서비스 계정 서명(RS256)·권한 범위 확인
// ⓒ 다시 apply: 이미 같은 장이면 아무것도 안 함 ⓓ 올리다 실패하면 반영하지 않고 묶음을 버림(스토어 그대로)
// ⓔ 자동으로 검토에 못 보내는 앱이면 changesNotSentForReview 로 다시 반영하고 안내 ⓕ 파일이 규칙에 안 맞으면 API 를 부르지 않음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 3292; const ROOT = `http://localhost:${PORT}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = JSON.stringify({ client_email: 'play-test@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: `${ROOT}/token` });
const DIR = 'docs/handoff/store/v5-general';
const LOCAL = readdirSync(DIR).filter((f) => /^play-\d+\.png$/.test(f)).sort().map((f) => createHash('sha256').update(readFileSync(path.join(DIR, f))).digest('hex'));
let srv; const calls = []; let st;
const fresh = () => ({ store: ['old1', 'old2', 'old3', 'old4', 'old5', 'old6', 'old7'], edits: new Map(), n: 0, tokens: 0, failUploadAt: 0, needNoReview: false, uploads: 0 });
function handle(req, res, body) {
  const u = new URL(req.url, ROOT); const p = u.pathname; const m = req.method;
  res.setHeader('content-type', 'application/json');
  const send = (o, s = 200) => { res.statusCode = s; res.end(JSON.stringify(o)); };
  if (m === 'POST' && p === '/token') {
    const f = new URLSearchParams(body.toString()); const [h, c, sig] = (f.get('assertion') ?? '').split('.');
    const claim = JSON.parse(Buffer.from(c ?? '', 'base64url').toString() || '{}');
    const ok = f.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer' && createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig ?? '', 'base64url'))
      && claim.scope === 'https://www.googleapis.com/auth/androidpublisher' && claim.iss === 'play-test@example.iam.gserviceaccount.com';
    st.tokens++;
    return ok ? send({ access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer' }) : send({ error: 'invalid_grant' }, 400);
  }
  calls.push(`${m} ${p.replace('/upload/androidpublisher/v3', 'UP').replace('/androidpublisher/v3', '')}${u.search}`);
  if (req.headers.authorization !== 'Bearer tok-1') return send({ error: { message: 'unauthorized' } }, 401);
  const base = '/applications/kr.co.dagym.workos/edits'; const q = p.replace('/upload/androidpublisher/v3', '').replace('/androidpublisher/v3', '');
  if (m === 'POST' && q === base) { const id = `e${++st.n}`; st.edits.set(id, { images: [...st.store] }); return send({ id, expiryTimeSeconds: '9999999999' }); }
  const mm = q.match(new RegExp(`^${base}/(e\\d+)(.*)$`)); const ed = mm && st.edits.get(mm[1]);
  if (!ed) return send({ error: { message: 'edit not found' } }, 404);
  const rest = mm[2];
  if (rest === '/listings/ko-KR/phoneScreenshots') {
    if (m === 'GET') return send({ images: ed.images.map((sha256, i) => ({ id: `i${i}`, sha256, url: 'https://example.invalid/x' })) });
    if (m === 'DELETE') { const deleted = ed.images.map((sha256, i) => ({ id: `i${i}`, sha256 })); ed.images = []; return send({ deleted }); }
    if (m === 'POST' && p.startsWith('/upload/')) {
      st.uploads++;
      if (st.failUploadAt && st.uploads === st.failUploadAt) return send({ error: { message: 'backend error' } }, 500);
      assert.equal(u.searchParams.get('uploadType'), 'media'); assert.equal(req.headers['content-type'], 'image/png');
      const sha256 = createHash('sha256').update(body).digest('hex'); ed.images.push(sha256);
      return send({ image: { id: `n${ed.images.length}`, sha256 } });
    }
  }
  if (m === 'POST' && rest === ':commit') {
    if (st.needNoReview && u.searchParams.get('changesNotSentForReview') !== 'true') return send({ error: { message: 'Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true.' } }, 400);
    st.store = [...ed.images]; st.edits.delete(mm[1]); return send({ id: mm[1] });
  }
  if (m === 'DELETE' && rest === '') { st.edits.delete(mm[1]); res.statusCode = 204; return res.end(''); }
  send({ error: { message: `not handled ${m} ${q}` } }, 404);
}
const run = (extra = {}) => new Promise((resolve) => {
  calls.length = 0;
  execFile(process.execPath, ['scripts/play-screenshots.mjs'], { env: { ...process.env, PLAY_SERVICE_ACCOUNT_JSON: SA, PLAY_API_BASE: `${ROOT}/androidpublisher/v3`, PLAY_UPLOAD_BASE: `${ROOT}/upload/androidpublisher/v3`, MODE: 'plan', ...extra } },
    (err, stdout, stderr) => resolve({ code: err ? err.code ?? 1 : 0, out: `${stdout}\n${stderr}` }));
});
before(async () => {
  st = fresh();
  srv = http.createServer((req, res) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { try { handle(req, res, Buffer.concat(chunks)); } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: { message: String(e.message) } })); } }); });
  await new Promise((r) => srv.listen(PORT, r));
});
after(() => srv?.close());

test('plan: 읽기만 — 지금 7장과 올릴 7장을 견줘 보고하고 수정 묶음을 버림(지우기·올리기·반영 없음)', async () => {
  assert.equal(LOCAL.length, 7, '올릴 파일 7장(play-01~07.png)');
  const r = await run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /읽기만\(plan\) · 앱 kr\.co\.dagym\.workos · 언어 ko-KR · 종류 phoneScreenshots/);
  assert.match(r.out, /play-01\.png {2}1080×1920/); assert.match(r.out, /지금 등록된 장 7장/);
  assert.match(r.out, /지금 7장을 모두 지우고 7장을 올립니다\(그 가운데 0장은 지금과 같은 그림\)/); assert.match(r.out, /plan — 아무것도 바꾸지 않았습니다/);
  assert.deepEqual(calls, ['POST /applications/kr.co.dagym.workos/edits', 'GET /applications/kr.co.dagym.workos/edits/e1/listings/ko-KR/phoneScreenshots', 'DELETE /applications/kr.co.dagym.workos/edits/e1']);
  assert.deepEqual(st.store, ['old1', 'old2', 'old3', 'old4', 'old5', 'old6', 'old7'], '스토어 그대로'); assert.equal(st.edits.size, 0, '묶음을 남기지 않음');
  assert.ok(!r.out.includes('BEGIN PRIVATE KEY') && !r.out.includes('tok-1'), '키·토큰을 출력하지 않음');
});

test('apply: 모두 지우기 → 이름 순서대로 7장 올리기 → 확인 → 반영 · 다시 돌리면 바꿀 것 없음', async () => {
  const r = await run({ MODE: 'apply' });
  assert.equal(r.code, 0, r.out);
  const L = '/applications/kr.co.dagym.workos/edits/e2/listings/ko-KR/phoneScreenshots';
  assert.deepEqual(calls, ['POST /applications/kr.co.dagym.workos/edits', `GET ${L}`, `DELETE ${L}`, ...Array(7).fill(`POST UP${L}?uploadType=media`), `GET ${L}`, 'POST /applications/kr.co.dagym.workos/edits/e2:commit']);
  assert.deepEqual(st.store, LOCAL, '스토어 = 올린 7장, 파일 이름 순서'); assert.match(r.out, /반영했습니다\(commit\)/);
  const again = await run({ MODE: 'apply' });
  assert.equal(again.code, 0, again.out); assert.match(again.out, /이미 같은 장이 같은 순서로 등록돼 있습니다 — 바꿀 것 없음/);
  assert.ok(!calls.some((c) => /commit|UP\/|DELETE .*phoneScreenshots/.test(c)), '지우기·올리기·반영 없음'); assert.equal(st.edits.size, 0);
});

test('올리다 실패하면 반영하지 않고 묶음을 버림 — 스토어는 그대로', async () => {
  st = fresh(); st.failUploadAt = 3;
  const r = await run({ MODE: 'apply' });
  assert.equal(r.code, 1); assert.match(r.out, /스토어는 바뀌지 않았습니다/);
  assert.ok(!calls.some((c) => c.includes(':commit')), '반영(commit) 안 함'); assert.ok(calls.at(-1).startsWith('DELETE /applications/kr.co.dagym.workos/edits/e1'), '묶음 버림');
  assert.deepEqual(st.store, ['old1', 'old2', 'old3', 'old4', 'old5', 'old6', 'old7']); assert.equal(st.edits.size, 0);
});

test('자동으로 검토에 보낼 수 없는 앱: changesNotSentForReview 로 다시 반영하고 Play Console 에서 보내라고 안내', async () => {
  st = fresh(); st.needNoReview = true;
  const r = await run({ MODE: 'apply' });
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(calls.slice(-2), ['POST /applications/kr.co.dagym.workos/edits/e1:commit', 'POST /applications/kr.co.dagym.workos/edits/e1:commit?changesNotSentForReview=true']);
  assert.match(r.out, /\[검토를 위해 변경사항 보내기\]를 눌러야 반영됩니다/); assert.deepEqual(st.store, LOCAL);
});

test('파일이 Play 규칙에 안 맞으면(1장뿐 · 사진 아님) API 를 부르지 않음 · 키가 없으면 바로 멈춤', async () => {
  st = fresh();
  const dir = mkdtempSync(path.join(tmpdir(), 'play-shots-'));
  writeFileSync(path.join(dir, 'play-01.png'), readFileSync(path.join(DIR, 'play-01.png')));
  const one = await run({ MODE: 'apply', SHOTS_DIR: dir });
  assert.equal(one.code, 1); assert.match(one.out, /장 수 1 — 2~8장이어야 합니다/); assert.deepEqual(calls, []); assert.equal(st.tokens, 0);
  writeFileSync(path.join(dir, 'play-02.png'), 'not an image');
  const bad = await run({ MODE: 'apply', SHOTS_DIR: dir });
  assert.equal(bad.code, 1); assert.match(bad.out, /play-02\.png: PNG·JPEG 가 아닙니다/); assert.deepEqual(calls, []);
  const nokey = await run({ PLAY_SERVICE_ACCOUNT_JSON: '' });
  assert.equal(nokey.code, 2); assert.match(nokey.out, /PLAY_SERVICE_ACCOUNT_JSON 이 필요합니다/);
});
