import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { audit } from '@/lib/log';
import { DEFAULT_ENDPOINTS } from '@/lib/sales/collectors/endpoints';
import { SIDO, saveSupportKeys, supportKeyStatus } from '@/lib/sales/collectors/support';

/** 로컬 10/21 10:40: 플랫폼 운영자가 DB 없이 협력사 감시 페이지(21곳)·기관 엔드포인트(LH·국방·온비드)를 넣는다 — app_settings 'sales_vendor_watch_pages'·'sales_collector_endpoints' */
const read = async () => {
  const rows = await db()<{ key: string; value: unknown; updated_at: string }[]>`select key, value, updated_at from app_settings where key in ('sales_vendor_watch_pages', 'sales_collector_endpoints', 'support_watch_pages')`;
  const pages = rows.find((r) => r.key === 'sales_vendor_watch_pages'); const ep = rows.find((r) => r.key === 'sales_collector_endpoints'); const sp = rows.find((r) => r.key === 'support_watch_pages');
  return { vendorPages: Array.isArray(pages?.value) ? pages!.value as { company: string; url: string; register_url?: string | null }[] : [], vendorPagesUpdatedAt: pages?.updated_at ?? null,
    endpoints: { ...DEFAULT_ENDPOINTS, ...((ep?.value as Record<string, string>) ?? {}) }, endpointOverrides: (ep?.value as Record<string, string>) ?? {}, defaultEndpoints: DEFAULT_ENDPOINTS,
    // #450 지원사업 원천 — 인증키는 있는지·어디서·앞 4자만(값은 절대 안 내보냄), 감시 페이지(지자체·RIPC·진흥원 공지)
    supportKeys: await supportKeyStatus(), supportWatchPages: Array.isArray(sp?.value) ? sp!.value as { name: string; url: string; region?: string | null }[] : [], supportWatchPagesUpdatedAt: sp?.updated_at ?? null };
};
export const GET = handler(async ({ user }) => { if (!user.platformAdmin) throw notFound(); return read(); });
const input = z.object({
  vendorPages: z.array(z.object({ company: z.string().trim().min(1).max(60), url: z.string().trim().url().regex(/^https?:\/\//), registerUrl: z.string().trim().url().regex(/^https?:\/\//).nullable().optional() })).max(100).optional(),
  endpoints: z.record(z.enum(Object.keys(DEFAULT_ENDPOINTS) as [string, ...string[]]), z.string().trim().url().startsWith('https://').or(z.literal(''))).optional(),
  supportKeys: z.object({ bizinfo: z.string().trim().max(200).nullable().optional(), datago: z.string().trim().max(400).nullable().optional() }).optional(), // '' 또는 null = 지움(환경 변수로)
  supportWatchPages: z.array(z.object({ name: z.string().trim().min(1).max(60), url: z.string().trim().url().regex(/^https?:\/\//), region: z.string().trim().max(10).nullable().optional() })).max(100).optional(),
});
export const PUT = handler(async ({ req, user }) => {
  if (!user.platformAdmin) throw notFound();
  const i = await body(req, input); const sql = db();
  if (i.vendorPages) { const seen = new Set<string>(); const pages = i.vendorPages.filter((p) => { if (seen.has(p.url)) return false; seen.add(p.url); return true; }).map((p) => ({ company: p.company, url: p.url, register_url: p.registerUrl ?? null }));
    await sql`insert into app_settings (key, value, updated_by) values ('sales_vendor_watch_pages', ${sql.json(pages as never)}, ${user.id}) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`; }
  if (i.endpoints) { const ov = Object.fromEntries(Object.entries(i.endpoints).filter(([k, v]) => v && v !== DEFAULT_ENDPOINTS[k])); // 비우거나 기본값과 같으면 덮어쓰기 제거
    await sql`insert into app_settings (key, value, updated_by) values ('sales_collector_endpoints', ${sql.json(ov as never)}, ${user.id}) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`; }
  if (i.supportKeys) await saveSupportKeys({ bizinfo: i.supportKeys.bizinfo, datago: i.supportKeys.datago }, user.id);
  if (i.supportWatchPages) { const seen = new Set<string>(); const pages = i.supportWatchPages.filter((p) => { if (seen.has(p.url)) return false; seen.add(p.url); return true; }).map((p) => ({ name: p.name, url: p.url, region: p.region && SIDO.includes(p.region) ? p.region : null }));
    await sql`insert into app_settings (key, value, updated_by) values ('support_watch_pages', ${sql.json(pages as never)}, ${user.id}) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`; }
  await audit(sql, user.id, 'platform.sales_collectors.settings', 'app_settings', null, { vendorPages: i.vendorPages?.length, endpoints: i.endpoints ? Object.keys(i.endpoints) : undefined,
    supportKeys: i.supportKeys ? Object.entries(i.supportKeys).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}:${v ? 'set' : 'clear'}`) : undefined, supportWatchPages: i.supportWatchPages?.length }).catch(() => {});
  return read();
});
