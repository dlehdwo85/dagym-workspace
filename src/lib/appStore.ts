/**
 * #1177 App Store 단추 자동 켜기 + 심사 승인·반려 알림.
 * ① 단추: 아이폰 앱 주소는 NEXT_PUBLIC_APPSTORE_URL 이 있으면 그것, 없으면 애플 공개 조회(iTunes lookup, 키 없음)로 찾은 주소 —
 *    앱이 App Store 에 올라오면 재배포 없이 앱 받기 화면·휴대폰 띠·소개 화면 단추가 켜진다. 공개 조회는 1시간 캐시(못 찾으면 10분 뒤 다시).
 * ② 정기 실행(appStoreWatchJob, 1시간마다): 공개 조회로 처음 올라온 때·새 버전을 플랫폼 운영자에게 알림.
 * ③ 심사 상태(recordReviewState): GitHub Actions(appstore-status.yml)가 App Store Connect 에서 읽은 상태를 보내면 바뀐 때만 알림 — 반려·승인은 메일도.
 * 서버 전용(DB·메일). 화면 묶음에는 storeLinks 만 들어간다.
 */
import { z } from 'zod';
import { db, type Sql } from './db';
import { APPSTORE_URL } from './storeLinks';

const BUNDLE = () => process.env.IOS_BUNDLE_ID || 'kr.co.dagym.workos';
const HOUR = 3600_000;
export type StoreHit = { url: string; version: string | null };
let memo: { at: number; v: StoreHit | null } | null = null;

/** 애플 공개 조회 — 같은 서버에서는 1시간(못 찾으면 10분) 안에 다시 묻지 않음. 시험은 APPSTORE_LOOKUP_URL(가짜 서버) */
export async function lookupAppStore(force = false): Promise<StoreHit | null> {
  if (!force && memo && Date.now() - memo.at < (memo.v ? HOUR : 10 * 60_000)) return memo.v;
  const fake = process.env.APPSTORE_LOOKUP_URL;
  try {
    const r = await fetch(`${fake || 'https://itunes.apple.com/lookup'}?bundleId=${encodeURIComponent(BUNDLE())}&country=kr`,
      { signal: AbortSignal.timeout(4000), ...(fake ? { cache: 'no-store' } : { next: { revalidate: 3600 } }) } as RequestInit);
    const j = r.ok ? ((await r.json()) as { results?: { bundleId?: string; trackViewUrl?: string; version?: string }[] }) : null;
    const hit = j?.results?.find((x) => x.bundleId === BUNDLE()) ?? null;
    const url = hit?.trackViewUrl && /^https:\/\/apps\.apple\.com\//.test(hit.trackViewUrl) ? hit.trackViewUrl.split('?')[0] : null;
    memo = { at: Date.now(), v: url ? { url, version: hit?.version ?? null } : null };
  } catch { memo = { at: Date.now() - HOUR + 10 * 60_000, v: memo?.v ?? null }; } // 조회 실패 — 아는 값 그대로, 10분 뒤 다시
  return memo.v;
}

/** 화면에 쓸 App Store 주소('' = 아직 없음 → 홈 화면에 추가 안내) */
export async function appStoreUrl(): Promise<string> {
  if (APPSTORE_URL) return APPSTORE_URL;
  return (await lookupAppStore().catch(() => null))?.url ?? '';
}

async function setting<T>(sql: Sql, key: string): Promise<T | null> {
  const [r] = await sql<{ value: T }[]>`select value from app_settings where key = ${key}`;
  return r?.value ?? null;
}
const save = (sql: Sql, key: string, value: unknown) =>
  sql`insert into app_settings (key, value) values (${key}, ${sql.json(value as never)}) on conflict (key) do update set value = excluded.value, updated_at = now()`;

async function tellOps(sql: Sql, title: string, body: string, dedupeKey: string, mail: boolean) {
  const { platformAdminIds } = await import('./superAdmin');
  const ids = await platformAdminIds(sql);
  if (!ids.length) return 0;
  const { notify } = await import('./notifications');
  await notify(sql, { userIds: ids, type: 'announcement', title, body, link: '/platform', entityType: null, entityId: null, actorId: null, dedupeKey } as never).catch(() => {});
  if (mail) {
    const { sendMail } = await import('./mail');
    for (const r of await sql<{ email: string }[]>`select email from users where id = any(${ids}::uuid[])`) await sendMail(r.email, `[워크인] ${title}`, body).catch(() => {});
  }
  return ids.length;
}

/** 정기 실행: 1시간마다 공개 조회 → App Store 에 처음 올라오면·새 버전이면 운영자에게 알림(+메일). 주소를 환경 변수로 넣었으면 할 일 없음 */
export async function appStoreWatchJob(sql: Sql = db()) {
  if (APPSTORE_URL) return { skipped: 'env' };
  if (process.env.APPSTORE_WATCH === 'off') return { skipped: 'off' };
  const prev = await setting<{ url: string | null; version: string | null; checkedAt: string }>(sql, 'appstore_live');
  if (prev && Date.now() - new Date(prev.checkedAt).getTime() < HOUR - 60_000) return { skipped: 'recent' };
  const hit = await lookupAppStore(true);
  await save(sql, 'appstore_live', { url: hit?.url ?? prev?.url ?? null, version: hit?.version ?? prev?.version ?? null, checkedAt: new Date().toISOString() });
  if (!hit) return { live: !!prev?.url };
  if (!prev?.url) {
    const n = await tellOps(sql, '아이폰 앱이 App Store 에 올라왔습니다', `버전 ${hit.version ?? '-'} · 앱 받기 화면·휴대폰 띠·소개 화면의 App Store 단추가 자동으로 켜졌습니다.\n${hit.url}`, `appstore-live:${hit.url}`, true);
    return { live: true, first: true, notified: n };
  }
  if (hit.version && prev.version && hit.version !== prev.version) {
    const n = await tellOps(sql, `아이폰 앱 새 버전 ${hit.version} 출시`, `App Store 에 ${prev.version} → ${hit.version} 로 바뀌었습니다.`, `appstore-version:${hit.version}`, false);
    return { live: true, version: hit.version, notified: n };
  }
  return { live: true };
}

/** App Store Connect 심사 상태(appVersionState) → 운영자에게 보일 말. 알리지 않는 상태는 null */
const STATE: Record<string, { label: string; mail: boolean; body: string } | null> = {
  WAITING_FOR_REVIEW: { label: '심사 대기', mail: false, body: '애플 심사 줄에 들어갔습니다.' },
  IN_REVIEW: { label: '심사 중', mail: false, body: '애플이 심사를 시작했습니다.' },
  REJECTED: { label: '반려', mail: true, body: 'App Store Connect 의 해결 센터(심사 메시지)에서 반려 이유를 확인해 주세요. 재제출은 appstore-submit 워크플로로 합니다.' },
  METADATA_REJECTED: { label: '정보 반려', mail: true, body: '설명·스크린샷 등 등록 정보가 반려됐습니다. App Store Connect 해결 센터를 확인해 주세요.' },
  INVALID_BINARY: { label: '빌드 반려', mail: true, body: '올린 빌드가 거절됐습니다. App Store Connect 를 확인해 주세요.' },
  PENDING_DEVELOPER_RELEASE: { label: '심사 통과(출시 대기)', mail: true, body: '심사를 통과했습니다. App Store Connect 에서 [출시]를 누르면 올라갑니다.' },
  PENDING_APPLE_RELEASE: { label: '심사 통과(애플 출시 대기)', mail: true, body: '심사를 통과했고 애플이 곧 출시합니다.' },
  READY_FOR_SALE: { label: '출시됨', mail: true, body: 'App Store 에 올라갔습니다. 앱 받기 단추는 1시간 안에 자동으로 켜집니다.' },
  READY_FOR_DISTRIBUTION: { label: '출시됨', mail: true, body: 'App Store 에 올라갔습니다. 앱 받기 단추는 1시간 안에 자동으로 켜집니다.' },
  DEVELOPER_REJECTED: { label: '제출 취소', mail: false, body: '심사 제출을 거뒀습니다.' },
  PREPARE_FOR_SUBMISSION: null, READY_FOR_REVIEW: null, PROCESSING_FOR_DISTRIBUTION: null,
};
export const reviewInput = z.object({ version: z.string().trim().min(1).max(20), state: z.string().trim().min(2).max(40).regex(/^[A-Z_]+$/), live: z.array(z.string().max(20)).max(20).optional() });

/** GitHub Actions 가 보낸 심사 상태 기록 — 같은 버전·상태면 아무것도 안 함, 바뀌면 운영자 알림(반려·통과·출시는 메일도) */
export async function recordReviewState(i: z.infer<typeof reviewInput>, sql: Sql = db()) {
  const prev = await setting<{ version: string; state: string }>(sql, 'appstore_review');
  const changed = !prev || prev.version !== i.version || prev.state !== i.state;
  await save(sql, 'appstore_review', { version: i.version, state: i.state, live: i.live ?? [], at: new Date().toISOString() });
  if (!changed) return { changed: false };
  const s = STATE[i.state];
  if (!s) return { changed: true, notified: 0 };
  const notified = await tellOps(sql, `아이폰 앱 ${i.version} ${s.label}`, s.body, `asc:${i.version}:${i.state}`, s.mail);
  return { changed: true, notified };
}
