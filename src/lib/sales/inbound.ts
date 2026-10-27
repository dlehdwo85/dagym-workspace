import type { Sql } from '../db';
import { normPhone } from '../phone';

/**
 * 대표 10/27 ③ '다짐·하이링크 문의도 후속 작업이 필요함 — 영업 쪽 건만 걸려 있음':
 * 웹사이트·대표번호 전화 문의(inquiries.ts)와 마케팅 '전화 문의' [영업 리드로](marketing.ts convertCall)도 영업 진행(리드)에 올리고,
 * 그 업무를 리드에 잇는다(lead_id·sales_ref) → 업무를 [완료]하면 '다음 연락일 / 종결'을 묻고 다음 연락 업무로 이어진다(#460, 메타 리드 광고와 같은 길).
 * 영업 공간을 켠 회사만. 같은 전화번호(숫자만, +82 → 0)의 리드가 있으면 새로 만들지 않고 그 리드에 상담 기록 한 줄 + 다음 연락일을 당김.
 */
export type InboundLead = { tenant: string; name: string; contactName?: string | null; phone?: string | null; email?: string | null; region?: string | null;
  ownerId: string; nextDate: string; memo: string; src: Record<string, unknown>; taskIds: string[]; reason: string; actorId?: string | null };
export async function attachInboundLead(sql: Sql, i: InboundLead): Promise<{ leadId: string; created: boolean } | null> {
  const [t] = await sql<{ on: boolean }[]>`select 'sales' = any(spaces) as on from tenants where id = ${i.tenant}`;
  if (!t?.on) return null;
  const digits = normPhone(i.phone) ?? '';
  const [dup] = digits.length >= 9 ? await sql<{ id: string; name: string }[]>`select id, name from sales_leads where tenant = ${i.tenant} and deleted_at is null
    and regexp_replace(regexp_replace(coalesce(phone, ''), '^\\s*\\+82', '0'), '\\D', '', 'g') = ${digits} order by updated_at desc limit 1` : [];
  let leadId: string; let name = i.name.slice(0, 300);
  if (dup) {
    leadId = dup.id; name = dup.name;
    await sql`insert into sales_lead_records (tenant, kind, lead_id, occurred_at, data) values (${i.tenant}, 'sales_activities', ${leadId}, now(),
      ${sql.json({ activity_type: '기타', content: `${i.reason} — ${i.memo}`.slice(0, 5000), activity_date: i.nextDate, source: String(i.src.from ?? 'inbound'), created_by: i.actorId ?? null, created_by_name: '문의 접수(자동)' })})`;
    await sql`update sales_leads set next_contact_date = least(coalesce(next_contact_date, ${i.nextDate}::date), ${i.nextDate}::date), updated_at = now() where id = ${leadId}`;
  } else {
    const [r] = await sql<{ id: string }[]>`insert into sales_leads (tenant, name, status, region, owner_id, next_contact_date, contact_name, phone, email, memo, src)
      values (${i.tenant}, ${name}, '신규리드', ${i.region || null}, ${i.ownerId}, ${i.nextDate}, ${i.contactName || null}, ${i.phone || null}, ${i.email || null}, ${i.memo.slice(0, 5000)}, ${sql.json({ ...i.src, taskIds: i.taskIds } as never)}) returning id`;
    leadId = r.id;
    await sql`insert into sales_status_log (tenant, lead_id, from_status, to_status, reason, changed_by) values (${i.tenant}, ${leadId}, null, '신규리드', ${i.reason}, ${i.actorId ?? null})`;
  }
  if (i.taskIds.length) await sql`update tasks set lead_id = ${leadId}, sales_ref = coalesce(sales_ref, ${sql.json({ kind: 'lead', id: leadId, name })}) where id = any(${i.taskIds}::uuid[])`;
  return { leadId, created: !dup };
}
