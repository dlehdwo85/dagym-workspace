// #1177(App Store 심사 승인·반려 알림): App Store Connect API 로 iOS 최신 버전의 심사 상태를 읽어(읽기만) 운영 서버에 알림 —
// GitHub Actions(appstore-status.yml, 1시간마다)에서만 실행. 키는 Secrets(ASC_KEY_ID · ASC_ISSUER_ID · ASC_KEY_P8, appstore-submit 과 같은 것).
// 서버는 상태가 바뀔 때만 플랫폼 운영자에게 앱 알림 + 메일(반려 · 승인 · 출시 · 심사 중 …) — 같은 상태를 다시 보내도 알림은 한 번.
// 서버 인증은 tick 과 같은 GitHub OIDC 토큰(OIDC_TOKEN). 외부 패키지 없음(Node 22 fetch + node:crypto ES256). 키·토큰은 출력하지 않음.
import { createPrivateKey, sign } from 'node:crypto';

const env = (k, d = '') => process.env[k] ?? d;
const KEY_ID = env('ASC_KEY_ID'), ISSUER = env('ASC_ISSUER_ID'), P8 = env('ASC_KEY_P8');
const BUNDLE = env('BUNDLE_ID', 'kr.co.dagym.workos');
const API = env('ASC_API_BASE', 'https://api.appstoreconnect.apple.com/v1'); // 시험은 가짜 서버
const APP_URL = env('APP_URL').replace(/\/+$/, ''), OIDC = env('OIDC_TOKEN');
if (!KEY_ID || !ISSUER || !P8) { console.error('ASC_KEY_ID · ASC_ISSUER_ID · ASC_KEY_P8 가 필요합니다(Secrets)'); process.exit(2); }

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 10 * 60, aud: 'appstoreconnect-v1' }));
  const key = createPrivateKey({ key: P8.includes('BEGIN') ? P8 : `-----BEGIN PRIVATE KEY-----\n${P8}\n-----END PRIVATE KEY-----`, format: 'pem' });
  return `${head}.${body}.${b64u(sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }))}`;
}
async function get(url) {
  const r = await fetch(`${API}${url}`, { headers: { authorization: `Bearer ${token()}` } });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`GET ${url.split('?')[0]} → ${r.status} ${j?.errors?.map((e) => `${e.code}: ${e.title}`).join(' | ') ?? ''}`);
  return j;
}

const app = (await get(`/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}`)).data?.[0];
if (!app) { console.error(`앱을 찾지 못함(${BUNDLE})`); process.exit(1); }
const versions = (await get(`/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`)).data ?? [];
const stateOf = (v) => v.attributes.appVersionState ?? v.attributes.appStoreState ?? 'UNKNOWN';
// 가장 최근에 만든 버전(심사 흐름이 진행 중인 것) — createdDate 가 없으면 받은 순서 첫째
const latest = [...versions].sort((a, b) => String(b.attributes.createdDate ?? '').localeCompare(String(a.attributes.createdDate ?? '')))[0];
if (!latest) { console.log('iOS 버전 없음'); process.exit(0); }
const out = { version: latest.attributes.versionString, state: stateOf(latest), live: versions.filter((v) => ['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(stateOf(v))).map((v) => v.attributes.versionString) };
console.log(`iOS ${out.version}: ${out.state}${out.live.length ? ` · 출시 중 ${out.live.join(', ')}` : ''}`);
if (!APP_URL || !OIDC) { console.log('(APP_URL·OIDC_TOKEN 없음 — 서버 알림 건너뜀)'); process.exit(0); }
const r = await fetch(`${APP_URL}/api/cron/app-review`, { method: 'POST', headers: { authorization: `Bearer ${OIDC}`, 'content-type': 'application/json' }, body: JSON.stringify(out) });
const j = await r.json().catch(() => null);
if (!r.ok) { console.error(`서버 알림 실패 ${r.status} ${JSON.stringify(j).slice(0, 200)}`); process.exit(1); }
console.log(j?.changed ? `상태 바뀜 → 알림 ${j.notified ?? 0}명` : '상태 그대로(알림 없음)');
