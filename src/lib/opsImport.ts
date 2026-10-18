import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';

/**
 * V41 4-2 마케팅 운영실(KV) → 워크인 이관 (사양: docs/handoff/WORKIN_V41_KV_IMPORT_SPEC.md).
 * - 서버 간 전용: OPS_EXPORT_URL + OPS_EXPORT_TOKEN, 요청마다 X-Export-Ts/X-Export-Sig = hex(HMAC-SHA256(token, "<ts>\n<경로+쿼리>")).
 * - 미리보기 = manifest + 키별 전체 페이지를 받아 건수·해시 대조만(저장 없음). 적용 = 같은 대조 후 키별 원본을 회사에 저장(같은 키는 통째로 바꿈 → 여러 번 해도 같음).
 * - 해시: 키 전체 값(list 는 배열, object 는 객체)을 JSON.stringify 한 UTF-8 의 SHA-256(string 은 문자열 그대로). 운영실 계산과 다르면 '해시 다름'으로 보이고 적용은 막힘.
 * - 플랫폼 운영자만 실행(회사 지정). 회사 안 조회는 마케팅 공간 관리자만, 전화 기록은 보관 기간(OPS_CALL_RETENTION_DAYS, 기본 365일) 뒤 삭제.
 */
export const OPS_KEYS = ['mkt:daily:decisions:v1', 'mkt:revisions:v1', 'mkt:requests:v1', 'mkt:posts:v1', 'mkt:schedule:v1', 'mkt:production:v1', 'mkt:media-outputs:v1', 'mkt:media-approval:v1', 'mkt:media:v1',
  'mkt:ads:structure-decision:v1', 'mkt:ads:apply-log:v1', 'mkt:call-records:v1', 'mkt:call-clicks:v1', 'mkt:library:v1', 'mkt:owner:actions:done:v1', 'mkt:plan-state:v1', 'mkt:plan:active:v1', 'mkt:approvals:dynamic:v1'] as const;
export const PII_KEYS = new Set(['mkt:call-records:v1']);
const configured = () => !!(process.env.OPS_EXPORT_URL && process.env.OPS_EXPORT_TOKEN);

async function signed(pathQuery: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', process.env.OPS_EXPORT_TOKEN!).update(`${ts}\n${pathQuery}`).digest('hex');
  const r = await fetch(`${process.env.OPS_EXPORT_URL!.replace(/\/$/, '')}${pathQuery}`, { headers: { 'X-Export-Ts': ts, 'X-Export-Sig': sig }, cache: 'no-store', signal: AbortSignal.timeout(30000) });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* JSON 아님 */ }
  if (!r.ok || !j?.ok) throw new HttpError(502, 'ops_export', `운영실 내보내기 오류 ${r.status}: ${String(j?.error ?? j?.message ?? text).slice(0, 160)}`);
  return j;
}
const sha = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

type KeyResult = { key: string; kind: string; expectedCount: number; expectedSha: string; count: number; sha: string; pageSha: boolean; countOk: boolean; shaOk: boolean; sample?: string[] };
async function fetchKey(key: string, m: { kind: string; count: number; sha256: string }) {
  let value: any = null; let cursor: number | null = 0; let pageSha = true;
  for (let page = 0; cursor !== null && page < 400; page++) {
    const r: any = await signed(`/api/marketing/export?key=${encodeURIComponent(key)}&cursor=${cursor}`);
    if (r.sha256 && r.sha256 !== m.sha256) pageSha = false;
    if (r.kind === 'list') value = [...(value ?? []), ...(r.items ?? [])];
    else value = r.items ?? r.value ?? null;
    cursor = r.kind === 'list' && r.next != null ? Number(r.next) : null;
  }
  const count = Array.isArray(value) ? value.length : value == null ? 0 : 1;
  const got = sha(value ?? (m.kind === 'list' ? [] : null));
  // 미리보기 표본: 칸 이름만(값 없이) — 실제 매핑을 정하려고. 개인정보 키도 칸 이름만.
  const first = Array.isArray(value) ? value[0] : value;
  const sample = first && typeof first === 'object' ? Object.keys(first).slice(0, 30) : undefined;
  const res: KeyResult = { key, kind: m.kind, expectedCount: m.count, expectedSha: m.sha256, count, sha: got, pageSha, countOk: count === m.count, shaOk: got === m.sha256, sample };
  return { res, value };
}

export const runInput = z.object({ tenant: z.string().trim().min(1).max(60), mode: z.enum(['preview', 'apply']), keys: z.array(z.enum(OPS_KEYS)).min(1).optional() });
export async function runOpsImport(u: SessionUser, i: z.infer<typeof runInput>) {
  if (!u.platformAdmin || u.support) throw notFound();
  if (!configured()) throw new HttpError(409, 'ops_not_configured', 'OPS_EXPORT_URL·OPS_EXPORT_TOKEN 이 설정되지 않았습니다');
  const sql = db();
  const [t] = await sql`select id from tenants where id = ${i.tenant}`;
  if (!t) throw badRequest('그런 회사가 없습니다');
  const [run] = await sql<{ id: string }[]>`insert into ops_import_runs (tenant, mode, started_by) values (${i.tenant}, ${i.mode}, ${u.id}) returning id`;
  try {
    const man: any = await signed('/api/marketing/export/manifest');
    const want = new Set(i.keys ?? OPS_KEYS);
    const listed = new Map<string, any>((man.keys ?? []).map((k: any) => [k.key, k]));
    const results: (KeyResult | { key: string; missing: true })[] = [];
    const values = new Map<string, unknown>();
    for (const key of OPS_KEYS.filter((k) => want.has(k))) {
      const m = listed.get(key);
      if (!m) { results.push({ key, missing: true }); continue; }
      const { res, value } = await fetchKey(key, m);
      results.push(res); values.set(key, value);
    }
    const allOk = results.every((r) => 'missing' in r || (r.countOk && r.shaOk));
    if (i.mode === 'apply' && allOk) {
      await sql.begin(async (tx) => {
        for (const [key, value] of values) {
          const items = Array.isArray(value) ? value : value == null ? [] : [value];
          await tx`delete from ops_import_items where tenant = ${i.tenant} and key = ${key}`;
          for (let n = 0; n < items.length; n += 200) {
            const chunk = items.slice(n, n + 200).map((it, k) => ({ tenant: i.tenant, key, idx: n + k, item: tx.json(it as never), run_id: run.id }));
            await tx`insert into ops_import_items ${tx(chunk as never)}`;
          }
        }
      });
    }
    const status = allOk ? 'ok' : 'mismatch';
    await sql`update ops_import_runs set status = ${status}, frozen = ${!!man.frozen}, generated_at = ${man.generatedAt ?? null}, results = ${sql.json(results as never)}, finished_at = now() where id = ${run.id}`;
    await audit(sql, u.id, `ops_import.${i.mode}`, 'tenant', null, { tenant: i.tenant, status, keys: results.length }).catch(() => {});
    return { runId: run.id, status, applied: i.mode === 'apply' && allOk, frozen: !!man.frozen, generatedAt: man.generatedAt ?? null, results };
  } catch (e: any) {
    await sql`update ops_import_runs set status = 'error', error = ${String(e?.message ?? e).slice(0, 300)}, finished_at = now() where id = ${run.id}`;
    throw e;
  }
}

export async function opsImportStatus(u: SessionUser) {
  if (!u.platformAdmin || u.support) throw notFound();
  const sql = db();
  const runs = await sql`select r.id, r.tenant, r.mode, r.status, r.frozen, r.generated_at, r.results, r.error, r.created_at, r.finished_at, u.name as started_by_name
    from ops_import_runs r left join users u on u.id = r.started_by order by r.created_at desc limit 10`;
  const stored = await sql`select tenant, key, count(*)::int as count, max(imported_at) as imported_at from ops_import_items group by tenant, key order by tenant, key`;
  return { configured: configured(), keys: OPS_KEYS, runs, stored };
}

/** 회사 안 조회(마케팅 공간 관리자만): 키별 건수, 키 하나의 원본(페이지) */
export async function importedData(u: SessionUser, q: { key?: string; offset?: number }) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('가져온 운영실 데이터는 관리자만 볼 수 있습니다');
  const sql = db(); const t = tenantOf(u);
  if (!q.key) return { keys: await sql`select key, count(*)::int as count, max(imported_at) as imported_at from ops_import_items where tenant = ${t} group by key order by key` };
  if (!(OPS_KEYS as readonly string[]).includes(q.key)) throw notFound();
  const offset = Math.max(0, Math.floor(q.offset ?? 0));
  const items = await sql`select idx, item from ops_import_items where tenant = ${t} and key = ${q.key} order by idx offset ${offset} limit 50`;
  if (PII_KEYS.has(q.key)) await audit(sql, u.id, 'ops_import.view_pii', 'tenant', null, { key: q.key, offset }).catch(() => {});
  return { key: q.key, items };
}

/** tick: 전화 기록(개인정보) 보관 기간 지나면 삭제 */
export async function purgeOpsPii() {
  const days = Math.max(30, Number(process.env.OPS_CALL_RETENTION_DAYS) || 365);
  const r = await db()`delete from ops_import_items where key = any(${[...PII_KEYS]}) and imported_at < now() - make_interval(days => ${days})`;
  return { purged: r.count, days };
}
