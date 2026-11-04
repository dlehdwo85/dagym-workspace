// 353차(로컬 11/04 apply 실패: POST /appScreenshotSets → 409 STATE_ERROR "Can't Create Screenshot Set while Ready For Review"): scripts/asc-submit.mjs 를 가짜 App Store Connect 서버로 시험
// ⓐ 거두기 없이 apply — 버전이 반려 제출 묶음에 묶여 있으면 묶음 만들기·교체를 건너뛰고(아무것도 안 지움) 옛 그림이 남으면 submit=true 여도 제출 안 함
// ⓑ cancel_unresolved — 반려 제출 거두기(canceled=true) → 버전 PREPARE_FOR_SUBMISSION → 6.9형 묶음 만들기·6.1형/아이패드 교체(10장 넘으면 옛것부터) → 새 제출 묶음 → 제출
// ⓒ 다시 돌려도 같은 값(설명·키워드·심사 메모 건너뜀, 새 글 두 번 안 붙음) · plan 은 아무것도 안 바꿈 — 실제 애플 호출은 로컬이 Actions 에서
// 356차(로컬 11/04 apply: iphone-02 '처리 대기 초과'로 멈춤) ⓓ 처리 대기를 넘긴 장은 다음 장으로 → 끝에 다시 확인 → COMPLETE 아닌 장만 다시 올림 · 같은 이름·체크섬 장은 그대로
// ⓔ 끝까지 처리 안 끝난 장이 있으면 submit=true 여도 제출 안 함 → 다시 돌리면 처리 끝난 장은 그대로 두고 제출
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
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
/** 356차: 처리 상태 — fail 이면 FAILED, pending 이 남으면 UPLOAD_COMPLETE(처리 중, 확인할 때마다 하나씩 줄어듦), 아니면 COMPLETE */
function shotState(sh, tick) { if (sh.fail) return 'FAILED'; if (sh.pending > 0) { if (tick) sh.pending--; return 'UPLOAD_COMPLETE'; } return 'COMPLETE'; }
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
  if (r && m === 'GET') return ok([...st.shots.values()].filter((x) => x.set === r[1]).map((x) => ({ id: x.id, attributes: x.name ? { fileName: x.name, sourceFileChecksum: x.md5 ?? null, assetDeliveryState: { state: shotState(x, false) } } : {} })));
  if (r && m === 'PATCH') { const ids = j.data.map((d) => d.id); st.sets.get(r[1]).order = ids; res.statusCode = 204; return res.end(''); }
  if (m === 'POST' && p === '/appScreenshots') { if (locked()) return err409(res, 'Create Screenshot'); const setId = j.data.relationships.appScreenshotSet.data.id; if ([...st.shots.values()].filter((x) => x.set === setId).length >= 10) { res.statusCode = 409; return res.end('{"errors":[{"status":"409","code":"ENTITY_ERROR","title":"max 10"}]}'); } const s = st.id('new'); const name = j.data.attributes.fileName; const rule = st.rules?.[name]; const sh = { id: s, set: setId, name, pending: 0 };
    if (rule && (rule.always || !rule.used)) { rule.used = true; sh.pending = rule.pending ?? 0; sh.fail = !!rule.fail; } st.posts = [...(st.posts ?? []), name]; st.shots.set(s, sh); return ok({ id: s, attributes: { uploadOperations: [{ method: 'PUT', url: `http://localhost:${PORT}/upload/${s}`, offset: 0, length: j.data.attributes.fileSize, requestHeaders: [] }] } }); }
  r = p.match(/^\/appScreenshots\/(\w+)$/);
  if (r && m === 'DELETE') { if (locked()) return err409(res, 'Delete Screenshot'); st.shots.delete(r[1]); res.statusCode = 204; return res.end(''); }
  if (r && m === 'PATCH') { const sh = st.shots.get(r[1]); if (sh && j?.data?.attributes?.sourceFileChecksum) sh.md5 = j.data.attributes.sourceFileChecksum; return ok({ id: r[1] }); }
  if (r && m === 'GET') return ok({ id: r[1], attributes: { assetDeliveryState: { state: st.shots.get(r[1]) ? shotState(st.shots.get(r[1]), true) : 'COMPLETE' } } });
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

// ---------- 356차 ----------
const md5 = (f) => createHash('md5').update(readFileSync(f)).digest('hex');
const SHOT = (n) => `docs/handoff/store/ios-v4/iphone-${String(n).padStart(2, '0')}.png`;
/** 지난 apply 가 6.9형 묶음을 만들고 01(처리 끝)·02(처리 중에 멈춤)만 올린 상태 + 03 은 예전 그림(이름 같고 체크섬 다름) */
function half() {
  const t = fresh(); t.ver = 'DEVELOPER_REJECTED'; t.subs = new Map();
  t.sets.set('set67', { id: 'set67', type: 'APP_IPHONE_67' });
  t.shots.set('k1', { id: 'k1', set: 'set67', name: '01-iphone-01.png', md5: md5(SHOT(1)), pending: 0 });
  t.shots.set('k2', { id: 'k2', set: 'set67', name: '02-iphone-02.png', md5: md5(SHOT(2)), pending: 1e9 });
  t.shots.set('k3', { id: 'k3', set: 'set67', name: '03-iphone-03.png', md5: 'feedbeef', pending: 0 });
  t.rules = { '03-ipad-03.png': { fail: true }, '04-iphone61-04.png': { pending: 5 } };
  return t;
}
const FAST = { ASC_SHOT_WAIT: '2', ASC_FINAL_WAIT_MS: '2000' };

test('ⓓ 처리 대기 초과 → 다음 장으로 · 끝에 다시 확인해 COMPLETE 아닌 장만 다시 올림 · 같은 이름·체크섬 장은 그대로 · 순서·제출', async () => {
  st = half(); calls.length = 0;
  const p = await run({ MODE: 'plan', ...FAST }); assert.equal(p.code, 0, p.out);
  assert.match(p.out, /APP_IPHONE_67: 지울 1장 · 올릴 4장 · 그대로 2장\(같은 이름·체크섬으로 이미 올라감\)/, p.out);
  assert.ok(!calls.some((c) => /^(POST|PATCH|DELETE)/.test(c)));
  st = half(); calls.length = 0;
  const r = await run({ MODE: 'apply', SUBMIT: '1', ...FAST }); assert.equal(r.code, 0, r.out);
  assert.match(r.out, /04-iphone61-04\.png → 처리 중\(UPLOAD_COMPLETE\) — 다음 장으로, 끝에 다시 확인/);
  assert.match(r.out, /03-ipad-03\.png → 처리 실패\(끝에 다시 올림\)/);
  assert.match(r.out, /ⓔ 처리 안 끝난 장 3장 — 끝까지 다시 확인/, r.out);
  assert.match(r.out, /APP_IPHONE_67 02-iphone-02\.png: UPLOAD_COMPLETE → 지우고 다시 올리기/);
  assert.match(r.out, /APP_IPAD_PRO_3GEN_129 03-ipad-03\.png: FAILED → 지우고 다시 올리기/);
  assert.doesNotMatch(r.out, /04-iphone61-04\.png: /, '끝에 처리 끝난 장은 다시 올리지 않음');
  assert.ok(!calls.includes('DELETE /appScreenshots/k1'), '처리 끝난 같은 장(01)은 지우지 않음');
  assert.ok(calls.includes('DELETE /appScreenshots/k3') && calls.includes('DELETE /appScreenshots/k2'), '체크섬 다른 03·멈춘 02 는 지움');
  const n = (name) => st.posts.filter((x) => x === name).length;
  assert.deepEqual([n('01-iphone-01.png'), n('02-iphone-02.png'), n('03-iphone-03.png'), n('03-ipad-03.png'), n('04-iphone61-04.png')], [0, 1, 1, 2, 1]);
  for (const t of ['APP_IPHONE_67', 'APP_IPHONE_61', 'APP_IPAD_PRO_3GEN_129']) {
    const sh = count(t); assert.equal(sh.length, 6, `${t} 6장`); assert.ok(sh.every((x) => shotState(x, false) === 'COMPLETE'), `${t} 모두 처리 끝`);
    const order = [...st.sets.values()].find((x) => x.type === t).order;
    assert.deepEqual(order.map((id) => st.shots.get(id).name), [1, 2, 3, 4, 5, 6].map((k) => `${String(k).padStart(2, '0')}-${t === 'APP_IPHONE_67' ? 'iphone' : t === 'APP_IPHONE_61' ? 'iphone61' : 'ipad'}-${String(k).padStart(2, '0')}.png`), `${t} 순서`);
  }
  assert.equal([...st.sets.values()].find((x) => x.type === 'APP_IPHONE_67').order[0], 'k1');
  assert.ok(!/처리 안 끝난 장:/.test(r.out));
  const nw = [...st.subs.values()][0]; assert.deepEqual([nw?.state, nw?.items], ['WAITING_FOR_REVIEW', 1], '모두 처리 끝 → 제출');
});

test('ⓔ 다시 올려도 처리 안 끝나면 submit=true 여도 제출 안 함 → 애플 처리가 끝난 뒤 다시 돌리면 아무것도 다시 올리지 않고 제출', async () => {
  st = half(); st.rules['02-iphone-02.png'] = { pending: 1e9, always: true }; calls.length = 0;
  const r = await run({ MODE: 'apply', SUBMIT: '1', ...FAST }); assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ⓔ 처리 안 끝난 장: APP_IPHONE_67 02-iphone-02\.png\(UPLOAD_COMPLETE\)/, r.out);
  assert.match(r.out, /처리 안 끝난 스크린샷 APP_IPHONE_67 1장 — 제출하지 않음/);
  assert.ok(!calls.includes('POST /reviewSubmissions') && !calls.some((c) => c.startsWith('PATCH /reviewSubmissions')), '제출 안 함');
  for (const sh of st.shots.values()) sh.pending = 0; // 애플 쪽 처리가 끝남
  delete st.rules['02-iphone-02.png']; const before = st.posts.length; calls.length = 0;
  const r2 = await run({ MODE: 'apply', SUBMIT: '1', ...FAST }); assert.equal(r2.code, 0, r2.out);
  assert.equal(st.posts.length, before, '다시 돌리면 아무것도 다시 올리지 않음');
  assert.ok(!calls.some((c) => c.startsWith('DELETE /appScreenshots/')), '아무것도 지우지 않음');
  assert.match(r2.out, /APP_IPHONE_67: 지울 0장 · 올릴 0장 · 그대로 6장/);
  const nw = [...st.subs.values()][0]; assert.equal(nw?.state, 'WAITING_FOR_REVIEW', '이번엔 제출');
});

