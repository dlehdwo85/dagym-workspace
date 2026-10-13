// 시험용 가짜 Google OAuth + Calendar API v3 + FCM + Web Push 수신 서버.
// 실제 Google 동작 중 동기화에 필요한 부분(syncToken, 410, ETag/If-Match 412, watch, 취소 상태)을 흉내 낸다.
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function startFakeGoogle(port = 3199) {
  const state = {
    seq: 1,
    calendars: { primary: { id: 'primary', summary: '테스트 개인 캘린더', primary: true, accessRole: 'owner', timeZone: 'Asia/Seoul' },
      'readonly@group': { id: 'readonly@group', summary: '공유받은 캘린더', accessRole: 'reader', timeZone: 'Asia/Seoul' } },
    events: {}, // cal -> id -> event
    invalidGrant: false,
    expireSyncToken: false,
    watches: [],
    stops: [],
    fcm: [],
    openai: [],
    fcmUnregistered: new Set(),
    webpush: [],
    webpushGone: new Set(),
    requests: [],
  };
  const evs = (cal) => (state.events[cal] ??= {});
  const touch = (e) => { e.seq = ++state.seq; e.etag = `"${state.seq}"`; e.updated = new Date().toISOString(); return e; };
  const pub = (e) => { const { seq, ...rest } = e; return rest; };

  function json(res, code, body) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); }

  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const url = new URL(req.url, `http://localhost:${port}`);
    const p = url.pathname;
    state.requests.push({ method: req.method, path: p, query: url.search });
    const body = raw && (req.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) : raw;

    // ---- 가짜 OpenAI (매출 AI 분석): 받은 요청을 기록하고, 입력의 첫 현장·월로 정해진 JSON 을 돌려준다 ----
    if (p === '/openai/v1/chat/completions' && req.method === 'POST') {
      state.openai.push({ auth: req.headers.authorization, body });
      const input = JSON.parse(body.messages.find((m) => m.role === 'user').content);
      const row = input.rows.find((r) => r.month === input.period) ?? input.rows[0];
      const content = JSON.stringify({
        summary: `${row.site} ${row.month} 매출은 ${row.revenue}원입니다.`,
        anomalies: [{ site: row.site, month: row.month, metric: 'revenue', comment: '전월 대비 크게 늘었습니다.' }, { site: '없는 현장', month: row.month, metric: 'revenue', comment: '지어낸 제안' }],
        comparisons: [{ site: row.site, comment: '가장 높습니다.' }],
      });
      return json(res, 200, { choices: [{ message: { role: 'assistant', content } }], usage: { total_tokens: 321 } });
    }
    // ---- 제어용 ----
    if (p === '/__state') return json(res, 200, { ...state, fcmUnregistered: [...state.fcmUnregistered], webpushGone: [...state.webpushGone] });
    if (p === '/__ctl' && req.method === 'POST') {
      if ('invalidGrant' in body) state.invalidGrant = body.invalidGrant;
      if ('expireSyncToken' in body) state.expireSyncToken = body.expireSyncToken;
      if (body.fcmUnregister) state.fcmUnregistered.add(body.fcmUnregister);
      if (body.webpushGone) state.webpushGone.add(body.webpushGone);
      if (body.googleEdit) { // Google 쪽에서 사용자가 직접 수정
        const e = evs(body.googleEdit.cal)[body.googleEdit.id];
        Object.assign(e, body.googleEdit.patch); touch(e);
      }
      if (body.googleCreate) { const e = { id: randomUUID().replace(/-/g, ''), status: 'confirmed', ...body.googleCreate.event }; touch(e); evs(body.googleCreate.cal)[e.id] = e; return json(res, 200, pub(e)); }
      if (body.googleDelete) { const e = evs(body.googleDelete.cal)[body.googleDelete.id]; e.status = 'cancelled'; touch(e); }
      return json(res, 200, { ok: true });
    }

    // ---- OAuth ----
    if (p === '/auth') {
      const redirect = url.searchParams.get('redirect_uri');
      const st = url.searchParams.get('state');
      res.writeHead(302, { location: `${redirect}?code=fakecode&state=${st}&scope=${encodeURIComponent(url.searchParams.get('scope'))}` });
      state.lastScope = url.searchParams.get('scope');
      return res.end();
    }
    if (p === '/token') {
      const f = new URLSearchParams(raw);
      const gt = f.get('grant_type');
      if (gt === 'urn:ietf:params:oauth:grant-type:jwt-bearer') return json(res, 200, { access_token: 'fcm-access', expires_in: 3600 });
      if (gt === 'refresh_token' && state.invalidGrant) return json(res, 400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      const idt = 'x.' + Buffer.from(JSON.stringify({ email: 'tester@gmail.example' })).toString('base64url') + '.y';
      return json(res, 200, { access_token: 'acc-' + randomUUID(), refresh_token: gt === 'authorization_code' ? 'ref-1' : undefined, expires_in: 2, scope: state.lastScope ?? 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly', id_token: idt });
    }
    if (p === '/revoke') return json(res, 200, {});

    // ---- FCM ----
    const fm = /^\/v1\/projects\/([^/]+)\/messages:send$/.exec(p);
    if (fm) {
      if (state.fcmUnregistered.has(body.message.token)) return json(res, 404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
      state.fcm.push(body.message);
      return json(res, 200, { name: `projects/${fm[1]}/messages/${state.fcm.length}` });
    }
    // ---- Web Push ----
    if (p.startsWith('/webpush/')) {
      if (state.webpushGone.has(p)) return json(res, 410, {});
      state.webpush.push({ path: p, headers: req.headers, size: raw.length });
      res.writeHead(201); return res.end();
    }

    // ---- Calendar API ----
    const base = '/calendar/v3';
    if (!p.startsWith(base)) return json(res, 404, { error: { message: 'unknown' } });
    if (!(req.headers.authorization ?? '').startsWith('Bearer acc-')) return json(res, 401, { error: { message: 'Invalid Credentials' } });
    const rest = p.slice(base.length);
    if (rest === '/users/me/calendarList') return json(res, 200, { items: Object.values(state.calendars) });
    let m = /^\/users\/me\/calendarList\/(.+)$/.exec(rest);
    if (m) { const c = state.calendars[decodeURIComponent(m[1])]; return c ? json(res, 200, c) : json(res, 404, { error: { message: 'Not Found' } }); }
    if (rest === '/channels/stop') { state.stops.push(body); return json(res, 204); }
    m = /^\/calendars\/([^/]+)\/events\/watch$/.exec(rest);
    if (m) { const w = { ...body, resourceId: 'res-' + randomUUID(), expiration: String(Date.now() + 7 * 86400000) }; state.watches.push(w); return json(res, 200, { kind: 'api#channel', id: body.id, resourceId: w.resourceId, expiration: w.expiration }); }
    m = /^\/calendars\/([^/]+)\/events$/.exec(rest);
    if (m) {
      const cal = decodeURIComponent(m[1]);
      if (req.method === 'POST') {
        const id = randomUUID().replace(/-/g, '');
        const e = touch({ ...body, id, status: 'confirmed', kind: 'calendar#event' });
        evs(cal)[id] = e;
        return json(res, 200, pub(e));
      }
      const st = url.searchParams.get('syncToken');
      if (st && state.expireSyncToken) { state.expireSyncToken = false; return json(res, 410, { error: { code: 410, message: 'Sync token is no longer valid, a full sync is required.' } }); }
      let items = Object.values(evs(cal));
      const priv = url.searchParams.get('privateExtendedProperty');
      if (priv) { const [k, v] = priv.split('='); items = items.filter((e) => e.extendedProperties?.private?.[k] === v && e.status !== 'cancelled'); }
      else if (st) items = items.filter((e) => e.seq > Number(st));
      else if (url.searchParams.get('showDeleted') !== 'true') items = items.filter((e) => e.status !== 'cancelled');
      // 페이지 나누기 (2개씩) — 페이지 처리 시험
      const page = Number(url.searchParams.get('pageToken') ?? 0);
      const chunk = items.slice(page, page + 2);
      const next = page + 2 < items.length ? String(page + 2) : undefined;
      return json(res, 200, { items: chunk.map(pub), nextPageToken: next, nextSyncToken: next ? undefined : String(state.seq) });
    }
    m = /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(rest);
    if (m) {
      const cal = decodeURIComponent(m[1]); const id = decodeURIComponent(m[2]);
      let e = evs(cal)[id];
      // 반복 회차 id (master_YYYYMMDDTHHMMSSZ)
      if (!e && /_\d{8}(T\d{6}Z)?$/.test(id) && req.method === 'PATCH') {
        const [mid, ts] = id.split(/_(?=\d{8})/);
        const master = evs(cal)[mid];
        if (!master) return json(res, 404, { error: { message: 'Not Found' } });
        const orig = ts.length === 8 ? { date: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` } : { dateTime: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(9, 11)}:${ts.slice(11, 13)}:${ts.slice(13, 15)}Z` };
        e = { id, recurringEventId: mid, originalStartTime: orig, status: 'confirmed', summary: master.summary, start: master.start, end: master.end };
        evs(cal)[id] = e;
      }
      if (!e) return json(res, 404, { error: { message: 'Not Found' } });
      if (req.method === 'GET') return json(res, 200, pub(e));
      if (req.method === 'DELETE') { if (e.status === 'cancelled') return json(res, 410, { error: { message: 'Resource has been deleted' } }); e.status = 'cancelled'; touch(e); return json(res, 204); }
      if (req.method === 'PATCH') {
        const im = req.headers['if-match'];
        if (im && im !== e.etag) return json(res, 412, { error: { code: 412, message: 'Precondition Failed' } });
        Object.assign(e, body); touch(e);
        return json(res, 200, pub(e));
      }
    }
    return json(res, 404, { error: { message: 'unknown ' + rest } });
  });
  // 웹 푸시 라이브러리는 https 만 쓰므로 자체 서명 인증서로 같은 처리기를 https 에도 연다
  let tlsServer = null;
  if (process.env.FAKE_TLS_KEY) {
    tlsServer = https.createServer({ key: readFileSync(process.env.FAKE_TLS_KEY), cert: readFileSync(process.env.FAKE_TLS_CERT) }, (req, res) => server.emit('request', req, res));
    tlsServer.listen(port + 1);
  }
  const close = () => { server.close(); tlsServer?.close(); };
  return new Promise((resolve) => server.listen(port, () => resolve({ server: { close }, state, url: `http://localhost:${port}` })));
}
