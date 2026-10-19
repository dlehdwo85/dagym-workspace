import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { encrypt, newToken, sha256 } from './crypto';
import { audit, logError } from './log';
import { appUrl } from './mail';
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
type Kind = 'meta' | 'google' | 'tiktok' | 'later' | 'helper';
export const PUBLISH_CHANNELS: { key: ChannelKey; label: string; kind: Kind; providers: string[]; note: string; on: boolean }[] = [
  { key: 'instagram', label: '인스타그램', kind: 'meta', providers: ['meta_ig'], note: '비즈니스·크리에이터 계정 + 페이스북 페이지 연결 필요', on: true },
  { key: 'facebook', label: '페이스북 페이지', kind: 'meta', providers: ['meta_fb'], note: '페이지 관리자 권한 필요', on: true },
  { key: 'threads', label: '스레드', kind: 'meta', providers: ['meta_threads'], note: '인스타그램 계정으로 쓰는 스레드', on: false },
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
const kindReady = (k: Kind) => (k === 'meta' ? metaReady() : false); // Google(유튜브)·틱톡은 다음 단계(별도 클라이언트·감사 자료 준비 중)
const metaLive = () => process.env.META_PUBLISH_LIVE === '1';
// Meta 앱이 개발 모드면 앱 역할(개발자·테스터)에 등록된 Facebook 계정만 연결됨 — 라이브 전환 후 META_APP_LIVE_MODE=1
const metaDevMode = () => process.env.META_APP_LIVE_MODE !== '1';
const callback = () => `${appUrl()}/api/marketing/publish/callback/meta`;
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
  const accs = await sql<any[]>`select id, provider, external_id, label, status, last_error, info, created_at from mkt_publish_accounts where tenant = ${t} and status <> 'disconnected' order by created_at`;
  const admin = isAdmin(u);
  return {
    canEdit: admin,
    metaDevMode: metaReady() && metaDevMode(),
    channels: PUBLISH_CHANNELS.map((c) => {
      const accounts = accs.filter((a) => c.providers.includes(a.provider)).map((a) => ({ id: a.id, provider: a.provider, label: a.label, status: a.status, lastError: a.last_error, warnings: (a.info?.warnings ?? []) as string[] }));
      // 운영 방식: 도우미(사람이 올리고 [게시 확인]) / 자동(심사 통과 + 연결됨)
      const mode = c.kind === 'meta' && metaLive() && accounts.length ? 'auto' : c.kind === 'later' ? 'later' : 'helper';
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
  if (provider !== 'meta') throw notFound();
  if (!metaReady()) throw new HttpError(409, 'publish_not_ready', '인스타그램·페이스북 연결은 곧 열립니다. 그동안은 게시 도우미로 올려 주세요');
  const state = newToken(24);
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
    await sql`insert into mkt_publish_accounts (tenant, provider, external_id, label, token_enc, scopes, status, last_error, created_by, owner_ext_id, info)
      values (${tenantOf(u)}, ${f.provider}, ${f.id}, ${f.label}, ${f.token ? encrypt(f.token) : null}, ${META_PUBLISH_SCOPES}, 'active', null, ${u.id}, ${ownerId || null}, ${sql.json({ ...f.info, warnings } as never)})
      on conflict (tenant, provider, external_id) do update set label = excluded.label, token_enc = excluded.token_enc, scopes = excluded.scopes, status = 'active', last_error = null, owner_ext_id = excluded.owner_ext_id, info = excluded.info`;
  }
  const ig = found.filter((f) => f.provider === 'meta_ig').length, fb = found.filter((f) => f.provider === 'meta_fb').length;
  await audit(sql, u.id, 'mkt_publish.connect', 'mkt_publish_account', null, { provider: 'meta', pages: fb, instagram: ig }).catch(() => {});
  return { pages: fb, instagram: ig, warnings: found.reduce((n, f) => n + f.warnings.length, general.length) };
}

/** 연결 끊기 — 토큰을 바로 지움(행 삭제). 게시 기록(mkt_publish_jobs)은 account_id 만 비워져 남음 */
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
