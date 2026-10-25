// 시험용 가짜 Google OAuth + Calendar API v3 + FCM + Web Push 수신 서버.
// 실제 Google 동작 중 동기화에 필요한 부분(syncToken, 410, ETag/If-Match 412, watch, 취소 상태)을 흉내 낸다.
import http from 'node:http';
import https from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const FAKE_ORIGIN = (req) => `http://${req.headers.host}`;
// #454 가짜 Higgsfield 영상 결과·가짜 TTS 는 진짜 mp4·mp3(작게) — 서버 합성(ffmpeg)이 실제로 돈다. ffmpeg 위치는 앱과 같은 순서
const FFMPEG = [process.env.FFMPEG_PATH, join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')].find((x) => x && existsSync(x)) ?? 'ffmpeg';
const media = new Map();
function makeMedia(key, args) {
  if (media.has(key)) return media.get(key);
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args, '-f', key.endsWith('mp3') ? 'mp3' : 'mp4', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
  const out = r.status === 0 && r.stdout?.length ? r.stdout : null; if (out) media.set(key, out); return out;
}
const fakeClip = (sec, ar) => { const [w, h] = ar === '16:9' ? [640, 360] : ar === '1:1' ? [480, 480] : [360, 640];
  return makeMedia(`clip-${sec}-${ar}.mp4`, ['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=24:d=${sec}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov']); };
const fakeMp3 = (sec, hz = 440) => makeMedia(`tone-${sec}-${hz}.mp3`, ['-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${sec}`, '-c:a', 'libmp3lame', '-b:a', '64k']);
export { fakeMp3 };
/** 마케팅 원고 기본 답(넣어 둔 응답이 없을 때) — 요청 순서로 두 문장을 골라 글마다 다르게 */
const DRAFT_LINES = ['이번 주 소식을 짧게 정리했습니다.', '처음 오시는 분이 자주 묻는 것을 모았습니다.', '현장에서 있었던 일을 한 장면으로 남깁니다.', '준비물과 순서를 차례로 적었습니다.',
  '토요일 오후 일정을 미리 알려 드립니다.', '지난주 받은 질문에 답을 달았습니다.', '사진 한 장으로 보는 이번 주 모습입니다.', '알아 두면 편한 이용 방법 두 가지입니다.'];
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
    anthropic: [], // 받은 /v1/messages 요청
    anthropicQueue: [], // 다음 응답들 (비면 짧은 글 답)
    anthropicFiles: {}, // V22 Files API: id → { filename, mime, b64 } (코드 실행 결과·올린 파일)
    anthropicUploads: [], // 올린 파일 이름 기록
    classified: [], classifyQueue: [], // V14 5번 업무 무관 질문 분류
    vision: [], visionQueue: [], // #235 ⓒ 사진 AI 설명(다른 응답 줄과 따로)
    fcmUnregistered: new Set(),
    webpush: [],
    webpushGone: new Set(),
    requests: [],
    hf: [], hfJobs: {}, hfMode: null, hfPolls: 1, // 로컬 10/22 가짜 Higgsfield(/hf): 제출 기록·요청 상태(hfPolls 번 in_progress 뒤 completed)
    tts: [], // #454 가짜 TTS 요청 기록
  };
  const evs = (cal) => (state.events[cal] ??= {});
  const touch = (e) => { e.seq = ++state.seq; e.etag = `"${state.seq}"`; e.updated = new Date().toISOString(); return e; };
  const pub = (e) => { const { seq, ...rest } = e; return rest; };

  function json(res, code, body) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); }
  // #497 R44: stream: true 요청은 실제 API 처럼 SSE 로 — 글은 8조각쯤(조각 사이 chunkDelayMs), 도구 입력은 input_json_delta 로
  async function sseMessage(res, msg, delay) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    const { content = [], stop_reason, usage, ...head } = msg;
    ev('message_start', { message: { ...head, content: [], stop_reason: null, usage: { ...usage, output_tokens: 1 } } });
    for (const [index, b] of content.entries()) {
      if (b.type === 'text') {
        ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
        const chars = Array.from(b.text ?? ''); const step = Math.max(1, Math.ceil(chars.length / 8));
        for (let k = 0; k < chars.length; k += step) {
          ev('content_block_delta', { index, delta: { type: 'text_delta', text: chars.slice(k, k + step).join('') } });
          if (delay) await new Promise((r) => setTimeout(r, delay));
        }
      } else if (/tool_use$/.test(b.type)) {
        ev('content_block_start', { index, content_block: { ...b, input: {} } });
        ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input ?? {}) } });
      } else ev('content_block_start', { index, content_block: b });
      ev('content_block_stop', { index });
    }
    ev('message_delta', { delta: { stop_reason: stop_reason ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
    ev('message_stop', {});
    res.end();
  }

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
    // ---- 가짜 OpenAI 음성 인식(#109 영상 음성 STT): multipart 를 받은 척하고 정해진 녹취를 돌려준다 ----
    if (p === '/openai/v1/audio/transcriptions' && req.method === 'POST') {
      state.openai.push({ auth: req.headers.authorization, kind: 'transcription', size: Buffer.byteLength(raw ?? ''), model: /name="model"\r\n\r\n([^\r]+)/.exec(String(raw))?.[1] ?? null });
      return json(res, 200, { text: '다음 주 수요일까지 강남점 간판 교체 견적 받아 주세요. 그리고 전단지 초안은 금요일에 보겠습니다.' });
    }
    // ---- 가짜 Anthropic Files API (V22 문서 엔진) ----
    if (p === '/v1/files' && req.method === 'POST') {
      const filename = /filename="([^"]+)"/.exec(raw)?.[1] ?? 'upload';
      const id = `file_up_${state.anthropicUploads.length + 1}`;
      state.anthropicUploads.push(decodeURIComponent(filename));
      state.anthropicFiles[id] = { filename, mime: 'application/octet-stream', b64: '' };
      return json(res, 200, { id, type: 'file', filename, mime_type: 'application/octet-stream', size_bytes: raw.length, created_at: new Date().toISOString(), downloadable: false });
    }
    if (p === '/v1/files' && req.method === 'GET') { // 목록(최신순) — scope_id 를 주면 그 컨테이너 범위만(가짜는 scope 를 기록하지 않으므로 빈 목록)
      if (url.searchParams.get('scope_id')) return json(res, 200, { data: [], has_more: false, first_id: null, last_id: null });
      const data = Object.entries(state.anthropicFiles).reverse().map(([id, f]) => ({ id, type: 'file', filename: f.filename, mime_type: f.mime, size_bytes: Buffer.from(f.b64 ?? '', 'base64').length, created_at: f.at ?? new Date().toISOString(), downloadable: !id.startsWith('file_up_') }));
      return json(res, 200, { data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null });
    }
    const afm = /^\/v1\/files\/([^/]+)(\/content)?$/.exec(p);
    if (afm && req.method === 'GET') {
      const f = state.anthropicFiles[afm[1]];
      if (!f) return json(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'file not found' } });
      if (afm[2]) { res.writeHead(200, { 'content-type': f.mime }); return res.end(Buffer.from(f.b64, 'base64')); }
      return json(res, 200, { id: afm[1], type: 'file', filename: f.filename, mime_type: f.mime, size_bytes: Buffer.from(f.b64, 'base64').length, created_at: new Date().toISOString(), downloadable: true });
    }
    // ---- 가짜 Anthropic Messages API (V9 AI 비서): 요청을 기록하고, 시험이 넣어 둔 응답을 차례로 돌려준다 ----
    if (p === '/v1/messages' && req.method === 'POST') {
      // V14 5번: 업무 무관 질문 분류(가벼운 모델)는 시험 응답 줄을 쓰지 않고 따로 답한다(기본: 업무 맞음)
      if (String(body.system ?? '').startsWith('WORKIN_TOPIC_CLASSIFIER')) {
        state.classified.push(body.messages[0].content);
        const work = state.classifyQueue.length ? state.classifyQueue.shift() : true;
        return json(res, 200, { id: `msg_c${state.classified.length}`, type: 'message', role: 'assistant', model: body.model, stop_sequence: null, stop_reason: 'end_turn',
          usage: { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'text', text: JSON.stringify({ work }) }] });
      }
      // #235 ⓒ 사진 AI 설명(구조화 출력 caption·promo·faces): 다른 시험이 줄 세운 응답과 섞이지 않게 따로 받고(state.vision) 따로 답함(visionQueue)
      //   기본 답 = 중립 판정(실사·글자 조금·홍보물 아님 → 그래픽도 아니고 바탕 후보도 아님 — 예전 이름 규칙 결과 그대로)
      if (['caption', 'promo', 'faces'].every((k) => body.output_config?.format?.schema?.required?.includes(k))) {
        state.vision.push(body);
        const v = state.visionQueue.length ? state.visionQueue.shift() : null;
        if (v?.httpError) return json(res, v.httpError, { type: 'error', error: { type: v.errorType ?? 'api_error', message: v.message ?? 'error' } });
        const out = { caption: '실내를 찍은 사진', scene: '실내 모습입니다.', tags: ['실내'], kind: 'photo', text: 'little', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...(v ?? {}) };
        return json(res, 200, { id: `msg_v${state.vision.length}`, type: 'message', role: 'assistant', model: body.model, stop_sequence: null, stop_reason: 'end_turn',
          usage: { input_tokens: 1600, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: 'text', text: JSON.stringify(out) }] });
      }
      state.anthropic.push({ key: req.headers['x-api-key'], beta: req.headers['anthropic-beta'] ?? null, body });
      let next = state.anthropicQueue.shift();
      // 매출 AI 분석(구조화 출력)인데 넣어 둔 응답이 없으면: 입력의 첫 현장·월로 정해진 JSON (예전 가짜 OpenAI 와 같은 모양)
      if (!next && body.output_config?.format?.schema?.required?.includes('anomalies')) {
        const input = JSON.parse(body.messages.find((m) => m.role === 'user').content);
        const row = input.rows.find((r) => r.month === input.period) ?? input.rows[0];
        next = { content: [{ type: 'text', text: JSON.stringify({
          summary: `${row.site} ${row.month} 매출은 ${row.revenue}원입니다.`,
          anomalies: [{ site: row.site, month: row.month, metric: 'revenue', comment: '전월 대비 크게 늘었습니다.' }, { site: '없는 현장', month: row.month, metric: 'revenue', comment: '지어낸 제안' }],
          comparisons: [{ site: row.site, comment: '가장 높습니다.' }],
          // #161 새 보고서 칸(동향·전망·대안·확인 필요) — 스키마가 요구할 때만
          ...(body.output_config.format.schema.required.includes('forecast') ? {
            trend: `${row.site} 매출이 최근 3개월 평균보다 높습니다.`, forecast: [{ site: '전체', comment: '최근 추세가 이어진다는 가정의 추정입니다.' }, { site: '없는 현장', comment: '지어낸 전망' }],
            actions: [{ site: row.site, items: ['재등록 안내를 이번 달 안에 보내기', '오전 시간대 프로그램 늘리기'] }], checks: ['다른 현장 자료가 빠졌는지 확인'] } : {}) }) }], stop_reason: 'end_turn' };
      }
      // 로컬 QA 10/24 ①: 마케팅 원고(구조화 출력 title·body·brief…)인데 넣어 둔 응답이 없으면 — 실제 API 처럼 스키마 모양 JSON
      // 로컬 QA 10/24 ②: 올리기 전 자동 검사를 통과하는 형식으로(지시문의 형식대로) — 피드 두 문장 · 릴스·쇼츠·영상은 캡션 + 대본 3컷 · 스토리는 문구 + 스티커 제안 줄 · 블로그 1,800자 이상
      if (!next && ['body', 'brief', 'why', 'hooks', 'keyword'].every((k) => body.output_config?.format?.schema?.required?.includes(k))) {
        const sys = typeof body.system === 'string' ? body.system : (body.system ?? []).map((x) => x.text ?? '').join('\n');
        const video = /인스타 릴스|유튜브 쇼츠|광고 영상/.test(sys); const story = /스토리\(세로/.test(sys); const blog = /네이버 블로그 원고/.test(sys);
        const n = state.anthropic.length; // #235 ⓓ 채널별 같은 글 검사: 기본 답도 요청마다 다른 문장(시험끼리 같은 글로 걸리지 않게)
        const para = '이번 주에 자주 받은 질문을 하나씩 정리했습니다. 처음 오시는 분이 가장 많이 묻는 내용부터 차례대로 적었고, 실제로 겪은 장면을 함께 넣었습니다. 사진과 같이 보시면 순서가 더 쉽게 들어옵니다.';
        const draft = blog ? ['테스트 응답입니다.', ...[1, 2, 3, 4].flatMap((k) => [`■ 소제목 ${k}`, para, para, para, para, para])].join('\n\n')
          : story ? '테스트 응답입니다.\n스티커 제안: 투표 — 이번 주 가장 궁금한 것은?' : `${DRAFT_LINES[n % DRAFT_LINES.length]} ${DRAFT_LINES[(n + 3) % DRAFT_LINES.length]}`;
        next = { content: [{ type: 'text', text: JSON.stringify({ title: '', body: draft, brief: '', why: '', hooks: [], keyword: '', script: video ? ['처음 오신 분께 한 가지', '가장 많이 묻는 내용을 짧게', '이번 주 소식은 캡션에서'] : [] }) }], stop_reason: 'end_turn' };
      }
      // V23-1 시험: 오류 응답(크레딧 부족 402 billing_error 등)
      if (next?.httpError) return json(res, next.httpError, { type: 'error', error: { type: next.errorType ?? 'api_error', message: next.message ?? 'error' } });
      next ??= { content: [{ type: 'text', text: '테스트 응답입니다.' }], stop_reason: 'end_turn' };
      if (next.delayMs) { const ms = next.delayMs; next = { ...next }; delete next.delayMs; await new Promise((r) => setTimeout(r, ms)); } // 부록 A2 멈춤 시험: 늦게 답하기
      const { chunkDelayMs, ...reply } = next;
      const msg = { id: `msg_${state.anthropic.length}`, type: 'message', role: 'assistant', model: body.model, stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        ...(body.container ? { container: { id: body.container.id ?? `cntr_fake_${state.anthropic.length}`, expires_at: new Date(Date.now() + 3600e3).toISOString() } } : {}), ...reply };
      return body.stream ? sseMessage(res, msg, chunkDelayMs ?? 0) : json(res, 200, msg);
    }
    // ---- 가짜 Higgsfield (base = FAKE/hf): Authorization: Key test-id:test-secret, 제출 → queued + status_url, 상태 → hfPolls 번 in_progress 뒤 completed ----
    if (p.startsWith('/hf-out/')) {
      const job = state.hfJobs[p.slice(8).replace(/\.\w+$/, '')];
      const clip = p.endsWith('.mp4') && job ? fakeClip(job.seconds ?? 5, job.aspect ?? '9:16') : null;
      res.writeHead(200, { 'content-type': p.endsWith('.mp4') ? 'video/mp4' : 'image/png' }); return res.end(clip ?? Buffer.from(p.endsWith('.mp4') ? 'fakevideo' : 'fakepng'));
    }
    // ---- 가짜 TTS(OpenAI 형식, base = FAKE/openai/v1): Bearer test-tts-key, 글자 수 × 0.12초 사인파 mp3 ----
    if (p === '/openai/v1/audio/speech' && req.method === 'POST') {
      if (req.headers.authorization !== 'Bearer test-tts-key') return json(res, 401, { error: { message: 'Incorrect API key provided' } });
      state.tts.push({ input: body.input, voice: body.voice, model: body.model, instructions: body.instructions ?? null });
      const mp3 = fakeMp3(Math.min(4, Math.max(0.8, Math.round(String(body.input ?? '').length * 0.12 * 10) / 10)));
      res.writeHead(200, { 'content-type': 'audio/mpeg' }); return res.end(mp3 ?? Buffer.alloc(0));
    }
    if (p === '/openai/v1/models' && req.method === 'GET') return req.headers.authorization === 'Bearer test-tts-key' ? json(res, 200, { data: [{ id: 'gpt-4o-mini-tts' }] }) : json(res, 401, { error: { message: 'Incorrect API key provided' } });
    // ---- #539 가짜 구글 Cloud Text-to-Speech(base = FAKE/google-tts/v1): x-goog-api-key: test-gtts-key(틀리면 구글처럼 400) · 합성 = JSON 안 base64 MP3 ----
    if (p.startsWith('/google-tts/v1/')) {
      if (req.headers['x-goog-api-key'] !== 'test-gtts-key') return json(res, 400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
      if (p === '/google-tts/v1/voices' && req.method === 'GET') {
        const lang = url.searchParams.get('languageCode');
        const all = [['ko-KR-Neural2-A', 'FEMALE'], ['ko-KR-Neural2-B', 'FEMALE'], ['ko-KR-Neural2-C', 'MALE'], ['ko-KR-Chirp3-HD-Kore', 'FEMALE'], ['en-US-Neural2-A', 'MALE']];
        return json(res, 200, { voices: all.filter(([n]) => !lang || n.startsWith(lang)).map(([name, ssmlGender]) => ({ languageCodes: [name.slice(0, 5)], name, ssmlGender, naturalSampleRateHertz: 24000 })) });
      }
      if (p === '/google-tts/v1/text:synthesize' && req.method === 'POST') {
        state.tts.push({ provider: 'google', input: body.input?.text, voice: body.voice?.name, languageCode: body.voice?.languageCode, encoding: body.audioConfig?.audioEncoding });
        const mp3 = fakeMp3(Math.min(4, Math.max(0.8, Math.round(String(body.input?.text ?? '').length * 0.12 * 10) / 10)));
        return json(res, 200, { audioContent: (mp3 ?? Buffer.alloc(0)).toString('base64') });
      }
      return json(res, 404, { error: { code: 404, message: 'Not found' } });
    }
    if (p.startsWith('/hf/')) {
      if (req.headers.authorization !== 'Key test-id:test-secret') return json(res, 401, { detail: 'Invalid credentials' });
      const sm = /^\/hf\/requests\/([^/]+)\/status$/.exec(p);
      if (sm && req.method === 'GET') {
        const j = state.hfJobs[sm[1]];
        if (!j) return json(res, 404, { detail: 'Request not found' });
        j.polls++;
        const status = j.final === 'nsfw' ? 'nsfw' : j.polls > j.need ? 'completed' : 'in_progress';
        const out = status !== 'completed' ? {} : j.video ? { video: { url: `${FAKE_ORIGIN(req)}/hf-out/${sm[1]}.mp4` } } : { images: [{ url: `${FAKE_ORIGIN(req)}/hf-out/${sm[1]}.png` }] };
        return json(res, 200, { status, request_id: sm[1], status_url: `${FAKE_ORIGIN(req)}/hf/requests/${sm[1]}/status`, ...out });
      }
      if (req.method === 'POST') {
        if (state.hfMode === 'credits') return json(res, 403, { detail: 'Not enough credits' });
        if (state.hfMode === 'validation') return json(res, 422, { detail: [{ loc: ['body', 'aspect_ratio'], msg: 'Input should be 1:1' }] });
        const id = randomUUID();
        state.hf.push({ path: p.slice(4), body, idem: req.headers['idempotency-key'] ?? null });
        state.hfJobs[id] = { polls: 0, need: state.hfPolls, video: /video/.test(p), final: state.hfMode === 'nsfw' ? 'nsfw' : null, seconds: body.duration ?? 5, aspect: body.aspect_ratio ?? '9:16' };
        return json(res, 200, { status: 'queued', request_id: id, status_url: `${FAKE_ORIGIN(req)}/hf/requests/${id}/status`, cancel_url: `${FAKE_ORIGIN(req)}/hf/requests/${id}/cancel` });
      }
    }
    // ---- 제어용 ----
    if (p === '/__state') return json(res, 200, { ...state, fcmUnregistered: [...state.fcmUnregistered], webpushGone: [...state.webpushGone] });
    if (p === '/__ctl' && req.method === 'POST') {
      if ('invalidGrant' in body) state.invalidGrant = body.invalidGrant;
      if ('expireSyncToken' in body) state.expireSyncToken = body.expireSyncToken;
      if (body.fcmUnregister) state.fcmUnregistered.add(body.fcmUnregister);
      if (body.anthropicReset) { state.anthropicQueue.length = 0; state.classifyQueue.length = 0; state.visionQueue.length = 0; } // 비운 다음에 새로 넣는다
      if (body.visionQueue) state.visionQueue.push(...body.visionQueue);
      if (body.anthropicQueue) state.anthropicQueue.push(...body.anthropicQueue);
      if (body.anthropicFiles) for (const [k, v] of Object.entries(body.anthropicFiles)) state.anthropicFiles[k] = { at: new Date().toISOString(), ...v };
      if (body.classifyQueue) state.classifyQueue.push(...body.classifyQueue);
      if (body.webpushGone) state.webpushGone.add(body.webpushGone);
      if ('hfMode' in body) state.hfMode = body.hfMode;
      if ('hfPolls' in body) state.hfPolls = body.hfPolls;
      if (body.hfReset) { state.hf.length = 0; state.hfJobs = {}; }
      if (body.ttsReset) state.tts.length = 0;
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
