/**
 * V41 단계 2 준비: 영업관리(Supabase) 원본 읽기 키 — 새 형식(sb_secret_…)과 옛 service_role JWT(eyJ…) 둘 다 받음.
 * - 새 비밀키: `apikey` 헤더에만(게이트웨이가 바꿔 줌, Authorization 에 넣으면 거절됨).
 * - 옛 JWT: `apikey` + `Authorization: Bearer`.
 * - Publishable(sb_publishable_…)·anon 은 행 단위 보안에 막혀 이관에 못 씀 → 'publishable' 로 알려 줌.
 * env: SALES_SRC_URL(https://<프로젝트>.supabase.co), SALES_SRC_SERVICE_KEY. 값은 화면·기록에 남기지 않는다.
 */
export type SrcKeyKind = 'secret' | 'legacy_jwt' | 'publishable' | 'invalid' | 'missing';
export function srcKeyKind(key = process.env.SALES_SRC_SERVICE_KEY): SrcKeyKind {
  if (!key) return 'missing';
  const k = key.trim();
  if (/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(k)) return 'secret';
  if (/^sb_publishable_/.test(k)) return 'publishable';
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(k)) {
    try { const role = JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString('utf8'))?.role; return role === 'service_role' ? 'legacy_jwt' : 'publishable'; } catch { return 'invalid'; }
  }
  return 'invalid';
}
export function srcHeaders(key = process.env.SALES_SRC_SERVICE_KEY): Record<string, string> {
  const kind = srcKeyKind(key);
  if (kind === 'secret') return { apikey: key!.trim() };
  if (kind === 'legacy_jwt') return { apikey: key!.trim(), authorization: `Bearer ${key!.trim()}` };
  throw new Error(kind === 'missing' ? 'SALES_SRC_SERVICE_KEY 가 없습니다' : kind === 'publishable' ? 'Publishable/anon 키로는 이관할 수 없습니다 — Secret key(sb_secret_…)를 넣어 주세요' : 'SALES_SRC_SERVICE_KEY 형식을 알 수 없습니다');
}
export const srcConfigured = () => !!process.env.SALES_SRC_URL && ['secret', 'legacy_jwt'].includes(srcKeyKind());

/** PostgREST 읽기(GET) — 이관 작업이 씀. path 예: '/rest/v1/leads?select=*&limit=1000&offset=0' */
export async function srcGet(path: string) {
  const base = (process.env.SALES_SRC_URL ?? '').replace(/\/$/, '');
  if (!base.startsWith('https://') && !process.env.SALES_SRC_TEST) throw new Error('SALES_SRC_URL 이 없습니다');
  const r = await fetch(`${base}${path}`, { headers: { ...srcHeaders(), accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`영업관리 원본 읽기 오류 ${r.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

/** 건수만(본문 없이): Prefer count=exact + Range 0-0 → Content-Range "0-0/21" */
export async function srcCount(table: string, filter = '') {
  const base = (process.env.SALES_SRC_URL ?? '').replace(/\/$/, '');
  const r = await fetch(`${base}/rest/v1/${encodeURIComponent(table)}?select=*${filter ? `&${filter}` : ''}`, {
    headers: { ...srcHeaders(), prefer: 'count=exact', range: '0-0', 'range-unit': 'items' }, cache: 'no-store', signal: AbortSignal.timeout(30000) });
  await r.text().catch(() => '');
  if (!r.ok && r.status !== 206 && r.status !== 416) throw new Error(`${table} 건수 읽기 오류 ${r.status}`);
  const total = (r.headers.get('content-range') ?? '').split('/')[1];
  return total && total !== '*' ? Number(total) : null;
}
