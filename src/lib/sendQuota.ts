/**
 * 상용화 B5(대표 위임 11/24, docs/handoff/COMMERCIAL_AUDIT_2026-11-24.md): 회사별 하루 발송 상한.
 * - 회사 행동으로 워크인 비용으로 나가는 것만 센다: 직원 초대 메일 · 전자계약 서명 요청/완료 메일 · 영업 아침 메일(Resend 로 보낼 때) · 카카오 알림톡.
 * - 가입 확인·비밀번호 재설정·결제 영수증 등 시스템 메일, 회사가 연결한 자기 메일 계정(SMTP)으로 보내는 메일은 세지 않는다.
 * - 우리 회사(default)·앱 심사용 demo 는 상한 없음. 상한 = SEND_CAP_MAIL(기본 300통)·SEND_CAP_ALIMTALK(기본 30건), 서울 날짜 기준.
 * - 넘으면 보내지 않고 false — 부르는 쪽은 '보내지 못함'으로 처리(초대 링크·서명 링크는 화면에서 직접 전달 가능). 처음 넘은 날 감사 기록 + 플랫폼 운영자 알림 1번.
 */
import { DateTime } from 'luxon';
import { db, type Sql } from './db';

export type SendChannel = 'mail' | 'alimtalk';
const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };
export const sendCap = (ch: SendChannel) => (ch === 'mail' ? num(process.env.SEND_CAP_MAIL, 300) : num(process.env.SEND_CAP_ALIMTALK, 30));
const LABEL: Record<SendChannel, string> = { mail: '메일', alimtalk: '알림톡' };
export const capMessage = (ch: SendChannel) => `오늘 회사 ${LABEL[ch]} 발송 한도(${sendCap(ch).toLocaleString('ko-KR')}${ch === 'mail' ? '통' : '건'})를 넘어 보내지 않았습니다 — 내일 다시 보내거나 링크를 직접 전달해 주세요`;

/** n 건을 보내도 되면 true(세어 둠) · 넘으면 false. DB 오류면 막지 않음(발송이 상한 기능 때문에 멈추지 않게) */
export async function takeSendQuota(tenant: string | null | undefined, ch: SendChannel, n = 1, sql: Sql = db()): Promise<boolean> {
  if (!tenant || tenant === 'default' || tenant === 'demo' || n <= 0) return true;
  const day = DateTime.now().setZone('Asia/Seoul').toISODate()!;
  const cap = sendCap(ch);
  const r = await sql<{ n: number }[]>`insert into send_quota (tenant, day, channel, n) values (${tenant}, ${day}, ${ch}, ${n})
    on conflict (tenant, day, channel) do update set n = send_quota.n + excluded.n returning n`.catch(() => null);
  if (!r?.[0]) return true;
  const total = r[0].n;
  if (total <= cap) return true;
  if (total - n <= cap) { // 오늘 처음 넘음 — 기록·운영자 알림 한 번
    await (await import('./log')).audit(sql, null, 'send.daily_cap', 'tenant', tenant, { tenant, channel: ch, cap, day }).catch(() => {});
    const ids = await (await import('./superAdmin')).platformAdminIds(sql).catch(() => [] as string[]);
    const [t] = await sql<{ name: string }[]>`select name from tenants where id = ${tenant}`.catch(() => [] as { name: string }[]);
    if (ids.length) await (await import('./notifications')).notify(sql, { userIds: ids, type: 'usage_alert', title: `하루 ${LABEL[ch]} 발송 한도 도달 — ${t?.name ?? tenant}`,
      body: `오늘 ${cap.toLocaleString('ko-KR')}${ch === 'mail' ? '통' : '건'}을 넘어 이후 발송은 막았습니다. 정상 사용이면 상한(SEND_CAP_${ch === 'mail' ? 'MAIL' : 'ALIMTALK'})을 올려 주세요.`,
      link: `/platform?tenant=${encodeURIComponent(tenant)}`, dedupeKey: `send-cap:${tenant}:${ch}:${day}` }).catch(() => {});
  }
  return false;
}
