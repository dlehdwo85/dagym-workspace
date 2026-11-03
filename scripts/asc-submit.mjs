// 351차 #947(대표 11/04 '아이폰 앱 정상 출시를 서둘러 달라'): App Store Connect API 로 1.2.0 재제출 준비·제출 — GitHub Actions(appstore-submit.yml)에서만 실행(키는 Secrets).
// 하는 일(MODE=apply): ⓐ 반려된 iOS 버전의 버전 문자열 → VERSION ⓑ 빌드 BUILD(1.2.0) 지정 ⓒ 설명·키워드(WORKIN_STORE_LISTING.md) ⓓ 심사 메모(review-notes.md + 기존 메모의 권한·계정 삭제·개인정보 줄 유지, 요금·무료 줄 제거)
// ⓔ 6.9형 스크린샷 교체(ios-v4/iphone-01..06.png) ⓕ SUBMIT=1 이면 심사 제출. MODE=plan 은 읽기만(무엇을 바꿀지 보고). 비밀번호·키는 절대 출력하지 않는다.
// 외부 패키지 없음(Node 22 fetch + node:crypto ES256). 참고: 6.9형 슬롯의 API 이름은 APP_IPHONE_67(애플이 6.7형 슬롯을 6.9형으로 넓힘) — 다르면 DISPLAY_TYPE 으로 바꿈.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const env = (k, d) => (process.env[k] ?? d);
const KEY_ID = env('ASC_KEY_ID', ''), ISSUER = env('ASC_ISSUER_ID', ''), P8 = env('ASC_KEY_P8', '');
const BUNDLE = env('BUNDLE_ID', 'kr.co.dagym.workos');
const VERSION = env('VERSION', '1.2.0'), BUILD = env('BUILD', '13');
const MODE = env('MODE', 'plan'); const SUBMIT = env('SUBMIT', '0') === '1';
const DISPLAY = env('DISPLAY_TYPE', 'APP_IPHONE_67');
const LOCALE = env('LOCALE', 'ko');
const SHOTS_DIR = env('SHOTS_DIR', 'docs/handoff/store/ios-v4');
const LISTING = env('LISTING', 'docs/handoff/WORKIN_STORE_LISTING.md');
const NOTES_FILE = env('NOTES_FILE', 'docs/handoff/store/ios-v4/review-notes.md');
const WHATS_NEW = env('WHATS_NEW', '');
const API = 'https://api.appstoreconnect.apple.com/v1';
if (!KEY_ID || !ISSUER || !P8) { console.error('ASC_KEY_ID · ASC_ISSUER_ID · ASC_KEY_P8 가 필요합니다(Secrets)'); process.exit(2); }

// ---------- JWT(ES256, 15분) ----------
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
let tokenCache = null;
function token() {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 60 > now) return tokenCache.jwt;
  const exp = now + 15 * 60;
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: ISSUER, iat: now, exp, aud: 'appstoreconnect-v1' }));
  const key = createPrivateKey({ key: P8.includes('BEGIN') ? P8 : `-----BEGIN PRIVATE KEY-----\n${P8}\n-----END PRIVATE KEY-----`, format: 'pem' });
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  tokenCache = { jwt: `${head}.${body}.${b64u(sig)}`, exp };
  return tokenCache.jwt;
}
async function api(method, url, body, opts = {}) {
  const full = url.startsWith('http') ? url : `${API}${url}`;
  const r = await fetch(full, { method, headers: { authorization: `Bearer ${token()}`, ...(body ? { 'content-type': 'application/json' } : {}), ...(opts.headers ?? {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* 빈 응답 */ }
  if (!r.ok) {
    const msg = json?.errors?.map((e) => `${e.status} ${e.code}: ${e.title} — ${e.detail ?? ''}`).join(' | ') ?? text.slice(0, 300);
    throw new Error(`${method} ${url} → ${r.status} ${msg}`);
  }
  return json;
}
const all = async (url) => { const out = []; let next = url; while (next) { const j = await api('GET', next); out.push(...(j.data ?? [])); next = j.links?.next ?? null; } return out; };
const log = (...a) => console.log(...a);
const plan = MODE !== 'apply';
const act = async (what, fn) => { if (plan) { log(`  [계획] ${what}`); return null; } log(`  [실행] ${what}`); return fn(); };

// ---------- 등록 정보 파일 ----------
function section(md, heading) {
  const lines = md.split('\n'); const i = lines.findIndex((l) => l.startsWith(heading)); if (i < 0) return '';
  const out = []; for (let k = i + 1; k < lines.length; k++) { if (lines[k].startsWith('## ')) break; out.push(lines[k]); }
  return out.join('\n').trim();
}
const listing = readFileSync(LISTING, 'utf8');
const description = section(listing, '## 자세한 설명');
const keywords = section(listing, '## App Store 키워드').split('\n')[0].trim();
const newNotes = (() => { try { return readFileSync(NOTES_FILE, 'utf8').trim(); } catch { return ''; } })();
const BAD_META = /\d[\d,]*\s*원|무료|체험|요금|가격|free|pricing|price|trial/i;
for (const [name, text] of [['설명', description], ['키워드', keywords]]) { // 심사 메모는 심사관에게 '요금 문장을 뺐다'고 설명하는 글이라 검사 대상이 아님
  const m = text.match(BAD_META); if (m) { console.error(`${name}에 요금·무료 관련 글자('${m[0]}')가 있습니다 — 2.3.7 재발 방지로 멈춤`); process.exit(3); }
}
const shots = [1, 2, 3, 4, 5, 6].map((n) => path.join(SHOTS_DIR, `iphone-${String(n).padStart(2, '0')}.png`)).filter((f) => { try { return statSync(f).size > 0; } catch { return false; } });

// ---------- 1. 앱·버전 ----------
const apps = (await api('GET', `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}`)).data;
if (!apps.length) throw new Error(`번들 ${BUNDLE} 앱이 없습니다`);
const app = apps[0]; log(`앱 ${app.attributes.name} (${app.id}) · 모드 ${MODE}${SUBMIT ? ' + 제출' : ''}`);
const versions = (await api('GET', `/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=20`)).data;
const stateOf = (v) => v.attributes.appVersionState ?? v.attributes.appStoreState ?? '?';
log('버전:'); for (const v of versions) log(`  ${v.attributes.versionString} · ${stateOf(v)} (${v.id})`);
const EDITABLE = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY', 'WAITING_FOR_REVIEW', 'READY_FOR_REVIEW']);
let ver = versions.find((v) => v.attributes.versionString === VERSION && EDITABLE.has(stateOf(v))) ?? versions.find((v) => EDITABLE.has(stateOf(v)));
if (!ver) {
  ver = await act(`새 버전 ${VERSION} 만들기(고칠 수 있는 버전 없음)`, () => api('POST', '/appStoreVersions', { data: { type: 'appStoreVersions', attributes: { platform: 'IOS', versionString: VERSION }, relationships: { app: { data: { type: 'apps', id: app.id } } } } }).then((j) => j.data));
} else if (ver.attributes.versionString !== VERSION) {
  await act(`ⓐ 버전 문자열 ${ver.attributes.versionString} → ${VERSION} (${stateOf(ver)})`, () => api('PATCH', `/appStoreVersions/${ver.id}`, { data: { type: 'appStoreVersions', id: ver.id, attributes: { versionString: VERSION } } }));
} else log(`ⓐ 버전 ${VERSION} 그대로 (${stateOf(ver)})`);
const verId = ver?.id;

// ---------- 2. 빌드 ----------
const builds = (await api('GET', `/builds?filter[app]=${app.id}&filter[version]=${encodeURIComponent(BUILD)}&filter[preReleaseVersion.version]=${encodeURIComponent(VERSION)}&sort=-uploadedDate&limit=10&fields[builds]=version,uploadedDate,processingState,expired`)).data;
log('빌드 후보:'); for (const b of builds) log(`  ${VERSION} (${b.attributes.version}) · ${b.attributes.processingState}${b.attributes.expired ? ' · 만료' : ''} · ${b.attributes.uploadedDate}`);
const build = builds.find((b) => b.attributes.processingState === 'VALID' && !b.attributes.expired);
if (build && verId) {
  const cur = await api('GET', `/appStoreVersions/${verId}/relationships/build`).catch(() => null);
  if (cur?.data?.id === build.id) log(`ⓑ 빌드 ${VERSION} (${BUILD}) 이미 지정됨`);
  else await act(`ⓑ 빌드 ${VERSION} (${BUILD}) 지정`, () => api('PATCH', `/appStoreVersions/${verId}/relationships/build`, { data: { type: 'builds', id: build.id } }));
} else log(`ⓑ 빌드 ${VERSION} (${BUILD}) 유효한 것 없음 — TestFlight 처리 뒤 다시`);

// ---------- 3. 설명·키워드 ----------
let loc = null;
if (verId) {
  const locs = (await api('GET', `/appStoreVersions/${verId}/appStoreVersionLocalizations`)).data;
  loc = locs.find((l) => l.attributes.locale === LOCALE) ?? locs[0];
  if (!loc) log(`ⓒ 언어 ${LOCALE} 등록 정보 없음`);
  else {
    const a = loc.attributes;
    log(`ⓒ 언어 ${a.locale}: 설명 ${a.description?.length ?? 0}자 → ${description.length}자 · 키워드 '${a.keywords ?? ''}' → '${keywords}'${WHATS_NEW ? ` · 새 기능 ${WHATS_NEW.length}자` : ''}`);
    const attrs = { description, keywords };
    await act('설명·키워드 바꾸기', () => api('PATCH', `/appStoreVersionLocalizations/${loc.id}`, { data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: attrs } }));
    if (WHATS_NEW) await act('새 기능(whatsNew) 적기', () => api('PATCH', `/appStoreVersionLocalizations/${loc.id}`, { data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { whatsNew: WHATS_NEW } } }).catch((e) => log(`  (첫 버전이면 새 기능 칸이 없음 — 건너뜀: ${e.message.slice(0, 120)})`)));
  }
}

// ---------- 4. 심사 메모(기존 권한·계정 삭제·개인정보 줄 유지, 요금·무료 줄 제거, 새 1.2.0 설명 앞에) ----------
if (verId) {
  const det = (await api('GET', `/appStoreVersions/${verId}/appStoreReviewDetail?fields[appStoreReviewDetails]=notes,demoAccountRequired,demoAccountName`).catch(() => ({ data: null }))).data;
  const old = det?.attributes?.notes ?? '';
  const keep = old.split('\n').filter((l) => !/무료|요금|PC 웹|free|pric|trial|1\.1\.1|1\.2\.0 changes/i.test(l)).join('\n').trim();
  const notes = [newNotes, keep].filter(Boolean).join('\n\n').slice(0, 4000);
  log(`ⓓ 심사 메모: 기존 ${old.length}자(유지 ${keep.length}자) + 새 글 ${newNotes.length}자 → ${notes.length}자 · 데모 계정 ${det?.attributes?.demoAccountName ? '있음' : '없음'}(비밀번호는 기존 칸 그대로)`);
  if (!newNotes) log('  (review-notes.md 없음 — 메모는 그대로 둠)');
  else if (det) await act('심사 메모 바꾸기(데모 계정 칸은 그대로)', () => api('PATCH', `/appStoreReviewDetails/${det.id}`, { data: { type: 'appStoreReviewDetails', id: det.id, attributes: { notes, demoAccountRequired: true } } }));
  else await act('심사 정보 새로 만들기(데모 계정은 사람이 적어야 함)', () => api('POST', '/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes: { notes, demoAccountRequired: true }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: verId } } } } }));
}

// ---------- 5. 스크린샷(6.9형) ----------
async function uploadShot(setId, file, idx) {
  const buf = readFileSync(file); const md5 = createHash('md5').update(buf).digest('hex');
  const r = (await api('POST', '/appScreenshots', { data: { type: 'appScreenshots', attributes: { fileName: `${String(idx + 1).padStart(2, '0')}-${path.basename(file)}`, fileSize: buf.length }, relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } } } })).data;
  for (const op of r.attributes.uploadOperations ?? []) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const res = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) });
    if (!res.ok) throw new Error(`스크린샷 조각 올리기 실패 ${res.status}`);
  }
  await api('PATCH', `/appScreenshots/${r.id}`, { data: { type: 'appScreenshots', id: r.id, attributes: { uploaded: true, sourceFileChecksum: md5 } } });
  for (let i = 0; i < 60; i++) {
    const st = (await api('GET', `/appScreenshots/${r.id}?fields[appScreenshots]=assetDeliveryState`)).data.attributes.assetDeliveryState?.state;
    if (st === 'COMPLETE') return r.id;
    if (st === 'FAILED') throw new Error(`스크린샷 처리 실패 ${path.basename(file)}`);
    await new Promise((f) => setTimeout(f, 3000));
  }
  throw new Error(`스크린샷 처리 대기 초과 ${path.basename(file)}`);
}
if (loc) {
  const sets = (await api('GET', `/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data;
  log(`ⓔ 스크린샷 묶음: ${sets.map((s) => s.attributes.screenshotDisplayType).join(', ') || '없음'} · 올릴 파일 ${shots.length}장(${DISPLAY})`);
  if (shots.length !== 6) log('  (iphone-01..06.png 6장이 아님 — 스크린샷은 건너뜀)');
  else {
    let set = sets.find((s) => s.attributes.screenshotDisplayType === DISPLAY);
    if (!set) set = await act(`${DISPLAY} 묶음 만들기`, () => api('POST', '/appScreenshotSets', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: DISPLAY }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } } } }).then((j) => j.data));
    if (set) {
      const olds = (await api('GET', `/appScreenshotSets/${set.id}/appScreenshots`)).data;
      log(`  기존 ${olds.length}장 → 지우고 6장 새로`);
      await act(`기존 ${olds.length}장 지우기`, async () => { for (const o of olds) await api('DELETE', `/appScreenshots/${o.id}`); });
      const ids = [];
      for (const [i, f] of shots.entries()) { const id = await act(`올리기 ${path.basename(f)}`, () => uploadShot(set.id, f, i)); if (id) ids.push(id); }
      if (ids.length === 6) await act('순서 맞추기', () => api('PATCH', `/appScreenshotSets/${set.id}/relationships/appScreenshots`, { data: ids.map((id) => ({ type: 'appScreenshots', id })) }));
    }
  }
}

// ---------- 6. 제출 ----------
if (verId) {
  const subs = (await api('GET', `/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES&limit=10`).catch(() => ({ data: [] }))).data;
  log(`ⓕ 심사 제출 기록: ${subs.map((s) => `${s.attributes.state}(${s.id})`).join(', ') || '없음'}`);
  if (!SUBMIT) log('  SUBMIT=1 이 아니라 제출하지 않음(대표 승인 뒤 workflow 입력 submit=true 로)');
  else if (subs.some((s) => ['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(s.attributes.state))) log('  이미 심사 대기/진행 중 — 제출 안 함');
  else {
    let sub = subs.find((s) => ['READY_FOR_REVIEW', 'UNRESOLVED_ISSUES'].includes(s.attributes.state));
    if (!sub) sub = await act('심사 제출 묶음 만들기', () => api('POST', '/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: app.id } } } } }).then((j) => j.data));
    if (sub) {
      const items = (await api('GET', `/reviewSubmissions/${sub.id}/items`).catch(() => ({ data: [] }))).data;
      if (!items.length) await act(`묶음에 버전 ${VERSION} 넣기`, () => api('POST', '/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: verId } } } } }));
      await act('심사 제출(submitted = true)', () => api('PATCH', `/reviewSubmissions/${sub.id}`, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } }));
    }
  }
}
log(plan ? '계획 끝 — 바꾼 것 없음' : '끝');
