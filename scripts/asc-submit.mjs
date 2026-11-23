// 351차 #947(대표 11/04 '아이폰 앱 정상 출시를 서둘러 달라'): App Store Connect API 로 1.2.0 재제출 준비·제출 — GitHub Actions(appstore-submit.yml)에서만 실행(키는 Secrets).
// 하는 일(MODE=apply): ⓐ 반려된 iOS 버전의 버전 문자열 → VERSION ⓑ 빌드 BUILD(1.2.0) 지정 ⓒ 설명·키워드(WORKIN_STORE_LISTING.md) ⓓ 심사 메모(review-notes.md + 기존 메모의 권한·계정 삭제·개인정보 줄 유지, 요금·무료 줄 제거)
// ⓔ 스크린샷 교체 — 버전에 붙은 모든 묶음(6.9형 APP_IPHONE_67 ← iphone-0n · 6.1형 APP_IPHONE_61 ← iphone61-0n · 아이패드 13형 APP_IPAD_PRO_3GEN_129 ← ipad-0n, 그 밖 묶음은 옛 그림만 지움)의 옛 그림(v3, 가격 표시)을 지우고 새것으로. 없는 필수 묶음(6.9형·아이패드 13형)은 만든다. ⓕ SUBMIT=1 이면 심사 제출. MODE=plan 은 읽기만(묶음별 '지울 n장·올릴 n장' 보고). 비밀번호·키는 절대 출력하지 않는다.
// 353차(로컬 11/04 apply 409 STATE_ERROR): 버전이 반려·대기 제출 묶음에 들어 있으면 스크린샷 묶음 만들기·교체가 막힌다 → 막힌 묶음은 건너뛰고(옛 그림이 남으면 제출 안 함),
//   CANCEL_UNRESOLVED=1(workflow 입력 cancel_unresolved)이면 반려(UNRESOLVED_ISSUES)·초안(READY_FOR_REVIEW) 제출을 거두고(canceled=true) 버전이 고칠 수 있는 상태로 돌아올 때까지 기다린 뒤 진행, 제출 때 새 묶음.
//   설명·키워드·심사 메모는 같은 값이면 건너뜀(다시 돌려도 같음 — 심사 메모 새 글이 두 번 붙지 않게).
// 356차(로컬 11/04 iphone-02 '처리 대기 초과'): 처리 대기를 넘긴 장은 다음 장으로 → 끝에 모든 장 다시 확인(최대 10분) → COMPLETE 아닌 장만 다시 올림 · 같은 이름·체크섬 장은 지우지 않음 · 처리 안 끝난 장이 있으면 제출 안 함.
// 11/20(대표 재제출 승인 · 로컬 요청): 기본값을 v6 로 — 스크린샷 docs/handoff/store/v6-features(폴더에 있는 만큼, 01 부터 이어진 번호로 최대 10장 · 세 묶음이 같은 장 수여야 올림) · 등록 글 ios-listing.md(설명·키워드·프로모션 텍스트)
//   · 심사 메모 review-notes.md(4000자 제한 때문에 줄인 판 — 긴 답글은 해결 센터에 사람이 붙임) · 지난 재제출 때 붙인 글(PREV_NOTES_FILES)은 기존 메모에서 빼고 그 앞의 권한·계정 삭제·개인정보 줄만 유지 · 끝에 '바뀌는 것 요약'.
// 외부 패키지 없음(Node 22 fetch + node:crypto ES256). 참고: 6.9형 슬롯의 API 이름은 APP_IPHONE_67(애플이 6.7형 슬롯을 6.9형으로 넓힘) — 다르면 DISPLAY_TYPE 으로 바꿈.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const env = (k, d) => (process.env[k] ?? d);
const KEY_ID = env('ASC_KEY_ID', ''), ISSUER = env('ASC_ISSUER_ID', ''), P8 = env('ASC_KEY_P8', '');
const BUNDLE = env('BUNDLE_ID', 'kr.co.dagym.workos');
const VERSION = env('VERSION', '1.2.0'), BUILD = env('BUILD', '13');
const MODE = env('MODE', 'plan'); const SUBMIT = env('SUBMIT', '0') === '1';
const CANCEL_UNRESOLVED = env('CANCEL_UNRESOLVED', '0') === '1'; // 반려·초안 제출 묶음 거두기(대표가 재제출 승인한 범위 — 로컬이 입력으로 켬)
const DISPLAY = env('DISPLAY_TYPE', 'APP_IPHONE_67'); // 6.9형 슬롯 이름(애플이 6.7형 슬롯을 6.9형으로 넓힘) — 다르면 입력으로
const IPAD_DISPLAY = env('IPAD_DISPLAY_TYPE', 'APP_IPAD_PRO_3GEN_129'); // 아이패드 13형(2048×2732) 슬롯
const LOCALE = env('LOCALE', 'ko');
const SHOTS_DIR = env('SHOTS_DIR', '') || 'docs/handoff/store/v6-features';
const LISTING = env('LISTING', '') || 'docs/handoff/store/v6-features/ios-listing.md';
const NOTES_FILE = env('NOTES_FILE', '') || 'docs/handoff/store/v6-features/review-notes.md';
/** 지난 재제출 때 메모 앞에 붙였던 글 — 이번 메모와 어긋나므로(예: 'Apple 로그인 추가') 기존 메모에서 뺀다. 쉼표로 여러 개, 'none' 이면 빼지 않음 */
const PREV_NOTES_FILES = (env('PREV_NOTES_FILES', '') || 'docs/handoff/store/ios-v4/review-notes.md').split(',').map((x) => x.trim()).filter((x) => x && x !== 'none');
const WHATS_NEW = env('WHATS_NEW', '');
const API = env('ASC_API_BASE', 'https://api.appstoreconnect.apple.com/v1'); // 시험은 가짜 서버(tests/api/asc-submit-353.test.mjs)
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
const sleep = (ms) => new Promise((f) => setTimeout(f, Number(env('ASC_POLL_MS', '')) || ms));
const isLocked409 = (e) => /→ 409\b/.test(e?.message ?? '') && /STATE_ERROR|Ready For Review|Waiting For Review|In Review/i.test(e?.message ?? '');
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
const promo = section(listing, '## 프로모션 텍스트').split('\n')[0].trim(); // 없으면 건드리지 않음(170자 안)
if (!description || !keywords) { console.error(`${LISTING} 에서 '## 자세한 설명' 또는 '## App Store 키워드' 칸을 찾지 못했습니다`); process.exit(3); }
if (promo.length > 170) { console.error(`프로모션 텍스트가 ${promo.length}자입니다(170자까지)`); process.exit(3); }
if (keywords.length > 100) { console.error(`키워드가 ${keywords.length}자입니다(100자까지)`); process.exit(3); }
const newNotes = (() => { try { return readFileSync(NOTES_FILE, 'utf8').trim(); } catch { return ''; } })();
const BAD_META = /\d[\d,]*\s*원|무료|체험|요금|가격|free|pricing|price|trial/i;
for (const [name, text] of [['설명', description], ['키워드', keywords], ['프로모션 텍스트', promo]]) { // 심사 메모는 심사관에게 '요금 문장을 뺐다'고 설명하는 글이라 검사 대상이 아님
  const m = text.match(BAD_META); if (m) { console.error(`${name}에 요금·무료 관련 글자('${m[0]}')가 있습니다 — 2.3.7 재발 방지로 멈춤`); process.exit(3); }
}
// 397차 #1023(애플 11/06 반려 3.1.1 — 설명의 '문의: 메일' 줄을 앱 밖 구매로 이끄는 문구로 지적): 설명에 문의 안내·메일·웹 주소가 있으면 멈춤
{ const m = description.match(/문의\s*[:：]|[\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/|www\./i); if (m) { console.error(`설명에 문의·메일·주소('${m[0]}')가 있습니다 — 3.1.1 재발 방지로 멈춤`); process.exit(3); } }
/** 폴더에 있는 만큼: prefix-01.png 부터 번호가 이어진 데까지(최대 10장 — 애플 한 묶음 한도) */
const shotsOf = (prefix) => { const out = []; for (let n = 1; n <= 10; n++) { const f = path.join(SHOTS_DIR, `${prefix}-${String(n).padStart(2, '0')}.png`); try { if (statSync(f).size > 0) { out.push(f); continue; } } catch { /* 없음 */ } break; } return out; };
/** 묶음(슬롯) → 올릴 파일: 6.9형·6.1형·아이패드 13형. 그 밖 묶음은 파일 없음(옛 그림만 지움) */
const FILES_OF = { [DISPLAY]: shotsOf('iphone'), APP_IPHONE_61: shotsOf('iphone61'), [IPAD_DISPLAY]: shotsOf('ipad') };
/** 한 묶음에 올릴 장 수 = 6.9형 폴더에 있는 장 수(SHOTS_COUNT 로 정할 수도). 이 수와 다른 묶음은 올리지 않음(빠진 장이 있는 채로 올라가지 않게) */
const SHOTS_N = Number(env('SHOTS_COUNT', '')) || FILES_OF[DISPLAY].length;
const summary = []; // 끝에 찍는 '바뀌는 것 요약'
const REQUIRED = [DISPLAY, IPAD_DISPLAY]; // 앱이 아이폰·아이패드 둘 다 지원(TARGETED_DEVICE_FAMILY 1,2)

// ---------- 1. 앱·버전 ----------
const apps = (await api('GET', `/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}`)).data;
if (!apps.length) throw new Error(`번들 ${BUNDLE} 앱이 없습니다`);
const app = apps[0]; log(`앱 ${app.attributes.name} (${app.id}) · 모드 ${MODE}${SUBMIT ? ' + 제출' : ''}`);
// 로컬 11/24: 앱의 Apple ID(숫자) = 스토어 주소 — 심사 통과 뒤 NEXT_PUBLIC_APPSTORE_URL 에 넣음(공개 정보라 그대로 찍음)
log(`Apple ID ${app.id} · 스토어 주소 https://apps.apple.com/kr/app/id${app.id}`);
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

// ---------- 1-2. 심사 제출 묶음 상태(버전이 반려·초안·대기 묶음에 들어 있으면 스크린샷 묶음 만들기·교체가 409 로 막힘) ----------
const LOCKED = new Set(['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW']);
const OPEN_SUB = ['READY_FOR_REVIEW', 'UNRESOLVED_ISSUES', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'CANCELING'];
const openSubs = async () => (await api('GET', `/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&filter[state]=${OPEN_SUB.join(',')}&limit=10`).catch(() => ({ data: [] }))).data;
const verStateNow = async () => (verId ? stateOf((await api('GET', `/appStoreVersions/${verId}`)).data) : '?');
if (verId) {
  const subs0 = await openSubs();
  for (const sb of subs0) {
    const items = (await api('GET', `/reviewSubmissions/${sb.id}/items`).catch(() => ({ data: [] }))).data;
    log(`ⓢ 심사 제출 묶음 ${sb.id} · ${sb.attributes.state} · 항목 ${items.length}개${items.length ? ` (${items.map((i) => i.attributes?.state ?? '?').join(', ')})` : ''}`);
  }
  const vs = stateOf(ver);
  log(`ⓢ 버전 상태 ${vs} — 스크린샷 묶음 ${LOCKED.has(vs) ? '만들기·교체가 막힐 수 있음(409)' : '바꿀 수 있음'}`);
  const cancelable = subs0.filter((sb) => ['UNRESOLVED_ISSUES', 'READY_FOR_REVIEW'].includes(sb.attributes.state));
  if (!cancelable.length) log('ⓢ 거둘 반려·초안 제출 없음');
  else if (!CANCEL_UNRESOLVED) log(`ⓢ 반려·초안 제출 ${cancelable.map((sb) => `${sb.attributes.state}(${sb.id})`).join(', ')} — 거두지 않음(cancel_unresolved=false). 묶음이 막히면 건너뛰고, 옛 그림이 남으면 제출하지 않음`);
  else for (const sb of cancelable) {
    await act(`ⓢ 제출 묶음 ${sb.id}(${sb.attributes.state}) 거두기(canceled = true)`, async () => {
      await api('PATCH', `/reviewSubmissions/${sb.id}`, { data: { type: 'reviewSubmissions', id: sb.id, attributes: { canceled: true } } });
      let st = 'CANCELING';
      // 11/20 apply 44669109536: 거두기(PATCH) 직후 애플이 그 묶음을 지워 상태 조회가 404 → 예외로 끝났다(거두기 자체는 됨). 404 = 거둬져 사라진 것으로 보고 계속한다
      const subState = async () => { try { return (await api('GET', `/reviewSubmissions/${sb.id}`)).data.attributes.state; } catch (e) { if (/ → 404 /.test(String(e?.message))) return 'GONE'; throw e; } };
      for (let i = 0; i < 40 && ['CANCELING', 'UNRESOLVED_ISSUES', 'READY_FOR_REVIEW'].includes(st); i++) { await sleep(3000); st = await subState(); }
      log(`    제출 묶음 상태 → ${st === 'GONE' ? '사라짐(조회 404 — 거둬진 것으로 봄)' : st}`);
    });
  }
  if (CANCEL_UNRESOLVED && cancelable.length && !plan) {
    let st = await verStateNow();
    for (let i = 0; i < 40 && LOCKED.has(st); i++) { await sleep(3000); st = await verStateNow(); }
    log(`ⓢ 버전 상태 → ${st}${LOCKED.has(st) ? ' (아직 막힘 — 스크린샷은 막히면 건너뜀)' : ''}`);
  } else if (CANCEL_UNRESOLVED && cancelable.length) log('  [계획] 거둔 뒤 버전이 PREPARE_FOR_SUBMISSION(또는 DEVELOPER_REJECTED)으로 돌아올 때까지 3초마다 최대 2분 기다림 → 묶음 만들기·교체 → 제출 때 새 제출 묶음');
}

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
    const attrs = { description, keywords, ...(promo ? { promotionalText: promo } : {}) };
    const same = { desc: a.description === description, kw: (a.keywords ?? '') === keywords, promo: !promo || (a.promotionalText ?? '') === promo };
    if (promo) log(`  프로모션 텍스트 ${(a.promotionalText ?? '').length}자 → ${promo.length}자`);
    summary.push(`설명 ${same.desc ? '그대로' : `바뀜(${a.description?.length ?? 0}자 → ${description.length}자)`} · 키워드 ${same.kw ? '그대로' : '바뀜'} · 프로모션 텍스트 ${!promo ? '건드리지 않음' : same.promo ? '그대로' : '바뀜'}`);
    if (same.desc && same.kw && same.promo) log('  설명·키워드 이미 같음 — 건너뜀');
    else await act(`설명·키워드${promo ? '·프로모션 텍스트' : ''} 바꾸기`, () => api('PATCH', `/appStoreVersionLocalizations/${loc.id}`, { data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: attrs } }));
    if (WHATS_NEW) await act('새 기능(whatsNew) 적기', () => api('PATCH', `/appStoreVersionLocalizations/${loc.id}`, { data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { whatsNew: WHATS_NEW } } }).catch((e) => log(`  (첫 버전이면 새 기능 칸이 없음 — 건너뜀: ${e.message.slice(0, 120)})`)));
  }
}

// ---------- 4. 심사 메모(기존 권한·계정 삭제·개인정보 줄 유지, 요금·무료 줄 제거, 새 1.2.0 설명 앞에) ----------
if (verId) {
  const det = (await api('GET', `/appStoreVersions/${verId}/appStoreReviewDetail?fields[appStoreReviewDetails]=notes,demoAccountRequired,demoAccountName`).catch(() => ({ data: null }))).data;
  const old = det?.attributes?.notes ?? '';
  const newLines = new Set(newNotes.split('\n').map((l) => l.trim()).filter(Boolean));
  const prevLines = new Set(PREV_NOTES_FILES.filter((f) => path.resolve(f) !== path.resolve(NOTES_FILE)).flatMap((f) => { try { return readFileSync(f, 'utf8').split('\n'); } catch { return []; } }).map((l) => l.trim()).filter(Boolean));
  // 지난 실행이 앞에 붙인 새 글(통째·줄 단위)은 빼고 나머지만 '기존 줄'로 — 다시 돌려도 같은 메모
  const rest = (newNotes ? old.split(newNotes).join('') : old).split('\n').filter((l) => !newLines.has(l.trim()));
  const droppedPrev = rest.filter((l) => prevLines.has(l.trim())).length;
  const keep = rest.filter((l) => !prevLines.has(l.trim()) && !/무료|요금|PC 웹|free|pric|trial|1\.1\.1|1\.2\.0 changes/i.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const full = [newNotes, keep].filter(Boolean).join('\n\n');
  const notes = full.slice(0, 4000);
  if (droppedPrev) log(`  지난 재제출 때 붙인 글 ${droppedPrev}줄은 뺌(${PREV_NOTES_FILES.join(', ')})`);
  if (full.length > 4000) log(`  ⚠ 심사 메모가 4000자를 넘어 뒤 ${full.length - 4000}자가 잘립니다(새 글 ${newNotes.length}자는 그대로, 잘리는 것은 기존 줄의 끝) — 새 글을 줄이거나 기존 줄을 화면에서 정리하세요`);
  summary.push(`심사 메모 ${newNotes ? (det && old === notes ? '그대로' : `바뀜 — 새 글 ${newNotes.length}자 + 기존 줄 ${keep.length}자 = ${notes.length}자${full.length > 4000 ? `(4000자 넘어 ${full.length - 4000}자 잘림)` : ''}${droppedPrev ? ` · 지난 재제출 글 ${droppedPrev}줄 뺌` : ''}`) : '건드리지 않음(새 글 파일 없음)'}`);
  log(`ⓓ 심사 메모: 기존 ${old.length}자(유지 ${keep.length}자) + 새 글 ${newNotes.length}자 → ${notes.length}자 · 데모 계정 ${det?.attributes?.demoAccountName ? '있음' : '없음'}(비밀번호는 기존 칸 그대로)`);
  if (!newNotes) log('  (review-notes.md 없음 — 메모는 그대로 둠)');
  else if (det && old === notes) log('  심사 메모 이미 같음 — 건너뜀');
  else if (det) await act('심사 메모 바꾸기(데모 계정 칸은 그대로)', () => api('PATCH', `/appStoreReviewDetails/${det.id}`, { data: { type: 'appStoreReviewDetails', id: det.id, attributes: { notes, demoAccountRequired: true } } }));
  else await act('심사 정보 새로 만들기(데모 계정은 사람이 적어야 함)', () => api('POST', '/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes: { notes, demoAccountRequired: true }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: verId } } } } }));
}

// ---------- 5. 스크린샷(버전에 붙은 모든 묶음) ----------
// 356차(로컬 11/04 apply: iphone-02 '처리 대기 초과'로 멈춤): ① 한 장 처리 대기(3초 × ASC_SHOT_WAIT)를 넘으면 실패로 끝내지 않고 다음 장으로 → 맨 끝에 모든 장을 다시 확인(최대 ASC_FINAL_WAIT_MS, 기본 10분),
//   그래도 COMPLETE 가 아닌 장(처리 실패 포함)만 지우고 한 번 다시 올림 ② 같은 이름·체크섬으로 이미 올라간 장(처리 끝·처리 중)은 지우지 않고 그대로(다시 돌려도 같은 결과)
//   ③ 처리 실패·처리 중인 장이 남으면 submit=true 여도 제출하지 않음
const SHOT_WAIT = Number(env('ASC_SHOT_WAIT', '20')) || 20;
const FINAL_WAIT_MS = Number(env('ASC_FINAL_WAIT_MS', '600000'));
const shotName = (file, idx) => `${String(idx + 1).padStart(2, '0')}-${path.basename(file)}`;
const md5Of = (file) => createHash('md5').update(readFileSync(file)).digest('hex');
const shotState = async (id) => (await api('GET', `/appScreenshots/${id}?fields[appScreenshots]=assetDeliveryState`)).data.attributes.assetDeliveryState?.state ?? '?';
async function waitShot(id, tries) {
  let s = '?';
  for (let i = 0; i < tries; i++) { s = await shotState(id); if (s === 'COMPLETE' || s === 'FAILED') return s; await sleep(3000); }
  return s;
}
async function uploadShot(setId, file, idx) {
  const buf = readFileSync(file); const md5 = createHash('md5').update(buf).digest('hex');
  const r = (await api('POST', '/appScreenshots', { data: { type: 'appScreenshots', attributes: { fileName: shotName(file, idx), fileSize: buf.length }, relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } } } })).data;
  for (const op of r.attributes.uploadOperations ?? []) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const res = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) });
    if (!res.ok) throw new Error(`스크린샷 조각 올리기 실패 ${res.status}`);
  }
  await api('PATCH', `/appScreenshots/${r.id}`, { data: { type: 'appScreenshots', id: r.id, attributes: { uploaded: true, sourceFileChecksum: md5 } } });
  const state = await waitShot(r.id, SHOT_WAIT);
  log(`    ${shotName(file, idx)} → ${state === 'COMPLETE' ? '처리 끝' : state === 'FAILED' ? '처리 실패(끝에 다시 올림)' : `처리 중(${state}) — 다음 장으로, 끝에 다시 확인`}`);
  return { id: r.id, state };
}
const shotBlocked = []; const shotDone = []; const shotIncomplete = []; const work = [];
if (loc) {
  const sets = (await api('GET', `/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data;
  const have = new Map(sets.map((s) => [s.attributes.screenshotDisplayType, s]));
  const types = [...new Set([...REQUIRED, ...sets.map((s) => s.attributes.screenshotDisplayType)])];
  log(`ⓔ 스크린샷 묶음(버전에 붙은 것 + 필수): ${types.join(', ')}`);
  for (const type of types) {
    const files = FILES_OF[type] ?? [];
    let set = have.get(type) ?? null;
    const olds = set ? (await api('GET', `/appScreenshotSets/${set.id}/appScreenshots?limit=50`)).data : [];
    const ready = SHOTS_N > 0 && files.length === SHOTS_N;
    // ② 같은 이름·체크섬으로 이미 올라간 장은 그대로(처리 실패한 장은 빼고) — 한 장에 하나만
    const want = ready ? files.map((file, idx) => ({ file, idx, name: shotName(file, idx), md5: md5Of(file) })) : [];
    const slots = new Map(); const keptIds = new Set();
    for (const w of want) {
      const o = olds.find((x) => !keptIds.has(x.id) && x.attributes?.fileName === w.name && String(x.attributes?.sourceFileChecksum ?? '').toLowerCase() === w.md5 && x.attributes?.assetDeliveryState?.state !== 'FAILED');
      if (o) { keptIds.add(o.id); slots.set(w.idx, { id: o.id, state: o.attributes.assetDeliveryState?.state ?? '?' }); }
    }
    const dels = olds.filter((o) => !keptIds.has(o.id)); const ups = want.filter((w) => !slots.has(w.idx));
    summary.push(`스크린샷 ${type}: ${ready ? `${want.length}장(지울 ${dels.length} · 올릴 ${ups.length} · 그대로 ${keptIds.size})` : files.length ? `건너뜀 — 폴더에 ${files.length}장(${SHOTS_N}장이어야 함)` : `새 그림 없음(옛 그림 ${dels.length}장만 지움)`}`);
    log(`  ${type}: 지울 ${dels.length}장 · 올릴 ${ready ? ups.length : files.length ? `${files.length}(${SHOTS_N}장이 아니라 건너뜀)` : '0(새 그림 없음 — 옛 그림만 지움)'}장${keptIds.size ? ` · 그대로 ${keptIds.size}장(같은 이름·체크섬으로 이미 올라감)` : ''}${!set ? ' · 묶음 새로 만듦' : ''}`);
    if (!set && !ready) continue; // 필수인데 파일이 없으면 만들지 않음(빈 묶음은 의미 없음)
    try {
      if (!set) set = await act(`${type} 묶음 만들기`, () => api('POST', '/appScreenshotSets', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: type }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } } } }).then((j) => j.data));
      if (!set) continue;
      // 한 묶음 최대 10장: 지금 있는 장 + 새로 올릴 장이 10장 안이면 새것부터 올리고 옛것을 지움(막히면 옛것 그대로), 넘으면 옛것부터(첫 지우기가 막히면 아무것도 안 바뀜)
      const delOld = () => (dels.length ? act(`${type} 옛 그림 ${dels.length}장 지우기`, async () => { for (const o of dels) await api('DELETE', `/appScreenshots/${o.id}`); }) : null);
      if (!ready) { await delOld(); shotDone.push(type); continue; }
      const uploadFirst = olds.length + ups.length <= 10;
      if (!uploadFirst) await delOld();
      for (const w of ups) { const r = await act(`${type} 올리기 ${path.basename(w.file)}`, () => uploadShot(set.id, w.file, w.idx)); if (r) slots.set(w.idx, r); }
      if (uploadFirst) await delOld();
      if (!plan) work.push({ type, set, want, slots });
      shotDone.push(type);
    } catch (e) {
      if (!isLocked409(e)) throw e;
      shotBlocked.push({ type, olds: olds.length, made: !!have.get(type) });
      log(`  ${type}: 막힘(409 — 버전이 심사 제출 묶음에 들어 있음) → 건너뜀${have.get(type) ? ` · 옛 그림 ${olds.length}장 그대로` : ' · 묶음 없음'} — ${e.message.slice(0, 160)}`);
    }
  }
  // ① 처리 안 끝난 장: 끝에서 다시 확인(최대 FINAL_WAIT_MS) → 그래도 COMPLETE 가 아니면 그 장만 지우고 한 번 다시 올림
  const notDone = () => work.flatMap((wk) => wk.want.filter((w) => wk.slots.get(w.idx)?.state !== 'COMPLETE').map((w) => ({ wk, w, s: wk.slots.get(w.idx) })));
  if (notDone().length) {
    log(`ⓔ 처리 안 끝난 장 ${notDone().length}장 — 끝까지 다시 확인(최대 ${Math.round(FINAL_WAIT_MS / 60000)}분)`);
    const until = Date.now() + FINAL_WAIT_MS;
    while (notDone().some(({ s }) => s && s.state !== 'FAILED') && Date.now() < until) {
      for (const { s } of notDone()) if (s && s.state !== 'FAILED') s.state = await shotState(s.id);
      if (notDone().some(({ s }) => s && s.state !== 'FAILED')) await sleep(10000);
    }
    for (const { wk, w, s } of notDone()) {
      log(`  ${wk.type} ${w.name}: ${s ? s.state : '올라가지 않음'} → ${s ? '지우고 ' : ''}다시 올리기`);
      try {
        if (s) await api('DELETE', `/appScreenshots/${s.id}`);
        const r = await uploadShot(wk.set.id, w.file, w.idx);
        if (r.state !== 'COMPLETE' && r.state !== 'FAILED') r.state = await waitShot(r.id, 60);
        wk.slots.set(w.idx, r);
      } catch (e) { log(`    다시 올리기 실패 — ${e.message.slice(0, 160)}`); if (s) wk.slots.set(w.idx, { ...s, state: s.state === 'COMPLETE' ? '?' : s.state }); }
    }
  }
  for (const wk of work) {
    const ids = wk.want.map((w) => wk.slots.get(w.idx)?.id).filter(Boolean);
    if (ids.length === wk.want.length) await act(`${wk.type} 순서 맞추기`, () => api('PATCH', `/appScreenshotSets/${wk.set.id}/relationships/appScreenshots`, { data: ids.map((id) => ({ type: 'appScreenshots', id })) }));
    const bad = wk.want.filter((w) => wk.slots.get(w.idx)?.state !== 'COMPLETE');
    if (bad.length) shotIncomplete.push({ type: wk.type, shots: bad.map((w) => `${w.name}(${wk.slots.get(w.idx)?.state ?? '없음'})`) });
  }
  log(`ⓔ 결과: 바꾼 묶음 ${shotDone.join(', ') || '없음'}${shotBlocked.length ? ` · 막힌 묶음 ${shotBlocked.map((b) => b.type).join(', ')}${CANCEL_UNRESOLVED ? '' : ' → cancel_unresolved=true 로 다시 돌리면 반려 제출을 거두고 진행'}` : ''}`);
  if (shotIncomplete.length) log(`ⓔ 처리 안 끝난 장: ${shotIncomplete.map((x) => `${x.type} ${x.shots.join(', ')}`).join(' · ')} — 다시 돌리면 처리 끝난 장은 그대로 두고 이 장만 올림`);
}
// 옛 그림(가격 표시 v3)이 남은 묶음이 있으면 제출하지 않음(같은 사유 2.3.7 로 다시 반려되지 않게) — 묶음이 아예 없는 것은 제출을 막지 않음(1.1.1 도 6.1형·아이패드만으로 심사)
const staleLeft = shotBlocked.filter((b) => b.made && b.olds > 0);

// ---------- 6. 제출 ----------
if (verId) {
  const subs = (await openSubs()).filter((sb) => sb.attributes.state !== 'CANCELING');
  log(`ⓕ 심사 제출 기록: ${subs.map((s) => `${s.attributes.state}(${s.id})`).join(', ') || '없음'}`);
  if (!SUBMIT) log('  SUBMIT=1 이 아니라 제출하지 않음(대표 승인 뒤 workflow 입력 submit=true 로)');
  else if (staleLeft.length) log(`  옛 그림이 남은 묶음 ${staleLeft.map((b) => `${b.type}(${b.olds}장)`).join(', ')} — 제출하지 않음(cancel_unresolved=true 로 다시)`);
  else if (shotIncomplete.length) log(`  처리 안 끝난 스크린샷 ${shotIncomplete.map((x) => `${x.type} ${x.shots.length}장`).join(', ')} — 제출하지 않음(다시 돌리면 그 장만 올림)`);
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
log(`■ ${plan ? '바뀔 것' : '바꾼 것'} 요약 — 스크린샷 폴더 ${SHOTS_DIR}(묶음마다 ${SHOTS_N}장) · 등록 글 ${LISTING} · 심사 메모 ${NOTES_FILE}`);
for (const x of summary) log(`  · ${x}`);
log(plan ? '계획 끝 — 바꾼 것 없음' : '끝');
