import type { Sql } from './db';
import { db } from './db';

/**
 * D-01·D-05(대표 11/23 '추천대로'): 휴지통 기록 — 지점 보고·점검 회차 지우기, 계약 완전 삭제 때 지우기 전 줄을 JSON 으로 30일 남긴다.
 * 화면에서 되살리는 기능은 아직 없음(필요하면 이 기록으로 되살림). 개인정보가 든 근거 글도 들어갈 수 있어 30일 뒤 정기 실행이 비운다.
 */
export type TrashKind = 'branch_report' | 'check_round' | 'agreement';
export async function putTrash(sql: Sql, i: { tenant: string; kind: TrashKind; refId: string; title: string | null; data: unknown; by: string | null }) {
  await sql`insert into trash_records (tenant, kind, ref_id, title, data, deleted_by) values (${i.tenant}, ${i.kind}, ${i.refId}, ${i.title}, ${sql.json(i.data as never)}, ${i.by})`;
}
/** 정기 실행: 30일 지난 휴지통 기록 비우기 */
export async function trashTick(sql: Sql = db()) {
  const r = await sql`delete from trash_records where expires_at < now()`;
  return { purged: r.count };
}
