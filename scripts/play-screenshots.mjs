// Google Play 스토어 등록정보의 스크린샷 교체 — GitHub Actions(play-screenshots.yml)에서만 실행(키는 Secrets).
// 배경: 대표 11/14 #1047 새 스크린샷(docs/handoff/store/v5-general/play-01~07.png) · 로컬 11/19 "Play Console 자동 조작 실패 → API 워크플로 요청".
//
// MODE=plan  읽기만. 지금 등록된 장(개수·체크섬)과 올릴 파일을 견줘 무엇이 바뀌는지 보고하고, 만든 수정 묶음(edit)은 버린다. 스토어는 그대로.
// MODE=apply 수정 묶음 안에서 그 언어·종류의 스크린샷을 모두 지우고 → 파일 이름 순서대로 올리고 → 올린 장의 체크섬을 확인한 뒤 commit.
//            하나라도 실패하면 commit 하지 않고 묶음을 버린다(스토어는 그대로). 이미 같은 장이 같은 순서로 있으면 아무것도 하지 않는다(다시 돌려도 같음).
//            commit 이 "자동으로 검토에 보낼 수 없음"으로 막히면 changesNotSentForReview=true 로 다시 commit — 이때는 Play Console 에서 [검토를 위해 변경사항 보내기]를 눌러야 반영된다.
// 공개 스토어 화면이 바뀌는 일이라 apply 는 대표 승인 뒤 로컬이 실행한다. 키 값은 출력하지 않는다.
// 외부 패키지 없음(Node 22 fetch + node:crypto RS256). 시험은 가짜 서버(tests/api/play-screenshots.test.mjs — PLAY_API_BASE · PLAY_UPLOAD_BASE · PLAY_TOKEN_URL).
// API: androidpublisher v3 edits.images(list · deleteall · upload) · edits(insert · commit · delete) — 공식 discovery 문서로 주소 확인(2026-11-20).
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const env = (k, d) => (process.env[k] ?? d);
const MODE = env('MODE', 'plan');
const PKG = env('PACKAGE_NAME', 'kr.co.dagym.workos');
const LANG = env('LANGUAGE', 'ko-KR');
const TYPE = env('IMAGE_TYPE', 'phoneScreenshots');
const DIR = env('SHOTS_DIR', 'docs/handoff/store/v5-general');
const PREFIX = env('FILE_PREFIX', 'play-');
const SA = env('PLAY_SERVICE_ACCOUNT_JSON', '');
const API = env('PLAY_API_BASE', 'https://androidpublisher.googleapis.com/androidpublisher/v3');
const UPLOAD = env('PLAY_UPLOAD_BASE', 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3');
const TYPES = ['phoneScreenshots', 'sevenInchScreenshots', 'tenInchScreenshots'];
const fail = (m, code = 1) => { console.error(`실패: ${m}`); process.exit(code); };
if (!['plan', 'apply'].includes(MODE)) fail(`MODE 는 plan 또는 apply 입니다(받은 값: ${MODE})`, 2);
if (!TYPES.includes(TYPE)) fail(`IMAGE_TYPE 은 ${TYPES.join(' · ')} 가운데 하나입니다`, 2);
if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(LANG)) fail(`LANGUAGE 모양이 맞지 않습니다(예: ko-KR)`, 2);
if (!SA) fail('PLAY_SERVICE_ACCOUNT_JSON 이 필요합니다(Secrets)', 2);
let sa; try { sa = JSON.parse(SA); } catch { fail('PLAY_SERVICE_ACCOUNT_JSON 을 읽지 못했습니다(JSON 아님)', 2); }
if (!sa.client_email || !sa.private_key) fail('서비스 계정 JSON 에 client_email · private_key 가 없습니다', 2);
const TOKEN_URL = env('PLAY_TOKEN_URL', sa.token_uri || 'https://oauth2.googleapis.com/token');

// ---------- 올릴 파일 ----------
/** PNG·JPEG 의 가로·세로(헤더만 읽음) */
function sizeOf(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), mime: 'image/png' };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), mime: 'image/jpeg' };
      i += 2 + len;
    }
  }
  return null;
}
const files = readdirSync(DIR).filter((f) => f.startsWith(PREFIX) && /\.(png|jpe?g)$/i.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const shots = files.map((name) => {
  const buf = readFileSync(path.join(DIR, name)); const s = sizeOf(buf);
  return { name, buf, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), ...(s ?? { w: 0, h: 0, mime: '' }) };
});
/** Play 규칙(휴대전화·태블릿 스크린샷): 2~8장 · PNG/JPEG · 한 변 320~3840px · 긴 변이 짧은 변의 2배 이하 · 장당 8MB 이하 */
function problems() {
  const out = [];
  if (shots.length < 2 || shots.length > 8) out.push(`장 수 ${shots.length} — 2~8장이어야 합니다(${DIR}/${PREFIX}*.png)`);
  for (const s of shots) {
    if (!s.mime) { out.push(`${s.name}: PNG·JPEG 가 아닙니다`); continue; }
    const lo = Math.min(s.w, s.h), hi = Math.max(s.w, s.h);
    if (lo < 320 || hi > 3840) out.push(`${s.name}: ${s.w}×${s.h} — 한 변이 320~3840px 이어야 합니다`);
    if (hi > lo * 2) out.push(`${s.name}: ${s.w}×${s.h} — 긴 변이 짧은 변의 2배를 넘습니다`);
    if (s.bytes > 8 * 1024 * 1024) out.push(`${s.name}: ${(s.bytes / 1048576).toFixed(1)}MB — 8MB 이하여야 합니다`);
  }
  return out;
}

// ---------- 인증(서비스 계정 → 접근 토큰) ----------
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
let tokenCache = null;
async function token() {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.value;
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), createPrivateKey(sa.private_key));
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${b64u(sig)}` }), signal: AbortSignal.timeout(30_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`토큰 발급 실패(${r.status}) ${String(j.error_description ?? j.error ?? '').slice(0, 200)}`);
  tokenCache = { value: j.access_token, exp: now + Number(j.expires_in ?? 3600) };
  return tokenCache.value;
}
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function call(method, url, { body, type } = {}) {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${await token()}`, ...(type ? { 'content-type': type } : {}) }, body, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* 글자 그대로 */ }
  if (!r.ok) throw new ApiError(r.status, `${method} ${new URL(url).pathname.split('/applications/')[1] ?? ''} → ${r.status} ${String(j?.error?.message ?? text).slice(0, 300)}`);
  return j ?? {};
}
const app = `${API}/applications/${encodeURIComponent(PKG)}`;
const listing = (editId) => `/edits/${editId}/listings/${encodeURIComponent(LANG)}/${TYPE}`;

// ---------- 실행 ----------
const line = (s) => console.log(s);
async function main() {
  line(`Google Play 스크린샷 — ${MODE === 'plan' ? '읽기만(plan)' : '바꾸기(apply)'} · 앱 ${PKG} · 언어 ${LANG} · 종류 ${TYPE}`);
  line(`올릴 파일 ${shots.length}장(${DIR}/${PREFIX}*):`);
  for (const s of shots) line(`  ${s.name}  ${s.w}×${s.h}  ${(s.bytes / 1024).toFixed(0)}KB  ${s.sha256.slice(0, 12)}`);
  const bad = problems();
  if (bad.length) { for (const b of bad) line(`  ✖ ${b}`); fail('올릴 파일이 Play 규칙에 맞지 않습니다 — 아무것도 바꾸지 않았습니다'); }

  const edit = await call('POST', `${app}/edits`, { body: '{}', type: 'application/json' });
  if (!edit.id) throw new Error('수정 묶음을 만들지 못했습니다');
  let committed = false;
  try {
    const cur = (await call('GET', `${app}${listing(edit.id)}`)).images ?? [];
    line(`지금 등록된 장 ${cur.length}장:`);
    cur.forEach((im, i) => line(`  ${i + 1}. ${String(im.sha256 ?? '').slice(0, 12)}`));
    const same = cur.length === shots.length && cur.every((im, i) => String(im.sha256 ?? '').toLowerCase() === shots[i].sha256);
    if (same) { line('결과: 이미 같은 장이 같은 순서로 등록돼 있습니다 — 바꿀 것 없음'); return; }
    const keep = shots.filter((s) => cur.some((im) => String(im.sha256 ?? '').toLowerCase() === s.sha256)).length;
    line(`바뀌는 것: 지금 ${cur.length}장을 모두 지우고 ${shots.length}장을 올립니다(그 가운데 ${keep}장은 지금과 같은 그림)`);
    if (MODE === 'plan') { line('결과: plan — 아무것도 바꾸지 않았습니다(apply 는 대표 승인 뒤)'); return; }

    await call('DELETE', `${app}${listing(edit.id)}`);
    for (const s of shots) {
      const r = await call('POST', `${UPLOAD}/applications/${encodeURIComponent(PKG)}${listing(edit.id)}?uploadType=media`, { body: s.buf, type: s.mime });
      const got = String(r.image?.sha256 ?? '').toLowerCase();
      if (got && got !== s.sha256) throw new Error(`${s.name}: 올린 뒤 체크섬이 다릅니다(보낸 ${s.sha256.slice(0, 12)} · 받은 ${got.slice(0, 12)})`);
      line(`  올림 ${s.name}`);
    }
    const after = (await call('GET', `${app}${listing(edit.id)}`)).images ?? [];
    if (after.length !== shots.length) throw new Error(`올린 뒤 장 수가 다릅니다(${after.length}/${shots.length})`);
    try { await call('POST', `${app}/edits/${edit.id}:commit`); line('결과: 반영했습니다(commit) — 스토어에 보이기까지 Google 검토 시간이 걸릴 수 있습니다'); }
    catch (e) {
      if (!(e instanceof ApiError) || !/changesNotSentForReview/i.test(e.message)) throw e;
      await call('POST', `${app}/edits/${edit.id}:commit?changesNotSentForReview=true`);
      line('결과: 저장했습니다(commit) — 자동으로 검토에 보내지지 않는 앱입니다. Play Console › 게시 개요에서 [검토를 위해 변경사항 보내기]를 눌러야 반영됩니다');
    }
    committed = true;
  } finally {
    // plan · 바꿀 것 없음 · 실패: 수정 묶음을 버린다(commit 한 묶음은 이미 닫혀 있음)
    if (!committed) await call('DELETE', `${app}/edits/${edit.id}`).catch(() => {});
  }
}
main().catch((e) => fail(`${e.message} — 스토어는 바뀌지 않았습니다(수정 묶음을 버림)`));
