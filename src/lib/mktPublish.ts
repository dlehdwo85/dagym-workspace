import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { decrypt, encrypt } from './crypto';
import { audit, logError } from './log';
import { appUrl } from './mail';
import { downloadUrl, getObject } from './storage';
import { tenantOf, type SessionUser } from './types';

/**
 * 대표 10/20 22:30 ②(M1) 서버 게시 실행기 — "인스타 게시를 왜 사람이 직접 하나". 승인된 최신 버전만, 사람이 [서버로 게시]를 누르거나(관리자) 회사 설정 '자동 게시'가 켜져 있으면 예정 시각에 워크인 서버가 올린다.
 * - 같은 콘텐츠·버전·계정은 한 번(idempotency_key). 시험 콘텐츠(is_test)는 서버 게시 불가.
 * - 인스타(Graph: 컨테이너 → 상태 FINISHED → media_publish → permalink) · 페이스북 페이지(photos/feed/videos) · 스레드(Threads API: threads → threads_publish) · 유튜브(재개 가능 업로드).
 * - 실패: 3번까지 5·10·15분 간격 재시도(일시 오류), 그 뒤 '실패' + 요청한 사람·승인자 알림. 게시 호출 뒤 결과가 모호(시간 초과)하면 '확인 중' → 최근 게시물에서 같은 캡션을 찾아 완료/실패(중복 게시 금지).
 * - 토큰은 암호화 저장·응답에 내보내지 않음. 유튜브는 refresh token 으로 갱신, 스레드는 만료 7일 전 갱신.
 * - 가짜 서버(ADS_TEST_BASE)로 통과한 시험은 구조 시험 — 실연동 완료는 실제 계정 게시 확인 뒤에만.
 */
export const AUTO_CHANNELS: Record<string, string> = { instagram: 'meta_ig', facebook: 'meta_fb', threads: 'meta_threads', youtube: 'youtube' };
export const PROVIDER_LABEL: Record<string, string> = { meta_ig: '인스타그램', meta_fb: '페이스북 페이지', meta_threads: '스레드', youtube: '유튜브', manual: '직접 게시', naver_blog: '네이버 블로그(도우미)' };
const T = () => process.env.ADS_TEST_BASE?.replace(/\/$/, '');
const GRAPH = () => (T() ? `${T()}/graph` : 'https://graph.facebook.com/v21.0');
const THREADS = () => (T() ? `${T()}/threads` : 'https://graph.threads.net/v1.0');
const GOOGLE_TOKEN = () => (T() ? `${T()}/goauth/token` : 'https://oauth2.googleapis.com/token');
const YT = () => (T() ? `${T()}/yt` : 'https://www.googleapis.com/youtube/v3');
const YT_UPLOAD = () => (T() ? `${T()}/ytupload` : 'https://www.googleapis.com/upload/youtube/v3');
const MAX_ATTEMPTS = 3;
type Job = { id: string; tenant: string; content_id: string; version: number; account_id: string | null; provider: string; status: string; attempts: number; payload: any; requested_by: string | null };
type Acc = { id: string; provider: string; external_id: string; label: string; token_enc: string | null; refresh_enc: string | null; expires_at: string | null; info: any };
class Retry extends Error { constructor(msg: string) { super(msg); this.name = 'Retry'; } }        // 일시 오류 → 재시도
class Pending extends Error { constructor(msg: string) { super(msg); this.name = 'Pending'; } }    // 처리 중(다음 tick 에 이어서)
class Ambiguous extends Error { constructor(msg: string) { super(msg); this.name = 'Ambiguous'; } } // 올라갔는지 모호 → 확인 중

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: any, headers: Record<string, string> = {}, timeoutMs = 25000) {
  let r: Response;
  try { r = await fetch(url, { method, headers: { ...(body && !(body instanceof Buffer) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body instanceof Buffer ? new Uint8Array(body) : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e: any) { throw new Retry(`연결 실패: ${String(e?.message ?? e).slice(0, 120)}`); }
  const text = await r.text(); let j: any = null; try { j = JSON.parse(text); } catch { /* JSON 아님 */ }
  if (!r.ok) {
    const msg = String(j?.error?.message ?? j?.error?.error_user_msg ?? j?.error_description ?? text).slice(0, 300);
    const code = Number(j?.error?.code ?? 0);
    const path = (() => { try { const x = new URL(url); return x.pathname; } catch { return ''; } })();
    if (r.status >= 500 || r.status === 429 || code === 4 || code === 17 || code === 32 || code === 613) throw new Retry(`${r.status} ${path} ${msg}`);
    throw new Error(`${r.status} ${path} ${msg}`);
  }
  return { j, headers: r.headers };
}
const q = (o: Record<string, string | number | boolean | undefined>) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))).toString();
const abs = (u: string) => (u.startsWith('http') ? u : `${appUrl()}${u}`);

/** 시안 미디어(자료실) → 공개 주소(서명, 1시간) — Meta·스레드가 가져감. 유튜브는 파일을 서버가 읽어 올림 */
async function mediaOf(tenant: string, ids: string[]) {
  if (!ids.length) return [];
  const sql = db();
  const rows = await sql<{ id: string; file_name: string; mime_type: string; storage_key: string | null }[]>`select id, file_name, mime_type, storage_key from library_files where id = any(${ids}::uuid[]) and tenant = ${tenant} and deleted_at is null`;
  const out = [];
  for (const id of ids) { const r = rows.find((x) => x.id === id); if (!r?.storage_key) continue; out.push({ id, key: r.storage_key, name: r.file_name, mime: r.mime_type, video: r.mime_type.startsWith('video/'), url: abs(await downloadUrl(r.storage_key, r.file_name, true, 3600)) }); }
  return out;
}
const token = (a: Acc) => { if (!a.token_enc) throw new Error('토큰 없음 — 다시 연결'); return decrypt(a.token_enc); };
async function waitContainer(url: string, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const { j } = await call('GET', url);
    const st = String(j?.status_code ?? j?.status ?? 'FINISHED');
    if (st === 'FINISHED' || st === 'PUBLISHED') return;
    if (st === 'ERROR' || st === 'EXPIRED') throw new Error(`미디어 처리 실패: ${String(j?.status ?? st).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, T() ? 50 : 3000));
  }
  throw new Pending('미디어 처리 중');
}

// ---------------- 매체별 ----------------
async function publishIg(a: Acc, c: any, mediaIn: Awaited<ReturnType<typeof mediaOf>>, job: Job) {
  let media = mediaIn;
  const ig = a.external_id; const tk = token(a); const caption = String(c.body ?? '').slice(0, 2200);
  const p = { ...(job.payload ?? {}) };
  if (!p.container) {
    if (!media.length) throw new Error('인스타그램은 사진·영상이 필요합니다');
    // 로컬 10/21 02:10: 릴스·쇼츠에 표지 이미지가 섞여 있으면 '영상 1개 + 표지' — 표지를 사진 게시물로 올리지 않음
    const vid = media.find((m) => m.video); const cover = media.find((m) => !m.video);
    if (vid) media = [vid];
    const story = c.kind === 'story'; const video = !!vid || ['reels', 'shorts', 'video'].includes(c.kind);
    let r;
    if (story) r = await call('POST', `${GRAPH()}/${ig}/media?${q({ media_type: 'STORIES', ...(media[0].video ? { video_url: media[0].url } : { image_url: media[0].url }), access_token: tk })}`);
    else if (video) r = await call('POST', `${GRAPH()}/${ig}/media?${q({ media_type: 'REELS', video_url: media[0].url, caption, share_to_feed: true, ...(cover ? { cover_url: cover.url } : {}), access_token: tk })}`);
    else if (media.length === 1) r = await call('POST', `${GRAPH()}/${ig}/media?${q({ image_url: media[0].url, caption, access_token: tk })}`);
    else {
      const children: string[] = [];
      for (const m of media.slice(0, 10)) { const ch = await call('POST', `${GRAPH()}/${ig}/media?${q({ image_url: m.url, is_carousel_item: true, access_token: tk })}`); children.push(String(ch.j.id)); }
      r = await call('POST', `${GRAPH()}/${ig}/media?${q({ media_type: 'CAROUSEL', children: children.join(','), caption, access_token: tk })}`);
    }
    p.container = String(r.j.id); await savePayload(job.id, p);
  }
  await waitContainer(`${GRAPH()}/${p.container}?${q({ fields: 'status_code,status', access_token: tk })}`);
  let pub;
  try { pub = await call('POST', `${GRAPH()}/${ig}/media_publish?${q({ creation_id: p.container, access_token: tk })}`); }
  catch (e: any) { if (e instanceof Retry) throw new Ambiguous(e.message); throw e; }
  const id = String(pub.j.id);
  const link = await call('GET', `${GRAPH()}/${id}?${q({ fields: 'permalink', access_token: tk })}`).then((x) => String(x.j.permalink ?? '')).catch(() => '');
  return { externalId: id, permalink: link || `https://www.instagram.com/` };
}
async function publishFb(a: Acc, c: any, media: Awaited<ReturnType<typeof mediaOf>>) {
  const page = a.external_id; const tk = token(a); const message = String(c.body ?? '').slice(0, 60000);
  let id: string;
  const vid = media.find((m) => m.video); const cover = media.find((m) => !m.video);
  if (vid) id = String((await call('POST', `${GRAPH()}/${page}/videos?${q({ file_url: vid.url, description: message, ...(cover ? { thumb: cover.url } : {}), access_token: tk })}`)).j.id);
  else if (media.length === 1) { const { j } = await call('POST', `${GRAPH()}/${page}/photos?${q({ url: media[0].url, message, access_token: tk })}`); id = String(j.post_id ?? j.id); }
  else if (media.length > 1) {
    const ids: string[] = [];
    for (const m of media.slice(0, 10)) ids.push(String((await call('POST', `${GRAPH()}/${page}/photos?${q({ url: m.url, published: false, access_token: tk })}`)).j.id));
    const form: Record<string, string> = { message, access_token: tk }; ids.forEach((x, i) => { form[`attached_media[${i}]`] = JSON.stringify({ media_fbid: x }); });
    id = String((await call('POST', `${GRAPH()}/${page}/feed?${q(form)}`)).j.id);
  } else id = String((await call('POST', `${GRAPH()}/${page}/feed?${q({ message, access_token: tk })}`)).j.id);
  const link = await call('GET', `${GRAPH()}/${id}?${q({ fields: 'permalink_url', access_token: tk })}`).then((x) => String(x.j.permalink_url ?? '')).catch(() => '');
  return { externalId: id, permalink: link || `https://www.facebook.com/${id}` };
}
async function publishThreads(a: Acc, c: any, mediaIn: Awaited<ReturnType<typeof mediaOf>>, job: Job) {
  let media = mediaIn;
  const user = a.external_id; const tk = token(a); const text = String(c.body ?? '').slice(0, 500);
  const p = { ...(job.payload ?? {}) };
  if (!p.container) {
    let r;
    const vid0 = media.find((m) => m.video); if (vid0) media = [vid0]; // 표지는 올리지 않음
    // #95: 글만 올릴 때 본문의 첫 링크를 link_attachment 로(스레드 글 아래 링크 카드)
    const link = /https?:\/\/[^\s<>"']+/.exec(text)?.[0];
    if (!media.length) r = await call('POST', `${THREADS()}/${user}/threads?${q({ media_type: 'TEXT', text, ...(link ? { link_attachment: link } : {}), access_token: tk })}`);
    else if (media.length === 1) r = await call('POST', `${THREADS()}/${user}/threads?${q({ media_type: media[0].video ? 'VIDEO' : 'IMAGE', ...(media[0].video ? { video_url: media[0].url } : { image_url: media[0].url }), text, access_token: tk })}`);
    else {
      const children: string[] = [];
      for (const m of media.slice(0, 10)) children.push(String((await call('POST', `${THREADS()}/${user}/threads?${q({ media_type: m.video ? 'VIDEO' : 'IMAGE', ...(m.video ? { video_url: m.url } : { image_url: m.url }), is_carousel_item: true, access_token: tk })}`)).j.id));
      r = await call('POST', `${THREADS()}/${user}/threads?${q({ media_type: 'CAROUSEL', children: children.join(','), text, access_token: tk })}`);
    }
    p.container = String(r.j.id); await savePayload(job.id, p);
  }
  await waitContainer(`${THREADS()}/${p.container}?${q({ fields: 'status,error_message', access_token: tk })}`);
  let pub;
  try { pub = await call('POST', `${THREADS()}/${user}/threads_publish?${q({ creation_id: p.container, access_token: tk })}`); }
  catch (e: any) { if (e instanceof Retry) throw new Ambiguous(e.message); throw e; }
  const id = String(pub.j.id);
  const link = await call('GET', `${THREADS()}/${id}?${q({ fields: 'permalink', access_token: tk })}`).then((x) => String(x.j.permalink ?? '')).catch(() => '');
  return { externalId: id, permalink: link || 'https://www.threads.net/' };
}
/** 유튜브 토큰: 만료 5분 전이면 refresh */
async function ytToken(a: Acc) {
  if (a.token_enc && a.expires_at && new Date(a.expires_at).getTime() - Date.now() > 5 * 60_000) return decrypt(a.token_enc);
  if (!a.refresh_enc) throw new Error('유튜브 토큰 만료 — 다시 연결');
  const r = await fetch(GOOGLE_TOKEN(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.YT_CLIENT_ID ?? '', client_secret: process.env.YT_CLIENT_SECRET ?? '', grant_type: 'refresh_token', refresh_token: decrypt(a.refresh_enc) }), signal: AbortSignal.timeout(20000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) { await db()`update mkt_publish_accounts set status = 'error', last_error = ${'토큰 갱신 실패 — 다시 연결해 주세요'} where id = ${a.id}`; throw new Error(`유튜브 토큰 갱신 실패: ${String(j.error_description ?? j.error ?? r.status).slice(0, 120)}`); }
  const exp = new Date(Date.now() + Number(j.expires_in ?? 3600) * 1000).toISOString();
  await db()`update mkt_publish_accounts set token_enc = ${encrypt(j.access_token)}, expires_at = ${exp}, status = 'active', last_error = null where id = ${a.id}`;
  return String(j.access_token);
}
async function publishYt(a: Acc, c: any, media: Awaited<ReturnType<typeof mediaOf>>, job: Job) {
  const v = media.find((m) => m.video); if (!v) throw new Error('유튜브는 영상 파일이 필요합니다');
  const tk = await ytToken(a); const p = { ...(job.payload ?? {}) };
  const title = String(c.title ?? '').slice(0, 95) + (c.kind === 'shorts' && !/#shorts/i.test(c.title) ? ' #Shorts' : '');
  if (!p.uploadUrl) {
    const r = await fetch(`${YT_UPLOAD()}/videos?uploadType=resumable&part=snippet,status`, { method: 'POST', headers: { authorization: `Bearer ${tk}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': v.mime },
      body: JSON.stringify({ snippet: { title, description: String(c.body ?? '').slice(0, 4900), categoryId: '22' }, status: { privacyStatus: c.privacy ?? 'public', selfDeclaredMadeForKids: false } }), signal: AbortSignal.timeout(25000) }).catch((e) => { throw new Retry(String(e?.message ?? e)); });
    if (!r.ok) { const t = await r.text(); if (r.status >= 500 || r.status === 429) throw new Retry(`${r.status} ${t.slice(0, 200)}`); throw new Error(`${r.status} ${t.slice(0, 300)}`); }
    p.uploadUrl = r.headers.get('location'); if (!p.uploadUrl) throw new Error('업로드 주소 없음'); await savePayload(job.id, p);
  }
  const buf = await getObject(v.key);
  let up: Response;
  try { up = await fetch(p.uploadUrl, { method: 'PUT', headers: { authorization: `Bearer ${tk}`, 'content-type': v.mime, 'content-length': String(buf.length) }, body: new Uint8Array(buf), signal: AbortSignal.timeout(10 * 60_000) }); }
  catch (e: any) { throw new Ambiguous(`업로드 중 끊김: ${String(e?.message ?? e).slice(0, 120)}`); }
  const j: any = await up.json().catch(() => ({}));
  if (!up.ok) { if (up.status >= 500) throw new Retry(`${up.status}`); throw new Error(`${up.status} ${String(j?.error?.message ?? '').slice(0, 300)}`); }
  const id = String(j.id); return { externalId: id, permalink: `https://youtu.be/${id}` };
}
const savePayload = (jobId: string, p: any) => db()`update mkt_publish_jobs set payload = ${db().json(p as never)}, updated_at = now() where id = ${jobId}`;

/** 확인 중: 최근 게시물에서 같은 글(앞 60자)을 찾으면 완료, 못 찾으면 실패(재시도 안 함 — 중복 게시 방지) */
async function verifyJob(a: Acc, c: any): Promise<{ externalId: string; permalink: string } | null> {
  const head = String(c.body ?? '').slice(0, 60).trim();
  try {
    if (a.provider === 'meta_ig') { const { j } = await call('GET', `${GRAPH()}/${a.external_id}/media?${q({ fields: 'id,caption,permalink,timestamp', limit: 10, access_token: token(a) })}`); const m = (j?.data ?? []).find((x: any) => head && String(x.caption ?? '').startsWith(head)); return m ? { externalId: String(m.id), permalink: String(m.permalink ?? '') } : null; }
    if (a.provider === 'meta_fb') { const { j } = await call('GET', `${GRAPH()}/${a.external_id}/posts?${q({ fields: 'id,message,permalink_url', limit: 10, access_token: token(a) })}`); const m = (j?.data ?? []).find((x: any) => head && String(x.message ?? '').startsWith(head)); return m ? { externalId: String(m.id), permalink: String(m.permalink_url ?? '') } : null; }
    if (a.provider === 'meta_threads') { const { j } = await call('GET', `${THREADS()}/${a.external_id}/threads?${q({ fields: 'id,text,permalink', limit: 10, access_token: token(a) })}`); const m = (j?.data ?? []).find((x: any) => head && String(x.text ?? '').startsWith(head)); return m ? { externalId: String(m.id), permalink: String(m.permalink ?? '') } : null; }
    if (a.provider === 'youtube') { const tk = await ytToken(a); const { j } = await call('GET', `${YT()}/search?${q({ part: 'snippet', forMine: true, type: 'video', maxResults: 10 })}`, undefined, { authorization: `Bearer ${tk}` }); const m = (j?.items ?? []).find((x: any) => String(x.snippet?.title ?? '') === String(c.title ?? '').slice(0, 95)); return m ? { externalId: String(m.id?.videoId), permalink: `https://youtu.be/${m.id?.videoId}` } : null; }
  } catch { return null; }
  return null;
}

// ---------------- 작업 만들기(사람이 [서버로 게시] / 자동 게시) ----------------
/** 콘텐츠가 서버 게시 가능한 채널·계정 — 화면 버튼·안내용 */
export async function publishTargets(tenant: string, c: { channel: string; cross_channels?: string[] | null; brand_id: string | null }) {
  const sql = db();
  const chans = [c.channel, ...((c.cross_channels ?? []) as string[])].filter((k, i, arr) => AUTO_CHANNELS[k] && arr.indexOf(k) === i);
  if (!chans.length) return [];
  const sets = new Map((await sql<{ channel: string; enabled: boolean }[]>`select channel, enabled from mkt_channel_settings where tenant = ${tenant}`).map((r) => [r.channel, r.enabled]));
  const accs = await sql<{ id: string; provider: string; label: string; brand_id: string | null; shared: boolean; status: string; brand: string | null }[]>`select a.id, a.provider, a.label, a.brand_id, a.shared, a.status, b.name as brand from mkt_publish_accounts a left join mkt_brands b on b.id = a.brand_id where a.tenant = ${tenant} and a.status <> 'disconnected' order by a.label`;
  // 로컬 10/21 08:10: 브랜드 계정 + 명시적 '공용' 계정만. 미지정 계정은 제외(전 계정으로 나가던 사고 방지) — 브랜드 없는 콘텐츠는 공용 계정만
  return chans.map((ch) => {
    const provider = AUTO_CHANNELS[ch];
    const all = accs.filter((a) => a.provider === provider);
    const pick = all.filter((a) => a.shared || (!!c.brand_id && a.brand_id === c.brand_id));
    const unassigned = all.filter((a) => !a.shared && !a.brand_id);
    const reason = pick.length ? null : !all.length ? 'none' : unassigned.length ? 'unassigned' : 'other_brand';
    return { channel: ch, provider, label: PROVIDER_LABEL[provider], enabled: sets.get(ch) ?? (ch !== 'threads' && ch !== 'youtube'),
      accounts: pick.map((a) => ({ id: a.id, label: a.label, status: a.status, brand: a.brand, shared: a.shared })), reason, unassigned: unassigned.map((a) => a.label) };
  });
}
/** [서버로 게시](관리자): 승인된 최신 버전 → 채널마다 연결 계정에 작업(대기). atSchedule=true 면 예정 시각 뒤에 실행 */
export async function queuePublish(u: SessionUser, contentId: string, opts: { accountIds?: string[]; atSchedule?: boolean } = {}) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('서버 게시는 관리자가 누릅니다');
  if (!/^[0-9a-f-]{36}$/i.test(contentId)) throw notFound();
  const sql = db(); const t = tenantOf(u);
  const [c] = await sql<any[]>`select id, title, channel, cross_channels, kind, brand_id, status, current_version, approved_version, is_test, scheduled_at, published_deleted_at from mkt_contents where id = ${contentId} and tenant = ${t}`;
  if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
  if (c.is_test) throw new HttpError(409, 'is_test', '시험 콘텐츠는 서버로 게시하지 않습니다');
  // 로컬 10/21 11:45: 매체에서 지워진 글(published_deleted_at)은 승인된 그 버전을 다시 올릴 수 있다
  const redo = c.status === 'published' && !!c.published_deleted_at && c.approved_version === c.current_version;
  if (!redo && (c.status !== 'approved' || c.approved_version !== c.current_version)) throw new HttpError(409, 'not_approved', '승인된 최신 버전만 게시할 수 있습니다');
  const targets = await publishTargets(t, c);
  const jobs: { id: string; provider: string; account: string }[] = []; const missing: string[] = [];
  for (const tg of targets) {
    const accs = opts.accountIds?.length ? tg.accounts.filter((a) => opts.accountIds!.includes(a.id)) : tg.accounts;
    if (!accs.length) { missing.push(tg.label); continue; }
    for (const a of accs) {
      const [j] = await sql<{ id: string }[]>`insert into mkt_publish_jobs (tenant, content_id, version, account_id, provider, status, idempotency_key, requested_by, run_after)
        values (${t}, ${c.id}, ${c.current_version}, ${a.id}, ${tg.provider}, 'queued', ${`${c.id}:${c.current_version}:${a.id}`}, ${u.id}, ${opts.atSchedule && c.scheduled_at && new Date(c.scheduled_at) > new Date() ? c.scheduled_at : new Date().toISOString()})
        on conflict (idempotency_key) do update set status = case when mkt_publish_jobs.status in ('failed', 'canceled') or mkt_publish_jobs.deleted_at is not null then 'queued' else mkt_publish_jobs.status end, attempts = case when mkt_publish_jobs.status in ('failed', 'canceled') or mkt_publish_jobs.deleted_at is not null then 0 else mkt_publish_jobs.attempts end, deleted_at = null, external_post_id = case when mkt_publish_jobs.deleted_at is not null then null else mkt_publish_jobs.external_post_id end, last_error = null, run_after = excluded.run_after, updated_at = now() returning id`;
      jobs.push({ id: j.id, provider: tg.provider, account: a.label });
    }
  }
  if (!jobs.length) {
    const un = targets.flatMap((tg) => tg.unassigned);
    throw new HttpError(409, 'no_account', un.length ? `계정에 브랜드를 지정하세요 — 연결 계정 화면에서 ${un.join('·')} 의 브랜드(또는 공용)를 고른 뒤 다시 누르세요`
      : `${missing.join('·') || '이 채널'}에 이 브랜드 계정이 없습니다 — 연결 계정 화면에서 [연결]·브랜드 지정 뒤 다시, 그동안은 게시 도우미`);
  }
  await audit(sql, u.id, 'mkt_publish.queue', 'mkt_content', c.id, { jobs: jobs.length, providers: jobs.map((j) => j.provider) }).catch(() => {});
  // 바로 실행(시간이 됐으면) — 사람이 기다리지 않게. 실패해도 tick 이 다시
  const ran = opts.atSchedule ? null : await runJobs(jobs.map((j) => j.id)).catch(() => null);
  return { jobs, missing, ran };
}
export async function retryJob(u: SessionUser, jobId: string) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('관리자만');
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw notFound();
  const [j] = await db()<any[]>`update mkt_publish_jobs set status = 'queued', attempts = 0, last_error = null, payload = '{}', run_after = now(), updated_at = now() where id = ${jobId} and tenant = ${tenantOf(u)} and status in ('failed', 'canceled') returning id`;
  if (!j) throw notFound('다시 시도할 작업이 없습니다(실패한 작업만)');
  return { ok: true, ran: await runJobs([j.id]).catch(() => null) };
}

// ---------------- 실행(tick) ----------------
async function runOne(job: Job) {
  const sql = db();
  const [c] = await sql<any[]>`select c.id, c.tenant, c.title, c.channel, c.kind, c.brand_id, c.status, c.is_test, c.created_by, v.body, v.media_ids from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = ${job.version} where c.id = ${job.content_id}`;
  const [a] = job.account_id ? await sql<Acc[]>`select id, provider, external_id, label, token_enc, refresh_enc, expires_at, info from mkt_publish_accounts where id = ${job.account_id} and status <> 'disconnected'` : [];
  const fail = async (msg: string, final: boolean) => {
    const attempts = job.attempts + 1;
    if (!final && attempts < MAX_ATTEMPTS) { await sql`update mkt_publish_jobs set status = 'queued', attempts = ${attempts}, last_error = ${msg.slice(0, 500)}, run_after = now() + (${attempts * 5} || ' minutes')::interval, updated_at = now() where id = ${job.id}`; return { status: 'retry', error: msg }; }
    await sql`update mkt_publish_jobs set status = 'failed', attempts = ${attempts}, last_error = ${msg.slice(0, 500)}, updated_at = now() where id = ${job.id}`;
    // #104: 요청자·만든 사람 + 브랜드 담당(규칙)에게 — 승인자 전원에게는 가지 않음
    await (await import('./mktAuto')).mktNotify(sql, { tenant: job.tenant, brand_id: c?.brand_id ?? null, is_test: c?.is_test, created_by: c?.created_by }, job.requested_by, { userIds: [job.requested_by, c?.created_by], type: 'sync_error', title: `게시 실패 — ${PROVIDER_LABEL[job.provider] ?? job.provider}: ${String(c?.title ?? '').slice(0, 40)}`, body: msg.slice(0, 200), link: `/s/marketing/approvals?c=${job.content_id}`, entityType: 'mkt_publish_job', entityId: job.id, dedupeKey: `mktpub:fail:${job.id}:${attempts}` }).catch(() => {});
    return { status: 'failed', error: msg };
  };
  if (!c) return fail('콘텐츠·버전이 없습니다', true);
  if (c.is_test) return fail('시험 콘텐츠', true);
  if (!a) return fail('연결 계정이 없습니다(끊김) — 다시 연결 뒤 [다시 시도]', true);
  await sql`update mkt_publish_jobs set status = 'running', updated_at = now() where id = ${job.id}`;
  let res: { externalId: string; permalink: string } | null = null;
  try {
    const media = await mediaOf(job.tenant, (c.media_ids ?? []) as string[]);
    if (job.status === 'verify') { res = await verifyJob(a, c); if (!res) return fail(`게시 확인 실패 — 매체에서 같은 글을 찾지 못했습니다(중복 방지로 다시 올리지 않음). 매체 앱에서 확인 뒤 [게시 확인] 또는 [다시 시도]`, true); }
    else if (a.provider === 'meta_ig') res = await publishIg(a, c, media, job);
    else if (a.provider === 'meta_fb') res = await publishFb(a, c, media);
    else if (a.provider === 'meta_threads') res = await publishThreads(a, c, media, job);
    else if (a.provider === 'youtube') res = await publishYt(a, c, media, job);
    else return fail(`지원하지 않는 매체 ${a.provider}`, true);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (e instanceof Pending) { await sql`update mkt_publish_jobs set status = 'queued', run_after = now() + interval '1 minute', last_error = ${msg}, updated_at = now() where id = ${job.id}`; return { status: 'pending' }; }
    if (e instanceof Ambiguous) { await sql`update mkt_publish_jobs set status = 'verify', verify_until = now() + interval '30 minutes', last_error = ${msg.slice(0, 500)}, run_after = now() + interval '2 minutes', updated_at = now() where id = ${job.id}`; return { status: 'verify' }; }
    if (/OAuth|access token|Invalid OAuth|190|expired|다시 연결/i.test(msg)) await sql`update mkt_publish_accounts set status = 'error', last_error = ${msg.slice(0, 300)} where id = ${a.id}`.catch(() => {});
    await logError('mkt-publish', e, { job: job.id, provider: a.provider }).catch(() => {});
    return fail(msg, !(e instanceof Retry));
  }
  await sql.begin(async (tx) => {
    await tx`update mkt_publish_jobs set status = 'done', external_post_id = ${res!.externalId}, permalink = ${res!.permalink}, attempts = ${job.attempts + 1}, last_error = null, updated_at = now() where id = ${job.id}`;
    // 첫 성공이 게시 주소·게시됨 상태(여러 채널이면 나머지는 게시 기록에)
    await tx`update mkt_contents set status = 'published', published_url = case when published_deleted_at is not null then ${res!.permalink} else coalesce(published_url, ${res!.permalink}) end, published_at = case when published_deleted_at is not null then now() else coalesce(published_at, now()) end, published_deleted_at = null, updated_at = now() where id = ${c.id} and status <> 'canceled'`;
  });
  await (await import('./mktAuto')).mktNotify(sql, { tenant: job.tenant, brand_id: c.brand_id, is_test: c.is_test, created_by: c.created_by }, job.requested_by, { userIds: [job.requested_by, c.created_by], type: 'review_result', title: `게시 완료 — ${PROVIDER_LABEL[a.provider]}: ${String(c.title).slice(0, 40)}`, body: res.permalink, link: res.permalink, entityType: 'mkt_publish_job', entityId: job.id, dedupeKey: `mktpub:done:${job.id}`, push: false }).catch(() => {});
  return { status: 'done', permalink: res.permalink };
}
async function runJobs(ids: string[]) {
  const sql = db(); const out: any[] = [];
  const jobs = await sql<Job[]>`select id, tenant, content_id, version, account_id, provider, status, attempts, payload, requested_by from mkt_publish_jobs where id = any(${ids}::uuid[]) and status in ('queued', 'verify') and run_after <= now() order by created_at`;
  for (const j of jobs) out.push({ id: j.id, provider: j.provider, ...(await runOne(j).catch((e) => ({ status: 'error', error: String(e?.message ?? e) }))) });
  return out;
}
/** tick: ① 자동 게시 켠 회사 — 승인된 최신 버전·예정 시각 지남 → 작업 ② 대기·확인 중 작업 실행(한 번에 10) ③ 스레드 토큰 갱신(만료 7일 전) */
export async function publishTick() {
  const sql = db(); const out: Record<string, unknown> = {};
  const due = await sql<any[]>`select c.id, c.tenant, c.channel, c.cross_channels, c.brand_id, c.current_version from mkt_contents c join mkt_settings s on s.tenant = c.tenant and s.auto_publish
    where c.status = 'approved' and c.approved_version = c.current_version and not c.is_test and c.scheduled_at is not null and c.scheduled_at <= now() and c.scheduled_at >= now() - interval '2 days'
      and (c.channel in ('instagram', 'facebook', 'threads', 'youtube') or c.cross_channels && array['instagram', 'facebook', 'threads', 'youtube']::text[]) limit 20`;
  let queued = 0;
  for (const c of due) {
    for (const tg of await publishTargets(c.tenant, c)) for (const a of tg.accounts) {
      const r = await sql`insert into mkt_publish_jobs (tenant, content_id, version, account_id, provider, status, idempotency_key, run_after) values (${c.tenant}, ${c.id}, ${c.current_version}, ${a.id}, ${tg.provider}, 'queued', ${`${c.id}:${c.current_version}:${a.id}`}, now()) on conflict (idempotency_key) do nothing returning id`;
      queued += r.length;
    }
  }
  out.autoQueued = queued;
  const ids = await sql<{ id: string }[]>`select id from mkt_publish_jobs where status in ('queued', 'verify') and run_after <= now() and (verify_until is null or verify_until > now() or status = 'queued') order by run_after limit 10`;
  out.ran = await runJobs(ids.map((x) => x.id));
  await sql`update mkt_publish_jobs set status = 'failed', last_error = coalesce(last_error, '') || ' · 확인 기한 지남', updated_at = now() where status = 'verify' and verify_until < now()`;
  // 스레드 장기 토큰(60일) 갱신
  const th = await sql<Acc[]>`select id, provider, external_id, label, token_enc, refresh_enc, expires_at, info from mkt_publish_accounts where provider = 'meta_threads' and status = 'active' and expires_at is not null and expires_at < now() + interval '7 days' limit 5`;
  for (const a of th) {
    try { const { j } = await call('GET', `${THREADS()}/refresh_access_token?${q({ grant_type: 'th_refresh_token', access_token: token(a) })}`); await sql`update mkt_publish_accounts set token_enc = ${encrypt(String(j.access_token))}, expires_at = ${new Date(Date.now() + Number(j.expires_in ?? 5184000) * 1000).toISOString()} where id = ${a.id}`; }
    catch (e: any) { await sql`update mkt_publish_accounts set status = 'error', last_error = ${`토큰 갱신 실패: ${String(e?.message ?? e).slice(0, 200)}`} where id = ${a.id}`; }
  }
  return out;
}
/**
 * 로컬 10/21 11:45: 게시 뒤 삭제 감지 — 완료된 메타(인스타·페북·스레드) 작업의 게시물을 매체에서 다시 조회(30일 안, 6시간마다).
 * 없다고 답하면(404 / code 100 subcode 33 / "does not exist") 작업 deleted_at, 같은 콘텐츠에 살아 있는 게시가 없으면 콘텐츠 published_deleted_at('게시 삭제됨') + 요청자·승인자 알림 1회.
 * 토큰 오류·일시 오류는 삭제로 보지 않고 다음 점검으로 넘긴다.
 */
export async function publishDeletedTick(limit = 20) {
  const sql = db();
  const jobs = await sql<any[]>`select j.id, j.tenant, j.content_id, j.external_post_id, j.requested_by, a.id as account_id, a.provider, a.external_id, a.label, a.token_enc, a.refresh_enc, a.expires_at, a.info
    from mkt_publish_jobs j join mkt_publish_accounts a on a.id = j.account_id
    where j.status = 'done' and j.deleted_at is null and j.external_post_id is not null and j.provider in ('meta_ig', 'meta_fb', 'meta_threads') and a.status = 'active'
      and j.updated_at > now() - interval '30 days' and (j.checked_at is null or j.checked_at < now() - interval '6 hours') order by j.checked_at nulls first, j.updated_at limit ${limit}`;
  let deleted = 0, checked = 0;
  for (const j of jobs) {
    const a: Acc = { id: j.account_id, provider: j.provider, external_id: j.external_id, label: j.label, token_enc: j.token_enc, refresh_enc: j.refresh_enc, expires_at: j.expires_at, info: j.info };
    const base = j.provider === 'meta_threads' ? THREADS() : GRAPH();
    let gone = false;
    try { await call('GET', `${base}/${encodeURIComponent(j.external_post_id)}?${q({ fields: 'id', access_token: token(a) })}`); }
    catch (e: any) {
      const msg = String(e?.message ?? e);
      if (e instanceof Retry) continue; // 일시 오류 — 다음 점검
      // 삭제로 보는 것은 Graph 가 '없는 객체'라고 답한 때만(code 100·subcode 33·"does not exist"). 주소 오류 같은 맨 404 는 삭제가 아님
      if (/does not exist|Unsupported get request|cannot be loaded|subcode.*33|\(#100\)/i.test(msg)) gone = true;
      else if (/OAuth|access token|190|expired/i.test(msg)) { await sql`update mkt_publish_accounts set status = 'error', last_error = ${msg.slice(0, 300)} where id = ${a.id}`.catch(() => {}); continue; }
      else { await sql`update mkt_publish_jobs set checked_at = now() where id = ${j.id}`; checked++; continue; }
    }
    checked++;
    if (!gone) { await sql`update mkt_publish_jobs set checked_at = now() where id = ${j.id}`; continue; }
    deleted++;
    await sql`update mkt_publish_jobs set deleted_at = now(), checked_at = now(), last_error = '매체에서 게시물이 삭제됨', updated_at = now() where id = ${j.id}`;
    const [live] = await sql<{ n: number }[]>`select count(*)::int as n from mkt_publish_jobs where content_id = ${j.content_id} and status = 'done' and deleted_at is null and provider <> 'manual'`;
    const [c] = await sql<any[]>`select id, title, created_by, published_deleted_at, brand_id, is_test from mkt_contents where id = ${j.content_id}`;
    if (!c) continue;
    if (!live.n && !c.published_deleted_at) await sql`update mkt_contents set published_deleted_at = now(), updated_at = now() where id = ${c.id}`;
    await (await import('./mktAuto')).mktNotify(sql, { tenant: j.tenant, brand_id: c.brand_id, is_test: c.is_test, created_by: c.created_by }, j.requested_by, { userIds: [j.requested_by, c.created_by], type: 'sync_error', title: `게시물 삭제됨 — ${PROVIDER_LABEL[j.provider] ?? j.provider}: ${String(c.title ?? '').slice(0, 40)}`, body: live.n ? '다른 채널 게시는 남아 있습니다. 필요하면 다시 게시하세요.' : '매체에서 게시물이 지워졌습니다. 다시 게시하려면 콘텐츠에서 [서버로 게시]를 누르세요.', link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_publish_job', entityId: j.id, dedupeKey: `mkt:deleted:${j.id}` });
  }
  return { checked, deleted };
}
export { badRequest };
