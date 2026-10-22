import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { encrypt, newToken, sha256 } from './crypto';
import { audit, logError } from './log';
import { appUrl } from './mail';
import { zUuid } from './api';
import { tenantOf, type SessionUser } from './types';

/**
 * 상용화 ⑤-2 게시 채널(대표 결정 10/19: 구독형 통합 게시 API 미사용 → 모든 채널 직접 연동).
 * - 고객 화면은 채널마다 [연결] 하나. 기술 단계(앱 ID·콜백·권한 이름)는 플랫폼 관리자에게만.
 * - 심사 통과 전(출시 10/27 포함)에는 연결과 상관없이 인스타·페이스북·스레드도 '게시 도우미'(복사·내려받기·앱 열기 → [게시 확인])로 운영.
 *   서버 자동 게시는 META_PUBLISH_LIVE=1(앱 심사 통과) 이후 별도 단계에서 켠다.
 * - Meta(페이스북 페이지·인스타 비즈니스): META_APP_ID/SECRET 이 들어오면 [연결]이 열림. 연결 때 점검(관리자 여부·인스타 연결·계정 유형)을 함께 저장.
 * - 토큰은 암호화해서만 저장, 화면·API 응답에 내보내지 않음. 연결 끊기 = 행 삭제(토큰 즉시 삭제). Meta 데이터 삭제 콜백도 같은 처리.
 */
export type ChannelKey = 'instagram' | 'facebook' | 'threads' | 'youtube' | 'tiktok' | 'x' | 'linkedin' | 'pinterest' | 'naver_blog' | 'kakao_channel' | 'naver_place';
type Kind = 'meta' | 'threads' | 'google' | 'tiktok' | 'later' | 'helper';
export const PUBLISH_CHANNELS: { key: ChannelKey; label: string; kind: Kind; providers: string[]; note: string; on: boolean }[] = [
  { key: 'instagram', label: '인스타그램', kind: 'meta', providers: ['meta_ig'], note: '비즈니스·크리에이터 계정 + 페이스북 페이지 연결 필요', on: true },
  { key: 'facebook', label: '페이스북 페이지', kind: 'meta', providers: ['meta_fb'], note: '페이지 관리자 권한 필요', on: true },
  { key: 'threads', label: '스레드', kind: 'threads', providers: ['meta_threads'], note: '인스타그램 계정으로 쓰는 스레드(별도 [연결])', on: false },
  { key: 'youtube', label: '유튜브', kind: 'google', providers: ['youtube'], note: '쇼츠·영상 업로드(Google 계정)', on: false },
  { key: 'tiktok', label: '틱톡', kind: 'tiktok', providers: ['tiktok'], note: '감사 통과 전에는 비공개로만 올라감', on: false },
  { key: 'x', label: 'X(트위터)', kind: 'later', providers: [], note: '후순위', on: false },
  { key: 'linkedin', label: '링크드인', kind: 'later', providers: [], note: '후순위', on: false },
  { key: 'pinterest', label: '핀터레스트', kind: 'later', providers: [], note: '후순위', on: false },
  { key: 'naver_blog', label: '네이버 블로그', kind: 'helper', providers: [], note: '공식 쓰기 API 없음 — 게시 도우미로 직접 발행', on: true },
  { key: 'kakao_channel', label: '카카오톡 채널', kind: 'helper', providers: [], note: '채널 관리자센터에서 직접 소식 작성', on: false },
  { key: 'naver_place', label: '네이버 플레이스', kind: 'helper', providers: [], note: '스마트플레이스에서 직접 소식 작성', on: false },
];
const T = () => process.env.ADS_TEST_BASE?.replace(/\/$/, '');
const GRAPH = () => (T() ? `${T()}/graph` : 'https://graph.facebook.com/v21.0');
const FB_DIALOG = () => (T() ? `${T()}/fbdialog` : 'https://www.facebook.com/v21.0/dialog/oauth');
// 페이지 목록·인스타 연결 확인·게시에 필요한 권한(제출 직전 Meta 문서로 다시 확인 — MKT_PUBLISHING_DESIGN.md)
export const META_PUBLISH_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management'];
const metaReady = () => !!(process.env.META_APP_ID && process.env.META_APP_SECRET);
// 대표 10/20 22:30 ② M1: 스레드(Threads API 앱)·유튜브(로그인용과 다른 Google 클라이언트, youtube.upload) 연결 — env 가 들어오면 [연결] 열림. 틱톡은 다음 단계
const threadsReady = () => !!(process.env.THREADS_APP_ID && process.env.THREADS_APP_SECRET);
const ytReady = () => !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET);
const kindReady = (k: Kind) => (k === 'meta' ? metaReady() : k === 'threads' ? threadsReady() : k === 'google' ? ytReady() : false);
const THREADS_SCOPES = ['threads_basic', 'threads_content_publish'];
const YT_SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const THREADS_API = () => (T() ? `${T()}/threads` : 'https://graph.threads.net');
const THREADS_AUTH = () => (T() ? `${T()}/threadsauth` : 'https://threads.net/oauth/authorize');
const GOOGLE_AUTH = () => (T() ? `${T()}/goauth/auth` : 'https://accounts.google.com/o/oauth2/v2/auth');
const GOOGLE_TOKEN = () => (T() ? `${T()}/goauth/token` : 'https://oauth2.googleapis.com/token');
const YT_API = () => (T() ? `${T()}/yt` : 'https://www.googleapis.com/youtube/v3');
const metaLive = () => process.env.META_PUBLISH_LIVE === '1';
// Meta 앱이 개발 모드면 앱 역할(개발자·테스터)에 등록된 Facebook 계정만 연결됨 — 라이브 전환 후 META_APP_LIVE_MODE=1
const metaDevMode = () => process.env.META_APP_LIVE_MODE !== '1';
const callback = (p = 'meta') => `${appUrl()}/api/marketing/publish/callback/${p}`;
function adminOnly(u: SessionUser) { if (!isAdmin(u)) throw forbidden('게시 채널 연결은 관리자가 합니다'); }

async function getJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* JSON 아님 */ }
  if (!r.ok) {
    const path = (() => { try { const x = new URL(url); return `${x.host}${x.pathname}`; } catch { return ''; } })();
    throw new HttpError(502, 'publish_upstream', `Meta API 오류 ${r.status} ${path} ${String(j?.error?.message ?? '').slice(0, 200)}`.trim());
  }
  return j;
}

/** 게시 채널 목록 + 회사 설정(켜기/끄기) + 연결된 계정(토큰 제외) + 연결 점검 결과 */
export async function listChannels(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const sets = new Map((await sql<{ channel: string; enabled: boolean }[]>`select channel, enabled from mkt_channel_settings where tenant = ${t}`).map((r) => [r.channel, r.enabled]));
  const accs = await sql<any[]>`select a.id, a.provider, a.external_id, a.label, a.status, a.last_error, a.info, a.created_at, a.brand_id, a.shared, b.name as brand from mkt_publish_accounts a left join mkt_brands b on b.id = a.brand_id where a.tenant = ${t} and a.status <> 'disconnected' order by a.created_at`;
  const admin = isAdmin(u);
  return {
    canEdit: admin,
    metaDevMode: metaReady() && metaDevMode(),
    channels: PUBLISH_CHANNELS.map((c) => {
      const accounts = accs.filter((a) => c.providers.includes(a.provider)).map((a) => ({ id: a.id, provider: a.provider, label: a.label, status: a.status, lastError: a.last_error, warnings: (a.info?.warnings ?? []) as string[], brandId: a.brand_id as string | null, brand: a.brand as string | null, shared: !!a.shared }));
      // 운영 방식: 도우미(사람이 올리고 [게시 확인]) / 자동(심사 통과 + 연결됨)
      const mode = ['meta', 'threads', 'google'].includes(c.kind) && accounts.length ? 'auto' : c.kind === 'later' ? 'later' : 'helper'; // M1: 연결되면 서버 게시(개발 모드 앱은 앱 역할 계정만)
      return { key: c.key, label: c.label, note: c.note, kind: c.kind, enabled: sets.get(c.key) ?? c.on, connectable: c.kind !== 'helper' && c.kind !== 'later', ready: kindReady(c.kind), mode, accounts };
    }),
    // 기술 정보는 플랫폼 관리자(슈퍼 계정)에게만 — 고객 화면에는 숨김
    tech: u.platformAdmin ? { metaCallback: callback(), metaDeletion: `${appUrl()}/api/marketing/publish/meta/data-deletion`, metaScopes: META_PUBLISH_SCOPES, metaReady: metaReady(), metaLive: metaLive() } : null,
  };
}

export const channelToggle = z.object({ channel: z.enum(PUBLISH_CHANNELS.map((c) => c.key) as [ChannelKey, ...ChannelKey[]]), enabled: z.boolean() });
export async function setChannel(u: SessionUser, i: z.infer<typeof channelToggle>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  await db()`insert into mkt_channel_settings (tenant, channel, enabled, updated_by) values (${tenantOf(u)}, ${i.channel}, ${i.enabled}, ${u.id})
    on conflict (tenant, channel) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()`;
  return { ok: true };
}

/** [연결] 시작 — 지금은 Meta(페이스북 페이지 + 인스타 비즈니스 한 번에)만. 앱 ID 가 없으면 409 + 쉬운 안내 */
export async function publishConnectStart(u: SessionUser, provider: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!['meta', 'threads', 'youtube'].includes(provider)) throw notFound();
  const state = newToken(24);
  if (provider === 'threads') {
    if (!threadsReady()) throw new HttpError(409, 'publish_not_ready', '스레드 연결은 곧 열립니다(Threads 앱 심사). 그동안은 게시 도우미로 올려 주세요');
    await db()`insert into mkt_ad_oauth_states (state, user_id, tenant, provider) values (${state}, ${u.id}, ${tenantOf(u)}, 'threads_publish')`;
    return `${THREADS_AUTH()}?${new URLSearchParams({ client_id: process.env.THREADS_APP_ID!, redirect_uri: callback('threads'), state, scope: THREADS_SCOPES.join(','), response_type: 'code' })}`;
  }
  if (provider === 'youtube') {
    if (!ytReady()) throw new HttpError(409, 'publish_not_ready', '유튜브 연결은 곧 열립니다(Google 동의 화면 검증). 그동안은 게시 도우미로 올려 주세요');
    await db()`insert into mkt_ad_oauth_states (state, user_id, tenant, provider) values (${state}, ${u.id}, ${tenantOf(u)}, 'youtube_publish')`;
    return `${GOOGLE_AUTH()}?${new URLSearchParams({ client_id: process.env.YT_CLIENT_ID!, redirect_uri: callback('youtube'), state, scope: YT_SCOPES.join(' '), response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' })}`;
  }
  if (!metaReady()) throw new HttpError(409, 'publish_not_ready', '인스타그램·페이스북 연결은 곧 열립니다. 그동안은 게시 도우미로 올려 주세요');
  await db()`insert into mkt_ad_oauth_states (state, user_id, tenant, provider) values (${state}, ${u.id}, ${tenantOf(u)}, 'meta_publish')`;
  return `${FB_DIALOG()}?${new URLSearchParams({ client_id: process.env.META_APP_ID!, redirect_uri: callback(), state, scope: META_PUBLISH_SCOPES.join(','), response_type: 'code' })}`;
}

const META_HINT = {
  notAdmin: '이 페이지의 관리자 권한이 없습니다 — 페이지 설정 › 페이지 액세스에서 관리자(전체 권한)로 추가된 계정으로 다시 연결해 주세요',
  noIg: '이 페이지에 연결된 인스타그램 비즈니스 계정이 없습니다 — 인스타그램 앱 › 설정 › 계정 유형을 비즈니스(또는 크리에이터)로 바꾸고, 페이스북 페이지와 연결한 뒤 다시 [연결]을 눌러 주세요',
  noPages: '관리하는 페이스북 페이지가 없습니다 — 인스타그램 게시에도 페이스북 페이지가 필요합니다. 페이지를 만들거나 관리자로 추가된 계정으로 연결해 주세요',
  missingScope: '연결 화면에서 일부 권한을 끄셨습니다 — 다시 [연결]을 눌러 모든 항목을 허용해 주세요',
};

/** 콜백: 코드 → 사용자 토큰(장기) → 관리하는 페이지(+ 연결된 인스타) 등록. 안 된 항목은 쉬운 안내로 warnings 에 */
export async function publishConnectCallback(u: SessionUser, provider: string, code: string, state: string) {
  if (provider === 'threads' || provider === 'youtube') return connectCallbackOther(u, provider, code, state);
  if (provider !== 'meta') throw notFound();
  const sql = db();
  const [st] = await sql`delete from mkt_ad_oauth_states where state = ${state} and created_at > now() - interval '15 minutes' returning user_id, tenant, provider`;
  if (!st || st.user_id !== u.id || st.provider !== 'meta_publish' || st.tenant !== tenantOf(u)) throw badRequest('연결 요청이 만료됐습니다. 다시 시도해 주세요');
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!metaReady()) throw new HttpError(409, 'publish_not_ready', '연결이 아직 열리지 않았습니다');
  type Found = { provider: string; id: string; label: string; token: string; warnings: string[]; info: Record<string, unknown> };
  const found: Found[] = []; const general: string[] = [];
  let ownerId = '';
  try {
    const app = { client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET! };
    const short = await getJson(`${GRAPH()}/oauth/access_token?${new URLSearchParams({ ...app, redirect_uri: callback(), code })}`);
    const long = await getJson(`${GRAPH()}/oauth/access_token?${new URLSearchParams({ ...app, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token })}`);
    const token = String(long.access_token ?? short.access_token);
    ownerId = String((await getJson(`${GRAPH()}/me?${new URLSearchParams({ fields: 'id', access_token: token })}`))?.id ?? '');
    const perms = await getJson(`${GRAPH()}/me/permissions?${new URLSearchParams({ access_token: token })}`);
    const granted = new Set((perms?.data ?? []).filter((p: any) => p.status === 'granted').map((p: any) => String(p.permission)));
    if (META_PUBLISH_SCOPES.some((s) => !granted.has(s))) general.push(META_HINT.missingScope);
    // 장기 사용자 토큰으로 받은 페이지 토큰은 만료되지 않음(페이지 권한이 바뀌면 무효 → 게시 때 오류로 표시)
    const pages = await getJson(`${GRAPH()}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token,tasks,instagram_business_account{id,username}', limit: '50', access_token: token })}`);
    for (const p of pages?.data ?? []) {
      const tasks: string[] = (p.tasks ?? []).map(String);
      const admin = tasks.includes('MANAGE') || tasks.includes('CREATE_CONTENT');
      const ig = p.instagram_business_account;
      const pw = [...(admin ? [] : [META_HINT.notAdmin]), ...(ig ? [] : [META_HINT.noIg])];
      found.push({ provider: 'meta_fb', id: String(p.id), label: String(p.name ?? p.id).slice(0, 60), token: String(p.access_token ?? ''), warnings: pw, info: { admin, igId: ig?.id ?? null } });
      if (ig) found.push({ provider: 'meta_ig', id: String(ig.id), label: `@${String(ig.username ?? ig.id)}`.slice(0, 60), token: String(p.access_token ?? ''), warnings: admin ? [] : [META_HINT.notAdmin], info: { admin, pageId: String(p.id), pageName: p.name ?? null } });
    }
  } catch (e) { await logError('mkt-publish-oauth', e, { provider }).catch(() => {}); throw e instanceof HttpError ? e : badRequest('연결에 실패했습니다'); }
  if (!found.length) throw badRequest(META_HINT.noPages);
  for (const f of found.slice(0, 40)) {
    const warnings = [...general, ...f.warnings];
    await sql`insert into mkt_publish_accounts (tenant, provider, external_id, label, token_enc, scopes, status, last_error, created_by, owner_ext_id, info, brand_id)
      values (${tenantOf(u)}, ${f.provider}, ${f.id}, ${f.label}, ${f.token ? encrypt(f.token) : null}, ${META_PUBLISH_SCOPES}, 'active', null, ${u.id}, ${ownerId || null}, ${sql.json({ ...f.info, warnings } as never)}, ${await guessBrandId(tenantOf(u), f.label)})
      on conflict (tenant, provider, external_id) do update set label = excluded.label, token_enc = excluded.token_enc, scopes = excluded.scopes, status = 'active', last_error = null, owner_ext_id = excluded.owner_ext_id, info = excluded.info,
        brand_id = coalesce(mkt_publish_accounts.brand_id, excluded.brand_id)`;
  }
  const ig = found.filter((f) => f.provider === 'meta_ig').length, fb = found.filter((f) => f.provider === 'meta_fb').length;
  await audit(sql, u.id, 'mkt_publish.connect', 'mkt_publish_account', null, { provider: 'meta', pages: fb, instagram: ig }).catch(() => {});
  return { pages: fb, instagram: ig, warnings: found.reduce((n, f) => n + f.warnings.length, general.length) };
}

/** 스레드(Threads API, 장기 토큰 60일 → tick 갱신) · 유튜브(refresh token, 채널 1개) 콜백 */
async function connectCallbackOther(u: SessionUser, provider: 'threads' | 'youtube', code: string, state: string) {
  const sql = db();
  const [st] = await sql`delete from mkt_ad_oauth_states where state = ${state} and created_at > now() - interval '15 minutes' returning user_id, tenant, provider`;
  if (!st || st.user_id !== u.id || st.provider !== `${provider}_publish` || st.tenant !== tenantOf(u)) throw badRequest('연결 요청이 만료됐습니다. 다시 시도해 주세요');
  await assertSpace(u, 'marketing'); adminOnly(u);
  const form = async (url: string, body: Record<string, string>) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(20000) }); const j: any = await r.json().catch(() => ({})); if (!r.ok) throw new HttpError(502, 'publish_upstream', `${provider} 토큰 오류 ${r.status} ${String(j?.error_message ?? j?.error_description ?? j?.error ?? '').slice(0, 200)}`); return j; };
  try {
    if (provider === 'threads') {
      if (!threadsReady()) throw new HttpError(409, 'publish_not_ready', '연결이 아직 열리지 않았습니다');
      const short = await form(`${THREADS_API()}/oauth/access_token`, { client_id: process.env.THREADS_APP_ID!, client_secret: process.env.THREADS_APP_SECRET!, grant_type: 'authorization_code', redirect_uri: callback('threads'), code });
      const long = await getJson(`${THREADS_API()}/access_token?${new URLSearchParams({ grant_type: 'th_exchange_token', client_secret: process.env.THREADS_APP_SECRET!, access_token: String(short.access_token) })}`).catch(() => null);
      const tk = String(long?.access_token ?? short.access_token); const exp = new Date(Date.now() + Number(long?.expires_in ?? 3600) * 1000).toISOString();
      const me = await getJson(`${THREADS_API()}/v1.0/me?${new URLSearchParams({ fields: 'id,username', access_token: tk })}`);
      const id = String(me?.id ?? short.user_id); const label = `@${String(me?.username ?? id)}`.slice(0, 60);
      await sql`insert into mkt_publish_accounts (tenant, provider, external_id, label, token_enc, scopes, expires_at, status, last_error, created_by, owner_ext_id, info, brand_id)
        values (${tenantOf(u)}, 'meta_threads', ${id}, ${label}, ${encrypt(tk)}, ${THREADS_SCOPES}, ${exp}, 'active', null, ${u.id}, ${id}, ${sql.json({ warnings: [] } as never)}, ${await guessBrandId(tenantOf(u), label, 'meta_threads')})
        on conflict (tenant, provider, external_id) do update set label = excluded.label, token_enc = excluded.token_enc, scopes = excluded.scopes, expires_at = excluded.expires_at, status = 'active', last_error = null, owner_ext_id = excluded.owner_ext_id, info = excluded.info`;
      await audit(sql, u.id, 'mkt_publish.connect', 'mkt_publish_account', null, { provider: 'threads', account: label }).catch(() => {});
      return { pages: 0, instagram: 0, threads: 1, youtube: 0, warnings: 0 };
    }
    if (!ytReady()) throw new HttpError(409, 'publish_not_ready', '연결이 아직 열리지 않았습니다');
    const tok = await form(GOOGLE_TOKEN(), { client_id: process.env.YT_CLIENT_ID!, client_secret: process.env.YT_CLIENT_SECRET!, grant_type: 'authorization_code', redirect_uri: callback('youtube'), code });
    const granted = String(tok.scope ?? '').split(/\s+/);
    if (!granted.includes(YT_SCOPES[0])) throw badRequest('연결 화면에서 "YouTube 동영상 업로드" 권한을 끄셨습니다 — 다시 [연결]을 눌러 허용해 주세요');
    const r = await fetch(`${YT_API()}/channels?${new URLSearchParams({ part: 'snippet', mine: 'true' })}`, { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(20000) });
    const ch: any = await r.json().catch(() => ({})); const item = ch?.items?.[0];
    if (!r.ok || !item) throw badRequest('이 Google 계정에 유튜브 채널이 없습니다 — 채널을 만든 계정으로 다시 연결해 주세요');
    const exp = new Date(Date.now() + Number(tok.expires_in ?? 3600) * 1000).toISOString();
    await sql`insert into mkt_publish_accounts (tenant, provider, external_id, label, token_enc, refresh_enc, scopes, expires_at, status, last_error, created_by, info)
      values (${tenantOf(u)}, 'youtube', ${String(item.id)}, ${String(item.snippet?.title ?? item.id).slice(0, 60)}, ${encrypt(String(tok.access_token))}, ${tok.refresh_token ? encrypt(String(tok.refresh_token)) : null}, ${YT_SCOPES}, ${exp}, 'active', null, ${u.id}, ${sql.json({ warnings: tok.refresh_token ? [] : ['갱신 토큰을 받지 못했습니다 — Google 계정 › 보안 › 제3자 앱에서 워크인을 지우고 다시 연결하면 받습니다'] } as never)})
      on conflict (tenant, provider, external_id) do update set label = excluded.label, token_enc = excluded.token_enc, refresh_enc = coalesce(excluded.refresh_enc, mkt_publish_accounts.refresh_enc), scopes = excluded.scopes, expires_at = excluded.expires_at, status = 'active', last_error = null, info = excluded.info`;
    await audit(sql, u.id, 'mkt_publish.connect', 'mkt_publish_account', null, { provider: 'youtube', channel: item.id }).catch(() => {});
    return { pages: 0, instagram: 0, threads: 0, youtube: 1, warnings: tok.refresh_token ? 0 : 1 };
  } catch (e) { await logError('mkt-publish-oauth', e, { provider }).catch(() => {}); throw e instanceof HttpError ? e : badRequest('연결에 실패했습니다'); }
}

/** 연결 끊기 — 토큰을 바로 지움(행 삭제). 게시 기록(mkt_publish_jobs)은 account_id 만 비워져 남음 */
/** 로컬 10/21 08:10: 연결 직후 라벨로 브랜드 추정(@hi_link_official → 하이링크, dagym → 다짐, work_in → 워크인, body_lab → 바디랩, 브랜드 이름 포함) — 못 맞추면 미지정(게시 대상에서 제외) */
const BRAND_HINTS: Record<string, string[]> = { '하이링크': ['hi_link', 'hilink', 'hi-link'], '다짐': ['dagym'], '워크인': ['work_in', 'workin', 'work-in'], '바디랩': ['body_lab', 'bodylab', 'body-lab'] };
export async function guessBrandId(tenant: string, label: string, provider?: string) {
  const brands = await db()<{ id: string; name: string }[]>`select id, name from mkt_brands where tenant = ${tenant}`;
  const l = label.toLowerCase();
  const hit = brands.find((b) => l.includes(b.name.toLowerCase()) || (BRAND_HINTS[b.name] ?? []).some((h) => l.includes(h)));
  if (hit || provider !== 'meta_threads') return hit?.id ?? null;
  // #445(대표 10/21 '스레드는 워크인만'): 이름으로 못 맞히면, 자동 제작 규칙에서 스레드를 쓰는 브랜드가 하나뿐일 때 그 브랜드로(둘 이상이면 미지정 → 사람이 지정)
  const th = await db()<{ brand_id: string }[]>`select distinct brand_id from mkt_rules where tenant = ${tenant} and active and brand_id is not null and (channel = 'threads' or 'threads' = any(cross_channels))`;
  return th.length === 1 ? th[0].brand_id : null;
}
export const accountBrandInput = z.object({ brandId: zUuid.nullable().optional(), shared: z.boolean().optional() });
/** 연결 계정의 브랜드(또는 공용) 지정 — 관리자. 공용이면 brand_id 비움 */
export async function setPublishAccountBrand(u: SessionUser, id: string, i: { brandId?: string | null; shared?: boolean }) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db();
  if (i.brandId) { const [b] = await sql`select id from mkt_brands where id = ${i.brandId} and tenant = ${tenantOf(u)}`; if (!b) throw badRequest('브랜드를 찾을 수 없습니다'); }
  const shared = i.shared === undefined ? (i.brandId ? false : undefined) : i.shared;
  const [a] = await sql`update mkt_publish_accounts set brand_id = ${shared ? null : (i.brandId ?? null)}, shared = ${shared === undefined ? sql`shared` : shared} where id = ${id} and tenant = ${tenantOf(u)} returning id, brand_id, shared, label`;
  if (!a) throw notFound('연결 계정을 찾을 수 없습니다');
  await audit(sql, u.id, 'mkt_publish.brand', 'mkt_publish_account', id, { brandId: a.brand_id, shared: a.shared }).catch(() => {});
  return { id: a.id, brandId: a.brand_id, shared: a.shared };
}
export async function removePublishAccount(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [a] = await db()`delete from mkt_publish_accounts where id = ${id} and tenant = ${tenantOf(u)} returning provider, label`;
  if (!a) throw notFound('연결 계정을 찾을 수 없습니다');
  await audit(db(), u.id, 'mkt_publish.disconnect', 'mkt_publish_account', id, { provider: a.provider }).catch(() => {});
  return { ok: true };
}

/** Meta 서명 요청(signed_request) 확인: base64url(서명).base64url(내용), 서명 = HMAC-SHA256(내용, 앱 시크릿) */
export function parseSignedRequest(sr: string, secret: string): { user_id?: string } | null {
  const [sig, payload] = String(sr).split('.');
  if (!sig || !payload) return null;
  const want = createHmac('sha256', secret).update(payload).digest();
  const got = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try { return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; }
}

/** Meta 데이터 삭제 콜백: 그 Meta 사용자가 연결한 게시 계정(토큰 포함)을 모든 회사에서 지우고 확인 코드를 돌려줌 */
export async function metaDataDeletion(signedRequest: string) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new HttpError(409, 'publish_not_ready', 'not configured');
  const p = parseSignedRequest(signedRequest, secret);
  if (!p?.user_id) throw badRequest('invalid signed_request');
  const rows = await db()`delete from mkt_publish_accounts where provider like 'meta_%' and owner_ext_id = ${String(p.user_id)} returning id`;
  const code = sha256(`${p.user_id}:${Date.now()}`).slice(0, 16);
  await audit(db(), null, 'mkt_publish.meta_data_deletion', 'mkt_publish_account', null, { removed: rows.length, code }).catch(() => {});
  return { url: `${appUrl()}/data-deletion?code=${code}`, confirmation_code: code };
}

/**
 * 로컬 10/19(대표): 마케팅 홈 '연결된 채널' — 게시 채널 + 광고 계정을 한 줄로. 상태 = 연결됨(계정 이름)·끊김·연결 안 함(·도우미).
 * connect = 홈에서 바로 누르는 [연결]: href(OAuth 시작) · 'naver_form'(입력 창) · null(준비 중 — 그동안 게시 도우미). 기술 값은 없음.
 * signup = 계정이 없을 때 만들기 안내 주소(채널 연결 3단계 카드).
 */
export type HomeChannel = { key: string; label: string; kind: 'publish' | 'ads' | 'helper'; state: 'connected' | 'broken' | 'none' | 'helper'; account: string | null; error: string | null;
  connect: string | null; pending: string | null; signup: string; ask: string };
const SIGNUP: Record<string, [string, string]> = {
  instagram: ['https://www.instagram.com/accounts/emailsignup/', '인스타그램 비즈니스(또는 크리에이터) 계정이 있나요?'],
  facebook: ['https://www.facebook.com/pages/create', '페이스북 페이지가 있나요?'],
  threads: ['https://www.threads.net/', '스레드 계정이 있나요?(인스타그램 계정으로 만듭니다)'],
  youtube: ['https://www.youtube.com/create_channel', '유튜브 채널이 있나요?'],
  naver_blog: ['https://section.blog.naver.com/', '네이버 블로그가 있나요?'],
  kakao_channel: ['https://center-pf.kakao.com/', '카카오톡 채널이 있나요?'],
  ads_naver: ['https://searchad.naver.com/', '네이버 검색광고 계정이 있나요?'],
  ads_google: ['https://ads.google.com/', 'Google Ads 계정이 있나요?'],
};
export async function homeChannels(u: SessionUser): Promise<HomeChannel[]> {
  const sql = db(); const t = tenantOf(u);
  const { AD_PROVIDERS, providerReady } = await import('./marketingAds');
  const sets = new Map((await sql<{ channel: string; enabled: boolean }[]>`select channel, enabled from mkt_channel_settings where tenant = ${t}`).map((r) => [r.channel, r.enabled]));
  const pubs = await sql<{ provider: string; label: string; status: string; last_error: string | null }[]>`select provider, label, status, last_error from mkt_publish_accounts where tenant = ${t} and status <> 'disconnected' order by created_at`;
  const ads = await sql<{ provider: string; label: string; status: string; last_error: string | null }[]>`select provider, label, status, last_error from mkt_ad_accounts where tenant = ${t} and status <> 'disconnected' order by created_at`;
  const pick = (rows: typeof pubs, providers: string[]) => { const r = rows.filter((a) => providers.includes(a.provider)); const bad = r.find((a) => a.status === 'error');
    return { state: (bad ? 'broken' : r.length ? 'connected' : 'none') as HomeChannel['state'], account: (bad ?? r[0])?.label ?? null, error: bad?.last_error ?? null }; };
  const out: HomeChannel[] = [];
  for (const k of ['instagram', 'facebook', 'threads', 'youtube'] as ChannelKey[]) {
    const c = PUBLISH_CHANNELS.find((x) => x.key === k)!;
    const ready = kindReady(c.kind);
    out.push({ key: k, label: c.label, kind: 'publish', ...pick(pubs, c.providers), connect: ready ? `/api/marketing/publish/connect/${c.kind === 'meta' ? 'meta' : c.kind === 'threads' ? 'threads' : 'youtube'}` : null,
      // 대표 10/20 6): 준비 중이면 무엇이 막는지 한 줄(로컬이 대표에게 전달)
      pending: ready ? null : k === 'threads' ? (metaReady() ? 'Meta 앱 심사 필요: threads_basic·threads_content_publish(화면 녹화 제출) — 심사 후 열림, 그동안 게시 도우미' : 'Meta 앱 ID/시크릿 없음 → 앱 심사(threads_basic·threads_content_publish) 전 — 그동안 게시 도우미')
        : k === 'youtube' ? 'Google OAuth 클라이언트 + YouTube Data API 업로드 범위(youtube.upload) 심사 필요 — 준비 중, 그동안 게시 도우미'
        : c.kind === 'meta' ? '심사 후 열림 — 그동안 게시 도우미' : '준비 중 — 그동안 게시 도우미', signup: SIGNUP[k][0], ask: SIGNUP[k][1] });
  }
  for (const k of ['naver_blog', 'kakao_channel'] as ChannelKey[]) {
    const c = PUBLISH_CHANNELS.find((x) => x.key === k)!;
    out.push({ key: k, label: c.label, kind: 'helper', state: (sets.get(k) ?? c.on) ? 'helper' : 'none', account: null, error: null, connect: null, pending: '공식 쓰기 API 없음 — 게시 도우미(복사·열기)', signup: SIGNUP[k][0], ask: SIGNUP[k][1] });
  }
  for (const p of ['naver', 'google'] as const) {
    out.push({ key: `ads_${p}`, label: AD_PROVIDERS[p], kind: 'ads', ...pick(ads, [p]), connect: p === 'naver' ? 'naver_form' : providerReady(p) ? `/api/marketing/ads/connect/${p}` : null,
      pending: providerReady(p) ? null : '준비 중(워크인 앱 등록·심사 대기)', signup: SIGNUP[`ads_${p}`][0], ask: SIGNUP[`ads_${p}`][1] });
  }
  return out;
}
