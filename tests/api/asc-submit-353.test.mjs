// 353차(로컬 11/04 apply 실패: POST /appScreenshotSets → 409 STATE_ERROR "Can't Create Screenshot Set while Ready For Review"): scripts/asc-submit.mjs 를 가짜 App Store Connect 서버로 시험
// ⓐ 거두기 없이 apply — 버전이 반려 제출 묶음에 묶여 있으면 묶음 만들기·교체를 건너뛰고(아무것도 안 지움) 옛 그림이 남으면 submit=true 여도 제출 안 함
// ⓑ cancel_unresolved — 반려 제출 거두기(canceled=true) → 버전 PREPARE_FOR_SUBMISSION → 6.9형 묶음 만들기·6.1형/아이패드 교체(10장 넘으면 옛것부터) → 새 제출 묶음 → 제출
// ⓒ 다시 돌려도 같은 값(설명·키워드·심사 메모 건너뜀, 새 글 두 번 안 붙음) · plan 은 아무것도 안 바꿈 — 실제 애플 호출은 로컬이 Actions 에서
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PORT = 3291; const BASE = `http://localhost:${PORT}/v1`;
const P8 = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const NOTES = readFileSync('docs/handoff/store/ios-v4/review-notes.md', 'utf8').trim();
let st, srv; const calls = [];
function fresh() {
  let n = 0; const id = (p) => `${p}${++n}`;
  const shots = new Map(); const sets = new Map();
  const mk = (setId, k) => { for (let i = 0; i < k; i++) { const s = id('old'); shots.set(s, { id: s, set: setId }); } };
  sets.set('set61', { id: 'set61', type: 'APP_IPHONE_61' }); mk('set61', 7);
  sets.set('setPad', { id: 'setPad', type: 'APP_IPAD_PRO_3GEN_129' }); mk('setPad', 10);
  return { id, shots, sets, ver: 'READY_FOR_REVIEW', subs: new Map([['a048', { id: 'a048', state: 'UNRESOLVED_ISSUES', items: 1, polls: 0 }]]),
    loc: { description: 'old desc 무료', keywords: 'old' }, notes: 'Permissions: camera for attachments.\nThe app is free during the trial.\nAccount deletion: Settings > Account.' };
}
const locked = () => ['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(st.ver);
const err409 = (res, what) => { res.statusCode = 409; res.end(JSON.stringify({ errors: [{ status: '409', code: 'STATE_ERROR', title: 'The request cannot be fulfilled because of the state of another resource.', detail: `Can't ${what} while Ready For Review appScreenshotSet` }] })); };
function handle(req, res, body) {
  const u = new URL(req.url, BASE); const p = u.pathname.replace(/^\/v1/, '').replace(/^(?!\/)/, '/'); const m = req.method; let j = null; try { j = body && !p.startsWith('/upload/') ? JSON.parse(body) : null; } catch { j = null; }
  calls.push(`${m} ${p}`); res.setHeader('content-type', 'application/json');
  const ok = (data) => res.end(JSON.stringify({ data }));
  const verObj = () => ({ id: 'v1', attributes: { versionString: '1.2.0', appVersionState: st.ver } });
  if (m === 'PUT' && p.startsWith('/upload/')) return res.end('');
  if (m === 'GET' && p === '/apps') return ok([{ id: 'app1', attributes: { name: '워크인' } }]);
  if (m === 'GET' && p === '/apps/app1/appStoreVersions') return ok([verObj()]);
  if (m === 'GET' && p === '/appStoreVersions/v1') return ok(verObj());
  if (m === 'GET' && p === '/builds') return ok([{ id: 'b13', attributes: { version: '13', processingState: 'VALID', expired: false, uploadedDate: '2026-11-03' } }]);
  if (m === 'GET' && p === '/appStoreVersions/v1/relationships/build') return ok({ id: 'b13' });
  if (m === 'GET' && p === '/appStoreVersions/v1/appStoreVersionLocalizations') return ok([{ id: 'loc1', attributes: { locale: 'ko', ...st.loc } }]);
  if (m === 'PATCH' && p === '/appStoreVersionLocalizations/loc1') { Object.assign(st.loc, j.data.attributes); return ok({}); }
  if (m === 'GET' && p === '/appStoreVersions/v1/appStoreReviewDetail') return ok({ id: 'det1', attributes: { notes: st.notes, demoAccountName: 'demo' } });
  if (m === 'PATCH' && p === '/appStoreReviewDetails/det1') { st.notes = j.data.attributes.notes; return ok({}); }
  if (m === 'GET' && p === '/reviewSubmissions') { const want = (u.searchParams.get('filter[state]') ?? '').split(','); return ok([...st.subs.values()].filter((s) => want.includes(s.state)).map((s) => ({ id: s.id, attributes: { state: s.state } }))); }
  let r = p.match(/^\/reviewSubmissions\/(\w+)(\/items)?$/);
  if (r) {
    const s = st.subs.get(r[1]);
    if (r[2]) return ok(Array.from({ length: s.items }, (_, i) => ({ id: `it${i}`, attributes: { state: s.state === 'UNRESOLVED_ISSUES' ? 'REJECTED' : 'READY_FOR_REVIEW' } })));
    if (m === 'GET') { if (s.state === 'CANCELING' && ++s.polls >= 2) { s.state = 'COMPLETE'; st.ver = 'PREPARE_FOR_SUBMISSION'; } return ok({ id: s.id, attributes: { state: s.state } }); }
    if (m === 'PATCH' && j.data.attributes.canceled) { s.state = 'CANCELING'; return ok({ id: s.id, attributes: { state: s.state } }); }
    if (m === 'PATCH' && j.data.attributes.submitted) { if (!s.items) { res.statusCode = 409; return res.end('{"errors":[{"status":"409","code":"STATE_ERROR","title":"no items"}]}'); } s.state = 'WAITING_FOR_REVIEW'; st.ver = 'WAITING_FOR_REVIEW'; return ok({ id: s.id, attributes: { state: s.state } }); }
  }
  if (m === 'POST' && p === '/reviewSubmissions') { if ([...st.subs.values()].some((s) => ['UNRESOLVED_ISSUES', 'READY_FOR_REVIEW', 'CANCELING'].includes(s.state))) { res.statusCode = 409; return res.end('{"errors":[{"status":"409","code":"STATE_ERROR","title":"open submission"}]}'); } const s = { id: st.id('sub'), state: 'READY_FOR_REVIEW', items: 0, polls: 0 }; st.subs.set(s.id, s); return ok({ id: s.id, attributes: { state: s.state } }); }
  if (m === 'POST' && p === '/reviewSubmissionItems') { st.subs.get(j.data.relationships.reviewSubmission.data.id).items++; return ok({ id: 'item' }); }
  if (m === 'GET' && p === '/appStoreVersionLocalizations/loc1/appScreenshotSets') return ok([...st.sets.values()].map((s) => ({ id: s.id, attributes: { screenshotDisplayType: s.type } })));
  if (m === 'POST' && p === '/appScreenshotSets') { if (locked()) return err409(res, 'Create Screenshot Set'); const s = { id: st.id('set'), type: j.data.attributes.screenshotDisplayType }; st.sets.set(s.id, s); return ok({ id: s.id, attributes: { screenshotDisplayType: s.type } }); }
  r = p.match(/^\/appScreenshotSets\/(\w+)\/(appScreenshots|relationships\/appScreenshots)$/);
  if (r && m === 'GET') return ok([...st.shots.values()].filter((x) => x.set === r[1]).map((x) => ({ id: x.id })));
  if (r && m === 'PATCH') { const ids = j.data.map((d) => d.id); st.sets.get(r[1]).order = ids; res.statusCode = 204; return res.end(''); }
  if (m === 'POST' && p === '/appScreenshots') { if (locked()) return err409(res, 'Create Screenshot'); const setId = j.data.relationships.appScreenshotSet.data.id; if ([...st.shots.values()].filter((x) => x.set === setId).length >= 10) { res.statusCode = 409; return res.end('{"errors":[{"status":"409","code":"ENTITY_ERROR","title":"max 10"}]}'); } const s = st.id('new'); st.shots.set(s, { id: s, set: setId, name: j.data.attributes.fileName }); return ok({ id: s, attributes: { uploadOperations: [{ method: 'PUT', url: `http://localhost:${PORT}/upload/${s}`, offset: 0, length: j.data.attributes.fileSize, requestHeaders: [] }] } }); }
  r = p.match(/^\/appScreenshots\/(\w+)$/);
  if (r && m === 'DELETE') { if (locked()) return err409(res, 'Delete Screenshot'); st.shots.delete(r[1]); res.statusCode = 204; return res.end(''); }
  if (r && m === 'PATCH') return ok({ id: r[1] });
  if (r && m === 'GET') return ok({ id: r[1], attributes: { assetDeliveryState: { state: 'COMPLETE' } } });
  res.statusCode = 404; res.end(JSON.stringify({ errors: [{ status: '404', code: 'NOT_FOUND', title: `${m} ${p}` }] }));
}
const run = (extra) => new Promise((resolve) => execFile(process.execPath, ['scripts/asc-submit.mjs'], { env: { ...process.env, ASC_API_BASE: BASE, ASC_KEY_ID: 'KEYTEST', ASC_ISSUER_ID: 'issuer-test', ASC_KEY_P8: P8, ASC_POLL_MS: '20', VERSION: '1.2.0', BUILD: '13', ...extra } }, (e, out, errOut) => resolve({ code: e ? e.code ?? 1 : 0, out: out + errOut })));
const count = (setType) => { const s = [...st.sets.values()].find((x) => x.type === setType); return s ? [...st.shots.values()].filter((x) => x.set === s.id) : null; };

before(() => new Promise((r) => { srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => handle(req, res, b)); }).listen(PORT, r); }));
after(() => srv?.close());

test('plan: 상태만 찍고 아무것도 안 바꿈(제출 묶음 상태·버전 막힘·묶음별 지울/올릴 수)', async () => {
  st = fresh(); calls.length = 0;
  const r = await run({ MODE: 'plan' }); assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ⓢ 심사 제출 묶음 a048 · UNRESOLVED_ISSUES · 항목 1개 \(REJECTED\)/);
  assert.match(r.out, /ⓢ 버전 상태 READY_FOR_REVIEW — 스크린샷 묶음 만들기·교체가 막힐 수 있음\(409\)/);
  assert.match(r.out, /거두지 않음\(cancel_unresolved=false\)/);
  assert.match(r.out, /APP_IPAD_PRO_3GEN_129: 지울 10장 · 올릴 6장/); assert.match(r.out, /APP_IPHONE_61: 지울 7장 · 올릴 6장/);
  assert.ok(!calls.some((c) => /^(POST|PATCH|DELETE)/.test(c)), calls.filter((c) => !c.startsWith('GET')).join(', '));
});

test('ⓐ apply(거두기 없이): 묶음 만들기·교체 409 → 건너뜀·옛 그림 그대로 · 설명·메모는 바뀜 · submit=true 여도 옛 그림이 남아 제출 안 함', async () => {
  st = fresh(); calls.length = 0;
  const r = await run({ MODE: 'apply', SUBMIT: '1' }); assert.equal(r.code, 0, r.out);
  assert.match(r.out, /APP_IPHONE_67: 막힘\(409/); assert.match(r.out, /APP_IPHONE_61: 막힘\(409[^\n]*옛 그림 7장 그대로/); assert.match(r.out, /APP_IPAD_PRO_3GEN_129: 막힘\(409[^\n]*옛 그림 10장 그대로/);
  assert.deepEqual([count('APP_IPHONE_61').length, count('APP_IPAD_PRO_3GEN_129').length, count('APP_IPHONE_67')], [7, 10, null], '아무것도 안 지움');
  assert.match(r.out, /cancel_unresolved=true 로 다시 돌리면/);
  assert.match(r.out, /옛 그림이 남은 묶음 [^\n]*APP_IPAD_PRO_3GEN_129\(10장\)[^\n]* — 제출하지 않음/); assert.match(r.out, /옛 그림이 남은 묶음 [^\n]*APP_IPHONE_61\(7장\)/);
  assert.equal(st.subs.get('a048').state, 'UNRESOLVED_ISSUES', '거두지 않음'); assert.ok(!calls.some((c) => c.startsWith('PATCH /reviewSubmissions')));
  assert.ok(st.loc.description.length > 50 && !/무료/.test(st.loc.description), '설명은 바뀜');
  assert.ok(st.notes.startsWith(NOTES) && st.notes.includes('Account deletion') && !/free during/.test(st.notes), '심사 메모 = 새 글 + 기존 줄(무료 줄 뺌)');
});

test('ⓑ apply + cancel_unresolved + submit: 반려 제출 거두기 → 버전 돌아옴 → 6.9형 만들기·6.1형/아이패드 교체 → 새 제출 묶음 → 제출', async () => {
  st = fresh(); calls.length = 0;
  const r = await run({ MODE: 'apply', SUBMIT: '1', CANCEL_UNRESOLVED: '1' }); assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\[실행\] ⓢ 제출 묶음 a048\(UNRESOLVED_ISSUES\) 거두기/); assert.match(r.out, /제출 묶음 상태 → COMPLETE/); assert.match(r.out, /ⓢ 버전 상태 → PREPARE_FOR_SUBMISSION/);
  for (const t of ['APP_IPHONE_67', 'APP_IPHONE_61', 'APP_IPAD_PRO_3GEN_129']) {
    const sh = count(t); assert.equal(sh.length, 6, `${t} 6장`); assert.ok(sh.every((x) => x.id.startsWith('new')), `${t} 새 그림만`);
    assert.deepEqual([...st.sets.values()].find((x) => x.type === t).order, sh.map((x) => x.id), `${t} 순서`);
  }
  for (const [set, firstOld] of [['setPad', 'old8'], ['set61', 'old1']]) { // 옛 그림 + 새 6장이 10장을 넘으면 옛것부터 지움
    const from = calls.indexOf(`GET /appScreenshotSets/${set}/appScreenshots`); const del = calls.indexOf(`DELETE /appScreenshots/${firstOld}`, from);
    const post = calls.indexOf('POST /appScreenshots', from);
    assert.ok(from >= 0 && del > from && post > del, `${set}: 지우기 ${del} → 올리기 ${post}`);
  }
  assert.match(r.out, /ⓔ 결과: 바꾼 묶음 APP_IPHONE_67, APP_IPAD_PRO_3GEN_129, APP_IPHONE_61$/m);
  const subs = [...st.subs.values()]; const nw = subs.find((s) => s.id !== 'a048');
  assert.deepEqual([st.subs.get('a048').state, nw?.state, nw?.items], ['COMPLETE', 'WAITING_FOR_REVIEW', 1], '새 제출 묶음에 버전 넣고 제출');
});

test('ⓒ 다시 돌려도 같은 값: 설명·키워드·심사 메모 건너뜀(새 글 두 번 안 붙음)', async () => {
  st = fresh();
  await run({ MODE: 'apply' }); const notes1 = st.notes; const desc1 = st.loc.description;
  calls.length = 0;
  const r = await run({ MODE: 'apply' }); assert.equal(r.code, 0, r.out);
  assert.match(r.out, /설명·키워드 이미 같음 — 건너뜀/); assert.match(r.out, /심사 메모 이미 같음 — 건너뜀/);
  assert.equal(st.notes, notes1); assert.equal(st.loc.description, desc1);
  assert.equal(st.notes.split(NOTES).length - 1, 1, '새 글은 한 번만');
  assert.ok(!calls.some((c) => /PATCH \/(appStoreVersionLocalizations|appStoreReviewDetails)/.test(c)));
});
