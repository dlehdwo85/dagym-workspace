import { z } from 'zod';
import { db, type Sql } from './db';
import { audit } from './log';
import { notFound } from './errors';
import { requireMenu } from './menuPerms';
import { tenantOf, type SessionUser } from './types';

/**
 * V22·V19·V21 회사 정보·디자인 기준(조직 설정). 견적서 공급자 칸·문서 로고·브랜드 색은 여기서 읽는다 — 코드·저장소에 회사 정보를 쓰지 않는다.
 * 보기: 운영 메뉴 조회 / 고치기: 운영 메뉴 편집 (기본 대표·본사 관리자)
 */
export const profileInput = z.object({
  key: z.string().regex(/^[a-z0-9_-]{2,30}$/, '영문 소문자·숫자 2~30자 (예: dagym)'),
  name: z.string().trim().min(1).max(100),
  ceo: z.string().trim().max(50).nullable().optional(), bizNo: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(200).nullable().optional(), phone: z.string().trim().max(40).nullable().optional(), fax: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(120).nullable().optional(), website: z.string().trim().max(200).nullable().optional(), bank: z.string().trim().max(120).nullable().optional(),
  logoFileId: z.string().uuid().nullable().optional(), brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  font: z.string().trim().max(60).nullable().optional(), note: z.string().trim().max(1000).nullable().optional(), isDefault: z.boolean().optional(),
});
export type CompanyProfile = { id: string; key: string; name: string; ceo: string | null; biz_no: string | null; address: string | null; phone: string | null; fax: string | null; email: string | null;
  website: string | null; bank: string | null; logo_file_id: string | null; brand_color: string | null; font: string | null; note: string | null; is_default: boolean };

export async function companyProfiles(tenant: string, sql: Sql = db()) {
  return sql<CompanyProfile[]>`select id, key, name, ceo, biz_no, address, phone, fax, email, website, bank, logo_file_id, brand_color, font, note, is_default
    from company_profiles where tenant = ${tenant} order by is_default desc, key`;
}
export async function listProfiles(u: SessionUser) {
  await requireMenu(u, 'ops', 'view');
  return { profiles: await companyProfiles(tenantOf(u)) };
}
export async function saveProfile(u: SessionUser, i: z.infer<typeof profileInput>, ip: string | null) {
  await requireMenu(u, 'ops', 'edit');
  const sql = db(); const t = tenantOf(u);
  if (i.logoFileId) {
    const [f] = await sql`select 1 from library_files where id = ${i.logoFileId} and tenant = ${t} and deleted_at is null`;
    if (!f) throw notFound('로고 파일이 없습니다');
  }
  const r = await sql.begin(async (tx) => {
    if (i.isDefault) await tx`update company_profiles set is_default = false where tenant = ${t}`;
    const [row] = await tx<{ id: string }[]>`insert into company_profiles (tenant, key, name, ceo, biz_no, address, phone, fax, email, website, bank, logo_file_id, brand_color, font, note, is_default, updated_by)
      values (${t}, ${i.key}, ${i.name}, ${i.ceo ?? null}, ${i.bizNo ?? null}, ${i.address ?? null}, ${i.phone ?? null}, ${i.fax ?? null}, ${i.email ?? null}, ${i.website ?? null}, ${i.bank ?? null},
        ${i.logoFileId ?? null}, ${i.brandColor ?? null}, ${i.font ?? null}, ${i.note ?? null}, ${!!i.isDefault}, ${u.id})
      on conflict (tenant, key) do update set name = excluded.name, ceo = excluded.ceo, biz_no = excluded.biz_no, address = excluded.address, phone = excluded.phone, fax = excluded.fax,
        email = excluded.email, website = excluded.website, bank = excluded.bank, logo_file_id = excluded.logo_file_id, brand_color = excluded.brand_color, font = excluded.font,
        note = excluded.note, is_default = excluded.is_default or company_profiles.is_default and ${i.isDefault === undefined}, updated_by = excluded.updated_by, updated_at = now()
      returning id`;
    return row;
  });
  await audit(sql, u.id, 'company_profile.save', null, null, { key: i.key }, ip);
  return { id: r.id };
}
export async function deleteProfile(u: SessionUser, key: string, ip: string | null) {
  await requireMenu(u, 'ops', 'edit');
  const sql = db();
  const gone = await sql`delete from company_profiles where tenant = ${tenantOf(u)} and key = ${key} returning id`;
  if (!gone.length) throw notFound();
  await audit(sql, u.id, 'company_profile.delete', null, null, { key }, ip);
  return { ok: true };
}

/** AI 프롬프트에 넣는 회사 정보(데이터) — 빈 칸은 빼고, 다른 회사 정보와 섞지 말라는 표시를 붙인다 */
export function profileText(p: CompanyProfile) {
  const rows: [string, string | null][] = [['상호', p.name], ['대표자', p.ceo], ['사업자등록번호', p.biz_no], ['주소', p.address], ['전화', p.phone], ['팩스', p.fax], ['이메일', p.email],
    ['홈페이지', p.website], ['입금 계좌', p.bank], ['브랜드 색', p.brand_color], ['글꼴', p.font], ['디자인 메모', p.note]];
  return `[회사: ${p.key}]\n` + rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
}
