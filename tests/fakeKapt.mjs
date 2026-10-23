// 가짜 K-apt — 로컬 10/23 실측 순서 그대로(구조 시험용. 실제 K-apt 연동 확인은 운영에서):
// ① GET  /kapt/bid/bidDetail.do?bidNum=  → 쿠키 JSESSIONID·KHANUSER + <meta id="_csrf" name="_csrf" content="…">(속성 순서 id → name → content)
// ② POST /kapt/bid/bidFileListData.do?seq=BID_FILE, 본문 JSON {bidNum}, X-CSRF-TOKEN·같은 쿠키 → Accept json 이면 {code:'SCC', data:[{seq, fileName}]}, 아니면 XML.
//    CSRF 가 없으면 200 <Map><state>csrf</state></Map>. 이 호출이 세션에 받을 파일을 등록
// ③ GET  /kapt/cmm/file/BID/fileDownload.do?key=&fileName=&_cb= → ②를 같은 쿠키로 먼저 해야 받힘(아니면 500 XML). 이름은 UTF-8 URL 인코딩·빈칸 '+'·끝에 ';'
// 옛 주소 GET /kapt/bid/bidFileDown.do → 200 text/html 오류 화면(지금 화면의 가짜 .hwp 원인)
export const HWP5 = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(504), Buffer.from('HWP Document File'), Buffer.alloc(64)]);
const javaEnc = (s) => encodeURIComponent(s).replace(/%20/g, '+');
const cookies = (req) => Object.fromEntries(String(req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]));

/** files: { [bidNum]: [{ seq, fileName, body? }] } · detailHtml(bid): 상세 본문(수집기 시험의 표) · fail: 목록을 거절할 공고번호 — 반환: handle(req, res, body) 가 처리했으면 true */
export function fakeKapt({ files = {}, detailHtml = () => '', fail = new Set() } = {}) {
  const sessions = new Map(); const calls = []; let n = 0;
  const handle = (req, res, body = '') => {
    const u = new URL(req.url, 'http://x'); const p = u.pathname;
    if (!p.startsWith('/kapt/bid/bidDetail.do') && !p.startsWith('/kapt/bid/bidFileListData.do') && !p.startsWith('/kapt/cmm/file/') && !p.startsWith('/kapt/bid/bidFileDown.do')) return false;
    const sid = cookies(req).JSESSIONID; const s = sid ? sessions.get(sid) : null;
    calls.push({ path: p, method: req.method, q: Object.fromEntries(u.searchParams), cookie: req.headers.cookie ?? '', referer: req.headers.referer ?? '', csrf: req.headers['x-csrf-token'] ?? '', type: req.headers['content-type'] ?? '', accept: req.headers.accept ?? '', body });
    if (p === '/kapt/bid/bidDetail.do') {
      const id = `S${++n}`; const csrf = `csrf-${n}`; sessions.set(id, { csrf, listed: new Set() });
      res.writeHead(200, { 'content-type': 'text/html;charset=UTF-8', 'set-cookie': [`JSESSIONID=${id}; Path=/; HttpOnly`, `KHANUSER=k${n}; Path=/`] });
      res.end(`<!DOCTYPE html><html><head><meta id="_csrf" name="_csrf" content="${csrf}" /><meta id="_csrf_header" name="_csrf_header" content="X-CSRF-TOKEN" /></head><body>${detailHtml(u.searchParams.get('bidNum'))}</body></html>`);
      return true;
    }
    if (p === '/kapt/bid/bidFileListData.do') {
      let bid = null; try { bid = JSON.parse(body).bidNum; } catch { /* 아래 */ }
      if (req.method !== 'POST' || u.searchParams.get('seq') !== 'BID_FILE' || !s || req.headers['x-csrf-token'] !== s.csrf || !/application\/json/.test(req.headers['content-type'] ?? '') || !bid || fail.has(bid)) {
        res.writeHead(200, { 'content-type': 'application/xml' }); res.end('<Map><state>csrf</state></Map>'); return true;
      }
      const list = files[bid] ?? []; for (const f of list) s.listed.add(String(f.seq));
      if (/json/.test(req.headers.accept ?? '')) { res.writeHead(200, { 'content-type': 'application/json;charset=UTF-8' }); res.end(JSON.stringify({ code: 'SCC', msg: '정상적으로 처리되었습니다.', data: list.map((f) => ({ seq: Number(f.seq), fileName: f.fileName })) })); }
      else { res.writeHead(200, { 'content-type': 'application/xml' }); res.end(`<Res><code>SCC</code><msg>정상적으로 처리되었습니다.</msg>${list.map((f) => `<data><seq>${f.seq}</seq><fileName>${f.fileName}</fileName></data>`).join('')}</Res>`); }
      return true;
    }
    if (p === '/kapt/cmm/file/BID/fileDownload.do') {
      const key = u.searchParams.get('key'); const f = Object.values(files).flat().find((x) => String(x.seq) === key);
      if (!s || !s.listed.has(String(key)) || !f) { res.writeHead(500, { 'content-type': 'application/xml' }); res.end('<Res><code>ERR</code><msg>잘못된 요청입니다.</msg></Res>'); return true; }
      const data = f.body ?? HWP5;
      res.writeHead(200, { 'content-type': 'application/octet-stream;charset=UTF-8', 'content-length': String(data.length), 'content-disposition': `attachment; filename=${javaEnc(f.fileName)};` }); res.end(data);
      return true;
    }
    // 옛 주소(원본 영업관리 중계·지금 화면): 오류 화면 HTML
    res.writeHead(200, { 'content-type': 'text/html;charset=UTF-8' }); res.end(`<!DOCTYPE HTML><html><head><title>오류</title></head><body>${'요청하신 페이지를 찾을 수 없습니다. '.repeat(40)}</body></html>`);
    return true;
  };
  return { handle, calls, sessions };
}
