// 대표 10/20 14:15 영업: DB(입찰·신규단지·시설·협력사·리드)에서 TM 을 거쳐 '영업 진행'으로 바뀐 건을 업무·일정에 자동 리스트업.
// ① 진행 상태(연락중·신청 준비·전환, 리드 생성)로 바뀌면 담당자에게 업무 "[영업] 이름 — 다음 조치"(마감 = 다음 연락일/입찰 마감 D-1, 요청자 = 바꾼 사람, 원천 카드 링크)
// ② 업무는 업무 공간과 같은 표(space='sales', sales_ref·lead_id) → 업무 화면 '영업' 칩·원천 배지, 영업 홈 '오늘 할 일'과 같은 데이터
// ③ 보류 → 보류(on_hold), 미참여·대상아님·영업완료·등록 완료·실패 → 완료(done) 자동. 다음 연락일을 바꾸면 열린 업무의 마감도 따라감
// 일정은 따로 만들지 않는다 — 리드 다음 연락일·작업 중 입찰 마감은 이미 '영업 주요 일정'으로 홈·캘린더에 합성된다(srcViews agenda).
import type { Sql } from '../db';
import { HttpError, badRequest } from '../errors';
import type { SessionUser } from '../types';
import { tenantOf } from '../types';

export type SalesKind = 'bid' | 'building' | 'facility' | 'vendor' | 'lead';
/** #408 종류 이름은 회사 업종 템플릿에서 */
const kindLabels = async (tenant: string): Promise<Record<SalesKind, string>> => (await (await import('./options')).salesTerms(tenant)).kind;
/** 진행으로 치는 상태(업무 생성) / 멈춤(보류) / 끝(완료) */
const PROGRESS = new Set(['연락중', '신청 준비', '신청 완료', '검토중']);
const HOLD = new Set(['보류']);
const DONE = new Set(['미참여', '대상아님', '대상 아님', '영업완료', '등록 완료', '실패', '계약완료']);
const LINK: Record<SalesKind, (id: string) => string> = { bid: (id) => `/s/sales/hub?tab=bids&bt=working&bq=${encodeURIComponent(id)}`, building: () => '/s/sales/hub?tab=buildings', facility: () => '/s/sales/hub?tab=facilities', vendor: () => '/s/sales/hub?tab=vendors', lead: (id) => `/s/sales/leads?id=${id}` };
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const minusDays = (day: string, n: number) => ymd(new Date(Date.parse(`${day}T12:00:00+09:00`) - n * 864e5));

export type SyncInput = { kind: SalesKind; id: string; name: string; status: string | null; nextDate?: string | null; nextAction?: string | null; deadline?: string | null; assigneeId?: string | null; leadId?: string | null;
  /** 196차: 배정 알림 없이(정기 실행이 예전 리드에 업무를 채울 때) */ quiet?: boolean };
/** 열린(완료 아님) 자동 업무 찾기 */
async function openTask(sql: Sql, tenant: string, kind: SalesKind, id: string) {
  const [t] = await sql<{ id: string; status: string; due_date: string | null }[]>`select t.id, t.status, t.due_date::text from tasks t join users cu on cu.id = t.created_by
    where cu.tenant = ${tenant} and t.deleted_at is null and t.sales_ref->>'kind' = ${kind} and t.sales_ref->>'id' = ${id} and coalesce(t.sales_ref->>'manual', '') <> 'true' and t.status <> 'done' order by t.created_at desc limit 1`;
  return t ?? null;
}
/**
 * 상태·다음 연락일이 바뀔 때마다 부른다(saveWork·convertToLead·updateLead·createLead). 반환: 만든/바꾼 업무 id 와 한 일.
 * 만든 사람·요청자 = 바꾼 사람(u), 담당 = assigneeId(리드 담당) 없으면 u.
 */
export async function syncSalesTask(sql: Sql, u: SessionUser, i: SyncInput): Promise<{ taskId: string | null; action: 'created' | 'updated' | 'held' | 'done' | 'none' }> {
  const t = tenantOf(u);
  const cur = await openTask(sql, t, i.kind, i.id);
  const st = String(i.status ?? '');
  if (DONE.has(st)) {
    if (!cur) return { taskId: null, action: 'none' };
    await sql`update tasks set status = 'done', completed_at = now(), updated_at = now(), version = version + 1 where id = ${cur.id}`;
    return { taskId: cur.id, action: 'done' };
  }
  if (HOLD.has(st)) {
    if (!cur || cur.status === 'on_hold') return { taskId: cur?.id ?? null, action: 'none' };
    await sql`update tasks set status = 'on_hold', updated_at = now(), version = version + 1 where id = ${cur.id}`;
    return { taskId: cur.id, action: 'held' };
  }
  const progress = PROGRESS.has(st) || i.kind === 'lead';
  // 마감: 다음 연락일 > 입찰 마감 D-1 > (리드) 내일
  const due = i.nextDate ?? (i.deadline ? minusDays(i.deadline, 1) : i.kind === 'lead' ? ymd(new Date(Date.now() + 864e5)) : null);
  if (cur) {
    if (!progress) return { taskId: cur.id, action: 'none' };
    const back = cur.status === 'on_hold' ? sql`, status = 'todo'` : sql``;
    if ((due && due !== cur.due_date) || cur.status === 'on_hold') { await sql`update tasks set due_date = coalesce(${due}::date, due_date) ${back}, updated_at = now(), version = version + 1 where id = ${cur.id}`; return { taskId: cur.id, action: 'updated' }; }
    return { taskId: cur.id, action: 'none' };
  }
  if (!progress) return { taskId: null, action: 'none' };
  const { createTask } = await import('../tasks');
  const KIND_LABEL = await kindLabels(tenantOf(u));
  // #100 담당자 지정: 담당이 안 정해진 자동 업무는 영업 원천 규칙(주·부 담당, 부재 대체)
  const rule = i.assigneeId ? null : await (await import('../assignees')).resolveAssignee(sql, tenantOf(u), 'sales_source', i.kind).catch(() => null);
  // 결정 15-35: 입찰은 업무로(현장 영업과 구분) — 입찰 공고에서 생긴 업무는 [입찰]
  const title = `${i.kind === 'bid' ? '[입찰]' : '[영업]'} ${i.name.slice(0, 120)} — ${(i.nextAction ?? (i.kind === 'lead' ? '첫 연락' : st === '검토중' ? '검토' : i.kind === 'vendor' ? '등록 신청' : i.kind === 'bid' ? '입찰 준비' : '다음 조치')).slice(0, 40)}`;
  const desc = `${KIND_LABEL[i.kind]} 건에서 자동으로 만든 ${i.kind === 'bid' ? '입찰' : '영업'} 업무입니다 — 원천: ${LINK[i.kind](i.id)}${i.deadline ? `\n입찰 마감: ${i.deadline}` : ''}\n(상태를 보류·미참여·대상아님·완료로 바꾸면 이 업무도 함께 보류·완료됩니다)`;
  const r = await createTask(u, { title, description: desc, space: 'sales', assigneeId: i.assigneeId ?? rule?.userId ?? u.id, requestedById: u.id, dueDate: due, approvalRequired: false, tags: ['영업', KIND_LABEL[i.kind]] }, { quiet: !!i.quiet, skipQuota: true });
  await sql`update tasks set sales_ref = ${sql.json({ kind: i.kind, id: i.id, name: i.name })}, lead_id = ${i.leadId ?? (i.kind === 'lead' ? i.id : null)}, assigned_by_rule = ${rule?.ruleId ?? null} where id = ${r.id}`;
  if (i.kind === 'bid') (await import('./autoAttach')).attachSourceFilesLater(u, { kind: 'bid', id: i.id, taskIds: [r.id] }); // #507 공고 첨부 자동
  return { taskId: r.id, action: 'created' };
}

/**
 * 대표 10/21 22:00 ⑧(#421) 영업 2차 추적 — 리드에서 나온 업무(tasks.lead_id)를 완료하면 리드의 '다음 연락'으로 자동 이어진다.
 * 리드가 진행 단계일 때만: 다음 연락일이 없거나 지났으면 오늘 + SALES_FOLLOWUP_DAYS(기본 7)로 잡고, 다음 조치 업무를 다시 만든다(syncSalesTask → 담당자 배정 알림).
 * 다음 연락일이 아직 앞에 있으면 날짜는 그대로 두고 그 날짜 업무만 다시 만든다. 보류·실패·완료 단계면 아무것도 안 한다.
 * 197차(#460): 화면의 [완료]는 '다음 연락일(+ 할 일)' 또는 '종결(성사·보류·실패 + 사유·다시 볼 날)'을 골라 보낸다(choice) — 고른 대로.
 * 고르지 않은 완료(여러 건 완료·알림의 바로 완료·AI 비서 등)는 예전처럼 자동 7일
 */
export const FOLLOWUP_DAYS = () => Math.max(1, Number(process.env.SALES_FOLLOWUP_DAYS) || 7);
export type LeadFollowUp = { nextDate: string; nextAction?: string } | { close: '계약완료' | '보류' | '실패'; reason?: string; revisitDate?: string | null };
export async function followUpAfterTaskDone(sql: Sql, u: SessionUser, i: { taskId: string; title: string; leadId: string; choice?: LeadFollowUp }) {
  const t = tenantOf(u);
  const [l] = await sql<{ id: string; name: string; status: string; next: string | null; next_action: string | null; owner_id: string | null }[]>`select id, name, status, next_contact_date::text as next, next_action, owner_id from sales_leads where id = ${i.leadId} and tenant = ${t} and deleted_at is null`;
  if (!l || DONE.has(l.status) || HOLD.has(l.status) || l.status === '되돌림') return { action: 'none' as const }; // 리드는 끝·보류·되돌림 단계가 아니면 진행 중(syncSalesTask 와 같은 규칙)
  const today = ymd(new Date());
  const { audit } = await import('../log');
  const c = i.choice;
  if (c && 'close' in c) { // 종결: 단계 바꾸기(리드 담당·관리자·담당 없는 리드) + 사유(보류·실패 필수) · 다시 볼 날 → 열린 영업 업무는 보류·완료
    if (!['owner', 'admin'].includes(u.role) && l.owner_id && l.owner_id !== u.id) throw new HttpError(403, 'forbidden', '리드 단계는 리드 담당·관리자만 바꿀 수 있습니다 — 다음 연락일을 골라 주세요');
    const reason = c.reason?.trim() || null;
    if (c.close !== '계약완료' && !reason) throw badRequest(`'${c.close}'(으)로 닫을 때는 사유가 필요합니다`);
    const revisit = c.close === '계약완료' ? null : c.revisitDate ?? null;
    if (revisit && revisit <= today) throw badRequest('다시 볼 날은 내일 이후로 골라 주세요');
    await sql`update sales_leads set status = ${c.close}, revisit_date = ${revisit}, updated_at = now() where id = ${l.id}`;
    await sql`insert into sales_status_log (tenant, lead_id, from_status, to_status, reason, changed_by) values (${t}, ${l.id}, ${l.status}, ${c.close}, ${[reason, `업무 완료: ${i.title}`].filter(Boolean).join(' — ').slice(0, 500)}, ${u.id})`;
    await audit(sql, u.id, 'sales.followup', 'sales_lead', l.id, { close: c.close, from: l.status, reason, revisit, taskId: i.taskId, title: i.title }, null).catch(() => {});
    await syncSalesTask(sql, u, { kind: 'lead', id: l.id, name: l.name, status: c.close, leadId: l.id });
    return { action: 'closed' as const, leadId: l.id, from: l.status, to: c.close, revisit };
  }
  let next: string; let nextAction: string | null;
  if (c) {
    if (c.nextDate < today) throw badRequest('다음 연락일은 오늘이나 그 뒤로 골라 주세요');
    next = c.nextDate; nextAction = c.nextAction?.trim() || null;
  } else {
    next = l.next && l.next > today ? l.next : ymd(new Date(Date.parse(`${today}T12:00:00+09:00`) + FOLLOWUP_DAYS() * 864e5));
    nextAction = l.next && l.next > today ? l.next_action : null; // 자동 7일이면 지난 할 일은 비움
  }
  if (next !== l.next || nextAction !== l.next_action) {
    await sql`update sales_leads set next_contact_date = ${next}, next_action = ${nextAction}, updated_at = now() where id = ${l.id}`;
    await audit(sql, u.id, 'sales.followup', 'sales_lead', l.id, { from: l.next, to: next, action: nextAction, chosen: !!c, taskId: i.taskId, title: i.title }, null).catch(() => {});
  }
  const r = await syncSalesTask(sql, u, { kind: 'lead', id: l.id, name: l.name, status: l.status, nextDate: next, nextAction: nextAction ?? '다음 연락', assigneeId: l.owner_id ?? u.id, leadId: l.id });
  // #508 후속: 새로 만든 업무인지(열린 자동 업무가 이미 있으면 그 업무 마감만 바꿈) + 완료 전 다음 연락일·할 일 — 완료를 되돌리면 같이 되돌림(tasks.ts undoAutoSpawned)
  return { action: 'followup' as const, next, prev: l.next, prevAction: l.next_action, nextAction, leadId: l.id, taskId: r.taskId, created: r.action === 'created', chosen: !!c };
}
