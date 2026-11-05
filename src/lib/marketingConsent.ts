import { z } from 'zod';
import { db, type Sql } from './db';
import { audit } from './log';
import type { SessionUser } from './types';

/**
 * 360차(대표 #976): 광고성 정보 수신 동의 — 정보통신망법 제50조
 * - 가입 화면 '새 기능·혜택 소식 받기'(consents.kind = 'marketing')가 광고성 정보 수신 동의다(처음엔 꺼짐, [전체 동의]를 누르면 함께 켜짐).
 * - ⑦항: 동의·거부(철회) 처리 결과를 14일 안에 알림 → 워크인은 처리한 순간 메일 1통(전송자·일시·결과·바꾸는 방법).
 * - ⑧항·시행령 62조의3: 동의한 날부터 2년마다 동의 여부를 다시 확인 → 2년 되기 30일 전에 안내 메일(전송자·동의 날짜와 사실·유지/철회 방법).
 *   안내에 답하지 않으면 동의는 그대로(법이 요구하는 것은 '확인 안내'). 메일이 실패하면 다음 날 다시.
 * - 14일 안 보장: 동의한 지 14일이 안 된 사람 중 처리 결과 메일이 안 나간 사람(360차 배포 전에 동의한 사람·메일 실패)은 정기 실행이 보냄(하루 한 번 다시).
 *   가입 때 '받지 않음'은 거부 요청이 아니라서 보내지 않는다 — 거부 안내는 설정에서 끈 사람이 메일 실패했을 때만 다시.
 * - 바꾸는 곳: 설정 › '새 기능·혜택 소식(광고성 정보) 받기' — 직원(초대받은 사람)도 켜고 끌 수 있다.
 */
export const MARKETING_LABEL = '새 기능·혜택 소식(광고성 정보) 받기';
const sender = () => process.env.COMPANY_NAME ? `${process.env.COMPANY_NAME}(워크인)` : '워크인';
const kst = (d: Date) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
const kday = (d: Date) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' }).format(d);

async function mail(to: string, title: string, lines: string[]) {
  const { sendMail, appUrl } = await import('./mail');
  const url = `${appUrl()}/settings#marketing-consent`;
  const text = [title, '', ...lines, '', `바꾸기: ${url}`].join('\n');
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const html = `<!doctype html><html lang="ko"><body style="margin:0;padding:24px 12px;background:#f4f6fa;font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#111827">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px"><div style="font-size:13px;font-weight:700;color:#0f766e">워크인</div>
<div style="font-size:18px;font-weight:700;margin:8px 0 12px">${esc(title)}</div><div style="font-size:15px;line-height:1.7;color:#374151">${lines.map(esc).join('<br>')}</div>
<a href="${esc(url)}" style="display:block;margin-top:18px;background:#0f766e;color:#fff;text-decoration:none;text-align:center;font-weight:700;padding:14px;border-radius:10px">수신 동의 바꾸기</a></div></body></html>`;
  try { await sendMail(to, `[워크인] ${title}`, text, html); return true; }
  catch (e) { await (await import('./log')).logError('consent_notice', e).catch(() => {}); return false; }
}

/** ⑦항 처리 결과 알림(동의·철회한 바로 그때) */
export async function noticeResult(userId: string, agreed: boolean, at: Date = new Date(), sql: Sql = db()) {
  const [u] = await sql<{ email: string; name: string; status: string }[]>`select email, name, status from users where id = ${userId}`;
  if (!u || u.status === 'left') return false;
  const ok = await mail(u.email, '광고성 정보 수신 동의 처리 결과 안내', [
    `${u.name}님, 요청하신 광고성 정보 수신 ${agreed ? '동의' : '거부(동의 철회)'}를 처리했습니다.`,
    `전송자: ${sender()}`, `처리 일시: ${kst(at)}`, `처리 결과: ${agreed ? '수신 동의 — 새 기능·혜택 소식을 메일로 보내 드립니다' : '수신 거부 — 앞으로 광고성 정보를 보내지 않습니다'}`,
    `바꾸는 방법: 워크인 › 설정 › '${MARKETING_LABEL}'에서 언제든 켜고 끌 수 있습니다.`,
    '업무 알림·결제·보안 안내처럼 서비스 이용에 꼭 필요한 메일은 동의와 관계없이 보내 드립니다.']);
  await sql`insert into consent_notices (user_id, kind, reason, ok) values (${userId}, 'marketing', ${agreed ? 'result_agree' : 'result_withdraw'}, ${ok})`;
  return ok;
}

/** 지금 동의 상태(가장 최근 기록) */
export async function marketingState(userId: string, sql: Sql = db()) {
  const [c] = await sql<{ agreed: boolean; created_at: Date }[]>`select agreed, created_at from consents where user_id = ${userId} and kind = 'marketing' order by created_at desc limit 1`;
  const [n] = await sql<{ sent_at: Date }[]>`select sent_at from consent_notices where user_id = ${userId} and kind = 'marketing' and reason = 'reconfirm' and ok order by sent_at desc limit 1`;
  return { agreed: !!c?.agreed, at: c?.created_at ?? null, reconfirmedAt: n?.sent_at ?? null, label: MARKETING_LABEL };
}

export const marketingInput = z.object({ agreed: z.boolean() });
/** 설정에서 켜기·끄기 → 기록 바꿈 + 처리 결과 메일 */
export async function setMarketing(u: SessionUser, i: z.infer<typeof marketingInput>, ip: string | null) {
  const sql = db();
  const before = await marketingState(u.id, sql);
  if (before.agreed === i.agreed && before.at) return { ...before, changed: false };
  const { TERMS_VERSION } = await import('./signup');
  // consents 기본 키 = (사람·종류·약관 판) — 같은 판이면 덮어쓰고 시각을 새로(바뀐 내역은 감사 기록에)
  await sql`insert into consents (user_id, kind, version, agreed) values (${u.id}, 'marketing', ${TERMS_VERSION}, ${i.agreed})
    on conflict (user_id, kind, version) do update set agreed = excluded.agreed, created_at = now()`;
  await audit(sql, u.id, i.agreed ? 'consent.marketing_agree' : 'consent.marketing_withdraw', 'user', u.id, {}, ip);
  const mailed = await noticeResult(u.id, i.agreed, new Date(), sql);
  return { ...(await marketingState(u.id, sql)), changed: true, mailed };
}

/** ⑦항 14일 안 보장: 처리 결과 메일이 안 나간 최근 14일 동의(배포 전 동의·메일 실패) + 메일 실패한 설정 철회 → 다시(10분 지난 것만 — 바로 보내는 중과 겹치지 않게) */
async function resultCatchUp(sql: Sql, limit: number) {
  const due = await sql<{ id: string; agreed: boolean; at: Date }[]>`
    with cur as (select distinct on (c.user_id) c.user_id, c.agreed, c.created_at from consents c where c.kind = 'marketing' order by c.user_id, c.created_at desc)
    select u.id, cur.agreed, cur.created_at as at from cur join users u on u.id = cur.user_id
    where u.status = 'active' and u.deleted_at is null
      and cur.created_at > now() - interval '14 days' and cur.created_at < now() - interval '10 minutes'
      and not exists (select 1 from consent_notices n where n.user_id = u.id and n.kind = 'marketing' and n.ok and n.sent_at >= cur.created_at
        and n.reason = case when cur.agreed then 'result_agree' else 'result_withdraw' end)
      and (cur.agreed or exists (select 1 from consent_notices f where f.user_id = u.id and f.kind = 'marketing' and f.reason = 'result_withdraw' and not f.ok and f.sent_at >= cur.created_at))
      and not exists (select 1 from consent_notices f where f.user_id = u.id and f.kind = 'marketing' and f.reason like 'result_%' and not f.ok and f.sent_at > now() - interval '1 day')
    order by cur.created_at limit ${limit}`;
  let sent = 0;
  for (const u of due) if (await noticeResult(u.id, u.agreed, u.at, sql)) sent++;
  return { due: due.length, sent };
}

/** ⑧항 2년마다 확인: 동의(또는 지난 확인 안내)한 지 2년이 되기 30일 전 → 안내 메일. 실패한 사람은 하루 뒤 다시 */
export async function marketingReconfirmTick(sql: Sql = db(), limit = 100) {
  if (process.env.MARKETING_RECONFIRM === 'off') return { skipped: 'off' };
  const results = await resultCatchUp(sql, limit);
  const due = await sql<{ id: string; email: string; name: string; agreed_at: Date }[]>`
    with cur as (select distinct on (c.user_id) c.user_id, c.agreed, c.created_at from consents c where c.kind = 'marketing' order by c.user_id, c.created_at desc)
    select u.id, u.email, u.name, cur.created_at as agreed_at from cur join users u on u.id = cur.user_id
    where cur.agreed and u.status = 'active' and u.deleted_at is null
      and greatest(cur.created_at, coalesce((select max(n.sent_at) from consent_notices n where n.user_id = u.id and n.kind = 'marketing' and n.reason = 'reconfirm' and n.ok), cur.created_at))
          < now() - interval '2 years' + interval '30 days'
      and not exists (select 1 from consent_notices f where f.user_id = u.id and f.kind = 'marketing' and f.reason = 'reconfirm' and not f.ok and f.sent_at > now() - interval '1 day')
    order by cur.created_at limit ${limit}`;
  let sent = 0;
  for (const u of due) {
    const ok = await mail(u.email, '광고성 정보 수신 동의 확인 안내(2년마다)', [
      `${u.name}님, ${kday(u.agreed_at)}에 워크인의 새 기능·혜택 소식(광고성 정보) 받기에 동의하셨습니다.`,
      `전송자: ${sender()}`, '법에 따라 2년마다 수신 동의 여부를 다시 알려 드립니다.',
      '계속 받으시려면 아무것도 하지 않으셔도 됩니다.', `그만 받으시려면 워크인 › 설정 › '${MARKETING_LABEL}'을 끄시면 됩니다.`]);
    await sql`insert into consent_notices (user_id, kind, reason, ok) values (${u.id}, 'marketing', 'reconfirm', ${ok})`;
    if (ok) sent++;
  }
  return { due: due.length, sent, results };
}
