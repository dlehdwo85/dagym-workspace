import { db, type Sql } from './db';

/**
 * #565 대표 10/24: 플랫폼 운영은 슈퍼관리자만 — 운영 설정 SUPER_ADMIN_EMAILS(쉼표로 여러 개)에 적힌 계정이면서 platform_admin 인 사람.
 * 공개 저장소라 이메일은 코드에 쓰지 않는다. 설정이 비어 있으면 예전처럼 platform_admin 인 사람 모두(설정 전에 아무도 못 들어가는 일 방지)
 */
export function superAdmin(email: string, flag: boolean) {
  if (!flag) return false;
  const list = (process.env.SUPER_ADMIN_EMAILS ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  return !list.length || list.includes(email.trim().toLowerCase());
}

/** 로컬 10/25 10:45(142차 후속): 플랫폼 운영자에게 가는 알림(서버 오류·AI 크레딧·AI 비용 예상·문의·요금제 변경 요청·수집 누락)도 슈퍼관리자에게만 */
export async function platformAdminIds(sql: Sql = db()) {
  return (await sql<{ id: string; email: string }[]>`select id, email from users where platform_admin and status = 'active'`).filter((r) => superAdmin(r.email, true)).map((r) => r.id);
}
