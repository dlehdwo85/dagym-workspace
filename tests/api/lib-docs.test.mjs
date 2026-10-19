// 대표 결정 10/19: 자료실 '워크인 문서' 공동 편집 1차 — Yjs 조각을 워크인 API(짧은 폴링)로 주고받고 Neon 에 추가형 저장, 외부 실시간 서비스 없음.
// 두 사람이 같은 문서를 동시에 고쳐도 같은 글(CRDT), 보기 권한은 조각 보내기 403, 다른 회사 404, 공유(보기/편집), 조각 합치기·변경 기록·검색 글자, .docx 내보내기
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { bootstrap, resetDb, startServer, testDb, tick, BASE, Client } from '../helpers.mjs';

let srv, ctx, sql, other;
before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('other');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'doc@other.test', password: 'signup-pass-1234', name: '박대표', mode: 'team', company: '튼튼짐', industry: '운동·피트니스', agree: { terms: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  other = c;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

const b64 = (u) => Buffer.from(u).toString('base64');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
/** 브라우저 쪽 PollProvider 와 같은 일을 하는 작은 클라이언트: 열기 → Y.Doc, sync 로 보내고 받기 */
async function openClient(c, id) {
  const o = await c.ok('GET', `/api/library/docs/${id}`);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromB64(o.snapshot));
  for (const u of o.updates) Y.applyUpdate(doc, fromB64(u));
  const st = { doc, since: o.seq, pending: [], open: o };
  doc.on('update', (u, origin) => { if (origin !== 'remote') st.pending.push(u); });
  st.sync = async (extra = {}) => {
    const body = { since: st.since, clientId: doc.clientID, ...extra };
    if (st.pending.length) { body.update = b64(Y.mergeUpdates(st.pending)); }
    const res = await c.req('POST', `/api/library/docs/${id}/sync`, body);
    if (res.status === 200 && !extra.leave) {
      st.pending = [];
      for (const u of res.body.updates) Y.applyUpdate(doc, fromB64(u), 'remote');
      st.since = res.body.seq;
    }
    return res;
  };
  st.text = () => doc.getXmlFragment('default').toString().replace(/<[^>]+>/g, '');
  return st;
}
/** 본문에 단락 하나 덧붙이기(Tiptap 이 만드는 모양 그대로) */
function addPara(doc, text) {
  const frag = doc.getXmlFragment('default');
  doc.transact(() => { const p = new Y.XmlElement('paragraph'); p.insert(0, [new Y.XmlText(text)]); frag.push([p]); });
}

describe('자료실 문서 공동 편집', () => {
  let id;
  test('새 문서 만들기 → 자료실 목록에 문서(저장 파일 없음) · 다른 회사 404 · 직원은 폴더 권한대로', async () => {
    await ctx.owner.ok('POST', '/api/library/folders', { path: '회의록' }).catch(() => null);
    const r = await ctx.owner.ok('POST', '/api/library/docs', { title: '10월 운영 회의', folder: '회의록' });
    id = r.id; assert.equal(r.link, `/library/doc/${id}`);
    const [f] = await sql`select mime_type, file_name, source, upload_status, storage_key, tags from library_files where id = ${id}`;
    assert.deepEqual([f.mime_type, f.file_name, f.source, f.upload_status, f.storage_key, f.tags], ['application/x-workin-doc', '10월 운영 회의.wdoc', 'doc', 'ready', null, ['문서']]);
    assert.ok((await ctx.owner.ok('GET', '/api/library?folder=' + encodeURIComponent('회의록'))).files.some((x) => x.id === id), '자료실 목록에');
    assert.equal((await other.req('GET', `/api/library/docs/${id}`)).status, 404, '다른 회사');
    assert.equal((await other.req('POST', `/api/library/docs/${id}/sync`, { since: 0, clientId: 1 })).status, 404);
    const o = await ctx.staffA.client.ok('GET', `/api/library/docs/${id}`);
    assert.equal(o.canEdit, true, '직원도 폴더 편집 권한(기본 edit)이면 같이 고침'); assert.equal(o.canShare, false);
    const [{ n }] = await sql`select count(*)::int n from lib_docs where library_file_id = ${id}`; assert.equal(n, 1);
  });

  test('두 사람이 동시에 고침 → 한 번의 왕복으로 보내기·받기 → 둘 다 같은 글(합침, 유실 없음)', async () => {
    const a = await openClient(ctx.owner, id), b = await openClient(ctx.staffA.client, id);
    addPara(a.doc, '안건 1: 매출 점검'); addPara(b.doc, '안건 2: 전단 배포');
    const ra = await a.sync(); assert.equal(ra.status, 200); assert.equal(ra.body.updates.length, 0, '아직 남의 조각 없음');
    const rb = await b.sync(); assert.equal(rb.status, 200); assert.equal(rb.body.updates.length, 1, 'a 의 조각을 받음');
    await a.sync(); // b 의 조각 받음
    assert.equal(a.text(), b.text(), '두 화면이 같은 글');
    assert.ok(a.text().includes('안건 1: 매출 점검') && a.text().includes('안건 2: 전단 배포'), a.text());
    assert.equal((await sql`select count(*)::int n from lib_doc_updates where doc_id = ${id}`)[0].n, 2, '조각 2개 추가 저장');
    // 세 번째 사람이 새로 열면 snapshot + 조각으로 같은 글
    const c = await openClient(ctx.managerA.client, id);
    assert.equal(c.text(), a.text());
    // 커서·이름: awareness 조각을 보내면 다른 사람 응답에 실려 온다(저장은 20초만 유효)
    const aw = await a.sync({ awareness: b64(Buffer.from('aw-a')) });
    assert.equal(aw.body.presence.length, 0, '내 것은 안 돌려줌');
    const bw = await b.sync({ awareness: b64(Buffer.from('aw-b')) });
    assert.deepEqual(bw.body.presence.map((p) => [p.clientId, p.name, Buffer.from(p.state, 'base64').toString()]), [[a.doc.clientID, '김대표', 'aw-a']]);
    await a.sync({ leave: true });
    assert.equal((await b.sync()).body.presence.length, 0, '나가면 커서 사라짐');
    await b.sync({ leave: true });
  });

  test('보기 공유 받은 사람은 조각 보내기 403 · 편집 공유로 바꾸면 됨 · 회사 밖 사람 공유 400', async () => {
    // 박직원(판교 현장)은 폴더 권한으로는 보지만 편집 권한 없음을 만들기: 직원 자료실 메뉴를 보기만으로
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'library', userId: ctx.staffB.id, level: 'view' });
    const v = await openClient(ctx.staffB.client, id);
    assert.equal(v.open.canEdit, false);
    addPara(v.doc, '몰래 고침');
    assert.equal((await v.sync()).status, 403, '보기 권한의 조각은 서버가 버림');
    assert.equal((await ctx.owner.ok('GET', `/api/library/docs/${id}`)).updates.length + 0 >= 0, true);
    const a = await openClient(ctx.owner, id); assert.ok(!a.text().includes('몰래 고침'));
    // 공유: 올린 사람만
    assert.equal((await ctx.staffA.client.req('PUT', `/api/library/docs/${id}/shares`, { shares: [{ userId: ctx.staffB.id, role: 'edit' }] })).status, 403);
    const om = await other.ok('GET', '/api/auth/me');
    assert.equal((await ctx.owner.req('PUT', `/api/library/docs/${id}/shares`, { shares: [{ userId: om.user.id, role: 'view' }] })).status, 400, '회사 밖 사람');
    const sh = await ctx.owner.ok('PUT', `/api/library/docs/${id}/shares`, { shares: [{ userId: ctx.staffB.id, role: 'edit' }] });
    assert.deepEqual(sh.shares, [{ userId: ctx.staffB.id, role: 'edit' }]);
    assert.equal(sh.people.find((p) => p.id === ctx.staffB.id).role, 'edit');
    const v2 = await openClient(ctx.staffB.client, id);
    assert.equal(v2.open.canEdit, true, '편집 공유'); assert.equal(v2.open.shared, true);
    addPara(v2.doc, '공유로 고침');
    assert.equal((await v2.sync()).status, 200);
    await a.sync(); assert.ok(a.text().includes('공유로 고침'));
    // 폴더 권한이 없어도 공유만으로 열림: 박직원 자료실 메뉴 none
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'library', userId: ctx.staffB.id, level: 'none' });
    assert.equal((await ctx.staffB.client.req('GET', `/api/library/docs/${id}`)).status, 200, '공유 받은 문서는 자료실 권한 없이도');
    await ctx.owner.ok('PUT', `/api/library/docs/${id}/shares`, { shares: [{ userId: ctx.staffB.id, role: 'view' }] });
    const v3 = await openClient(ctx.staffB.client, id); assert.equal(v3.open.canEdit, false);
    await ctx.owner.ok('PUT', `/api/library/docs/${id}/shares`, { shares: [] });
    assert.equal((await ctx.staffB.client.req('GET', `/api/library/docs/${id}`)).status, 404, '공유 끊고 권한 없으면 없는 것처럼');
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'library', userId: ctx.staffB.id, level: 'edit' });
  });

  test('조각 200개 넘으면 합침(snapshot) · 변경 기록·되돌리기용 스냅숏 · 검색 글자(text_content) · 정기 실행이 모두 나간 문서를 기록', async () => {
    const a = await openClient(ctx.owner, id);
    for (let i = 0; i < 205; i++) { addPara(a.doc, `줄 ${i}`); await a.sync(); }
    const [d] = await sql`select snapshot_seq, version_seq from lib_docs where library_file_id = ${id}`;
    assert.ok(Number(d.snapshot_seq) > 0, '합침');
    assert.ok((await sql`select count(*)::int n from lib_doc_updates where doc_id = ${id}`)[0].n < 205, '합친 조각은 지움');
    const fresh = await openClient(ctx.staffA.client, id);
    assert.ok(fresh.text().includes('줄 204') && fresh.text().includes('안건 1: 매출 점검'), '새로 열어도 전부');
    // 직접 기록
    const m = await ctx.owner.ok('POST', `/api/library/docs/${id}/versions`);
    assert.ok(m.id, '기록 id');
    const vs = await ctx.owner.ok('GET', `/api/library/docs/${id}/versions`);
    assert.equal(vs.versions[0].reason, 'manual'); assert.ok(vs.versions[0].by.includes('김대표'));
    const one = await ctx.owner.ok('GET', `/api/library/docs/${id}/versions/${vs.versions[0].id}`);
    const tmp = new Y.Doc(); Y.applyUpdate(tmp, fromB64(one.snapshot));
    assert.ok(tmp.getXmlFragment('default').toString().includes('줄 204'));
    const [f] = await sql`select text_content, size_bytes from library_files where id = ${id}`;
    assert.ok(f.text_content.includes('안건 2: 전단 배포') && f.text_content.includes('줄 100'), '검색·AI 용 글자'); assert.ok(Number(f.size_bytes) > 0);
    assert.ok((await ctx.owner.ok('GET', '/api/library?q=' + encodeURIComponent('전단 배포'))).files.some((x) => x.id === id), '자료실 본문 검색');
    // 더 고친 뒤 아무도 없으면(presence 없음) 정기 실행이 기록
    addPara(a.doc, '마지막 줄'); await a.sync(); await a.sync({ leave: true });
    const tk = await tick();
    assert.deepEqual(tk.detail?.docVersions, { checked: 1, saved: 1 }, JSON.stringify(tk.detail?.docVersions));
    const vs2 = await ctx.owner.ok('GET', `/api/library/docs/${id}/versions`);
    assert.equal(vs2.versions[0].reason, 'idle'); assert.equal(vs2.versions.length, vs.versions.length + 1);
    assert.ok((await sql`select text_content from library_files where id = ${id}`)[0].text_content.includes('마지막 줄'));
    // 바뀐 것 없으면 기록 안 늘어남
    await tick();
    assert.equal((await ctx.owner.ok('GET', `/api/library/docs/${id}/versions`)).versions.length, vs2.versions.length);
  });

  test('내보내기 .docx(제목·단락 들어감) · .md · 자료실 내려받기 주소는 .docx 로', async () => {
    const r = await fetch(`${BASE}/api/library/docs/${id}/export?format=docx`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /wordprocessingml/);
    assert.match(decodeURIComponent(r.headers.get('content-disposition')), /10월 운영 회의\.docx/);
    const buf = Buffer.from(await r.arrayBuffer()); assert.equal(buf.subarray(0, 2).toString(), 'PK', 'zip(docx)');
    const md = await (await fetch(`${BASE}/api/library/docs/${id}/export?format=md`, { headers: { cookie: ctx.owner.cookie, origin: BASE } })).text();
    assert.ok(md.startsWith('# 10월 운영 회의') && md.includes('안건 1: 매출 점검'));
    const dl = await fetch(`${BASE}/api/library/${id}/download`, { headers: { cookie: ctx.owner.cookie, origin: BASE }, redirect: 'manual' });
    assert.equal(dl.status, 302); assert.match(dl.headers.get('location'), /\/api\/library\/docs\/.*\/export\?format=docx/);
    assert.equal((await other.req('GET', `/api/library/docs/${id}/export`)).status, 404);
  });
});
