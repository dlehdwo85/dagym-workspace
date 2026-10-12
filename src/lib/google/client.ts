import { db, type Sql } from '../db';
import { decrypt, encrypt } from '../crypto';
import { notify } from '../notifications';

export const SCOPES = {
  both: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events'],
  import: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'],
};

export const apiBase = () => process.env.GOOGLE_API_BASE || 'https://www.googleapis.com/calendar/v3';
const tokenUrl = () => (process.env.GOOGLE_OAUTH_BASE || 'https://oauth2.googleapis.com') + '/token';
const revokeUrl = () => (process.env.GOOGLE_OAUTH_BASE || 'https://oauth2.googleapis.com') + '/revoke';
const authBase = () => process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';

/**
 * Google Calendar 동기화는 **선택 기능**이다(핵심 업무·일정 기능은 자체 DB 로만 동작).
 * FEATURE_GOOGLE_SYNC=1 과 OAuth 클라이언트가 모두 있을 때만 켜진다. 기본값은 꺼짐.
 */
export function googleConfigured() {
  return process.env.FEATURE_GOOGLE_SYNC === '1' && !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
export const googleSyncEnabled = googleConfigured;
export function redirectUri() {
  return `${process.env.APP_URL}/api/google/callback`;
}

export function authUrl(state: string, mode: 'both' | 'import') {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES[mode].join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  });
  return `${authBase()}?${p}`;
}

export class GoogleAuthError extends Error {}
export class GoogleApiError extends Error {
  constructor(public status: number, message: string, public body?: any) { super(message); }
}

export async function exchangeCode(code: string) {
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(), grant_type: 'authorization_code' }),
  });
  const j = await res.json();
  if (!res.ok) throw new GoogleAuthError(j.error_description ?? j.error ?? 'token exchange failed');
  return j as { access_token: string; refresh_token?: string; expires_in: number; scope: string; id_token?: string };
}

function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).email ?? null;
  } catch { return null; }
}

export async function saveTokens(userId: string, t: Awaited<ReturnType<typeof exchangeCode>>) {
  const sql = db();
  await sql`insert into google_accounts (user_id, google_email, access_token_enc, refresh_token_enc, token_expires_at, scopes, status, last_error)
    values (${userId}, ${emailFromIdToken(t.id_token)}, ${encrypt(t.access_token)}, ${t.refresh_token ? encrypt(t.refresh_token) : null},
      now() + ${t.expires_in + ' seconds'}::interval, ${t.scope}, 'active', null)
    on conflict (user_id) do update set google_email = coalesce(excluded.google_email, google_accounts.google_email),
      access_token_enc = excluded.access_token_enc,
      refresh_token_enc = coalesce(excluded.refresh_token_enc, google_accounts.refresh_token_enc),
      token_expires_at = excluded.token_expires_at, scopes = excluded.scopes, status = 'active', last_error = null, updated_at = now()`;
}

async function markReauth(sql: Sql, userId: string, reason: string) {
  await sql`update google_accounts set status = 'reauth_required', last_error = ${reason}, updated_at = now() where user_id = ${userId}`;
  await sql`insert into sync_logs (user_id, direction, action, status, detail) values (${userId}, 'auth', 'refresh', 'error', ${sql.json({ reason })})`;
  await notify(sql, { userIds: [userId], type: 'sync_error', title: 'Google Calendar 연결을 다시 해 주세요',
    body: '권한이 만료되었거나 해제되었습니다. 설정 > Google Calendar 에서 "다시 연결"을 누르세요.', link: '/settings/google',
    dedupeKey: `reauth:${userId}:${new Date().toISOString().slice(0, 10)}` });
}

/** 유효한 access token (필요하면 갱신). 갱신 불가 시 GoogleAuthError */
export async function accessToken(userId: string): Promise<string> {
  const sql = db();
  const [a] = await sql`select * from google_accounts where user_id = ${userId}`;
  if (!a || a.status !== 'active') throw new GoogleAuthError('Google 계정이 연결되어 있지 않거나 재연결이 필요합니다');
  if (a.access_token_enc && new Date(a.token_expires_at).getTime() > Date.now() + 60_000) return decrypt(a.access_token_enc);
  if (!a.refresh_token_enc) { await markReauth(sql, userId, 'refresh token 없음'); throw new GoogleAuthError('재연결 필요'); }
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: decrypt(a.refresh_token_enc), grant_type: 'refresh_token' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (j.error === 'invalid_grant' || res.status === 400 || res.status === 401) {
      await markReauth(sql, userId, j.error_description ?? j.error ?? `HTTP ${res.status}`);
      throw new GoogleAuthError('Google 권한이 만료되었습니다');
    }
    throw new GoogleApiError(res.status, `토큰 갱신 실패 ${res.status}`);
  }
  await sql`update google_accounts set access_token_enc = ${encrypt(j.access_token)}, token_expires_at = now() + ${j.expires_in + ' seconds'}::interval,
    updated_at = now() where user_id = ${userId}`;
  return j.access_token;
}

export async function gapi(userId: string, method: string, path: string, opts: { query?: Record<string, string | undefined>; body?: unknown; ifMatch?: string } = {}) {
  const token = await accessToken(userId);
  const q = opts.query ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined) as [string, string][]) : '';
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (opts.body) headers['content-type'] = 'application/json';
  if (opts.ifMatch) headers['if-match'] = opts.ifMatch;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(apiBase() + path + q, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (res.status === 204) return null;
    const j = await res.json().catch(() => null);
    if (res.status === 401) {
      await markReauth(db(), userId, 'API 401');
      throw new GoogleAuthError('Google 권한이 만료되었습니다');
    }
    if (!res.ok) throw new GoogleApiError(res.status, j?.error?.message ?? `Google API ${res.status}`, j);
    return j;
  }
}

export async function revoke(userId: string) {
  const sql = db();
  const [a] = await sql`select refresh_token_enc, access_token_enc from google_accounts where user_id = ${userId}`;
  const tok = a?.refresh_token_enc ? decrypt(a.refresh_token_enc) : a?.access_token_enc ? decrypt(a.access_token_enc) : null;
  if (tok) await fetch(revokeUrl() + '?token=' + encodeURIComponent(tok), { method: 'POST' }).catch(() => {});
}
