import { db, type Sql } from './db';
import { badRequest, forbidden, notFound } from './errors';
import { audit, logError } from './log';
import { requireAdmin } from './access';
import { ROLE_LABEL, STATUS_LABEL, PRIORITY_LABEL, UNIT_TYPE_LABEL, tenantOf, type SessionUser } from './types';
import { READ_GUARD_MAX } from './storage';

/**
 * 상용화 B4 회사 전체 내보내기(docs/research/TENANT_DELETE_EXPORT_2026-11-24.md 4절, DB 287).
 * 대표·관리자가 설정 › 내보내기에서 요청(하루 1번) → 정기 실행(+요청 직후 응답 뒤)이 압축 파일을 만들어 저장소에 둠 → 알림·메일 →
 * 7일 동안 그 회사 대표·관리자만 내려받기(로그인 필요, 내려받을 때마다 감사 기록) → 7일 지나면 저장소에서 지움.
 *
 * 압축 파일 안: 읽어 주세요.txt · 자료/영역별 CSV(엑셀에서 바로 열림) · 파일/자료실·업무 첨부·일정 첨부 원본 · 파일_목록.csv
 * 넣지 않는 것(개인 영역·비밀): 비밀번호·인증 정보·연동 토큰, 1:1·개인 그룹 대화, 직원의 '내 파일', 메모(주요 메모 포함),
 *   출퇴근 위치 좌표, 격리 팀의 업무·일정·대화, 비공개 일정의 제목·내용, 요청한 사람이 볼 수 없는 등급(내부·기밀)의 자료실 파일.
 * 파일이 많으면 압축 파일을 여러 개로 나눔(한 개 최대 COMPANY_EXPORT_PART_MB, 기본 1GB — 정기 실행 한 번에 한 개).
 * 한 파일이 200MB 를 넘으면 담지 않고 목록에 '큰 파일 — 앱에서 내려받기'로 적음(서버가 한 번에 읽는 상한).
 */
const TZ = `'Asia/Seoul'`;
const T = (col: string) => `to_char(${col} at time zone ${TZ}, 'YYYY-MM-DD HH24:MI')`;
const caseOf = (col: string, map: Record<string, string>) => `case ${col}::text ${Object.entries(map).map(([k, v]) => `when '${k}' then '${v}'`).join(' ')} else ${col}::text end`;
const MB = 1024 * 1024;
const partMax = () => Math.max(1, Number(process.env.COMPANY_EXPORT_PART_MB) || 1024) * MB;
const budgetMs = () => Math.max(10, Number(process.env.COMPANY_EXPORT_BUDGET_S) || 120) * 1000;
const KEEP_DAYS = 7;
const MAX_FILES = 50_000;

type FileItem = { k: string; p: string; s: number };
type Row = { id: string; tenant: string; requested_by: string | null; status: string; cursor: number; files: FileItem[] | null; parts: { n: number; key: string; size: number; files: number }[];
  counts: Record<string, any> | null; opts: { internal?: boolean; confidential?: boolean } | null; attempts: number; created_at: Date };

function guard(u: SessionUser) {
  requireAdmin(u);
  if (u.isDemo) throw forbidden('둘러보기 계정은 내보낼 수 없습니다');
  if (u.support) throw forbidden('지원(대신 보기) 중에는 회사 자료를 내보낼 수 없습니다');
}

// ---------------- 영역별 CSV ----------------
const AREAS: { file: string; label: string; sql: string }[] = [
  { file: '사람.csv', label: '사람', sql: `select u.name as "이름", u.email as "이메일", u.title as "직함", u.phone as "전화", ${caseOf('u.role', ROLE_LABEL)} as "역할",
      ${caseOf('u.status', { active: '사용 중', invited: '초대함', left: '퇴사', disabled: '정지' })} as "상태", ${T('u.created_at')} as "가입", ${T('u.last_login_at')} as "마지막 로그인"
    from users u where u.tenant = $1 and u.deleted_at is null and not u.is_demo order by u.created_at` },
  { file: '조직.csv', label: '조직', sql: `select o.name as "이름", ${caseOf('o.type', UNIT_TYPE_LABEL)} as "종류", p.name as "상위 조직", case when o.active then '사용' else '사용 안 함' end as "상태"
    from org_units o left join org_units p on p.id = o.parent_id where o.tenant = $1 and not o.is_demo order by o.sort, o.name` },
  { file: '팀.csv', label: '팀', sql: `select t.name as "이름", p.name as "상위 팀", case when t.archived then '보관' else '사용' end as "상태", case when t.isolated then '격리(업무·일정·대화는 넣지 않음)' else '' end as "격리", ${T('t.created_at')} as "만든 때"
    from teams t left join teams p on p.id = t.parent_id where t.tenant = $1 order by t.created_at` },
  { file: '업무.csv', label: '업무', sql: `select t.id::text as "업무 번호", t.title as "제목", t.description as "설명", ${caseOf('t.status', STATUS_LABEL)} as "상태", ${caseOf('t.priority', PRIORITY_LABEL)} as "우선순위",
      a.name as "담당", (select string_agg(x.name, ', ' order by x.name) from task_assignees ta join users x on x.id = ta.user_id where ta.task_id = t.id) as "같이 맡은 사람",
      rq.name as "요청한 사람", cb.name as "만든 사람", o.name as "조직", tm.name as "팀", p.title as "상위 업무", t.start_date::text as "시작일", t.due_date::text as "마감일",
      t.due_time::text as "마감 시각", ${T('t.completed_at')} as "완료", array_to_string(t.tags, ', ') as "태그", ${T('t.created_at')} as "만든 때", ${T('t.updated_at')} as "고친 때"
    from tasks t join org_units o on o.id = t.org_unit_id and o.tenant = $1 left join teams tm on tm.id = t.team_id
      left join users a on a.id = t.assignee_id left join users rq on rq.id = t.requested_by left join users cb on cb.id = t.created_by left join tasks p on p.id = t.parent_id
    where t.deleted_at is null and not o.is_demo and not coalesce(tm.isolated, false) order by t.created_at` },
  { file: '업무_댓글.csv', label: '업무 댓글', sql: `select t.id::text as "업무 번호", t.title as "업무 제목", au.name as "쓴 사람", c.body as "내용", ${T('c.created_at')} as "쓴 때"
    from comments c join tasks t on t.id = c.task_id join org_units o on o.id = t.org_unit_id and o.tenant = $1 left join teams tm on tm.id = t.team_id left join users au on au.id = c.author_id
    where c.deleted_at is null and t.deleted_at is null and not o.is_demo and not coalesce(tm.isolated, false) order by c.created_at` },
  { file: '일정.csv', label: '일정', sql: `select c.name as "달력", case when e.is_private then '(비공개 일정)' else e.title end as "제목", case when e.is_private then null else e.description end as "내용",
      case when e.is_private then null else e.location end as "장소", ${T('e.start_at')} as "시작", ${T('e.end_at')} as "끝", case when e.all_day then '종일' else '' end as "종일",
      e.rrule as "반복", case when e.cancelled then '취소' else '' end as "취소", cb.name as "만든 사람", e.task_id::text as "연결 업무 번호", ${T('e.created_at')} as "만든 때"
    from events e join calendars c on c.id = e.calendar_id and c.tenant = $1 left join teams tm on tm.id = c.team_id left join users cb on cb.id = e.created_by
    where e.deleted_at is null and not coalesce(tm.isolated, false) order by e.start_at` },
  { file: '연락처.csv', label: '연락처', sql: `select c.name as "이름", c.organization as "회사", c.title as "직함", c.phone as "전화", c.email as "이메일", c.memo as "메모", array_to_string(c.tags, ', ') as "태그",
      ow.name as "담당", c.source as "출처", ${T('c.last_contact_at')} as "마지막 연락", ${T('c.created_at')} as "만든 때"
    from contacts c left join users ow on ow.id = c.owner_id where c.tenant = $1 and c.deleted_at is null order by c.created_at` },
  { file: '영업_거래처.csv', label: '영업 거래처', sql: `select l.name as "이름", l.status as "단계", l.priority as "우선순위", l.facility_type as "시설 종류", l.region as "지역", l.scale as "규모",
      ow.name as "담당", l.next_contact_date::text as "다음 연락일", l.contact_name as "연락 담당자", l.phone as "전화", l.email as "이메일", l.homepage as "홈페이지", l.biz_no as "사업자번호",
      l.expected_revenue as "예상 매출", l.next_action as "다음 할 일", l.memo as "메모", ${T('l.created_at')} as "만든 때"
    from sales_leads l left join users ow on ow.id = l.owner_id where l.tenant = $1 and l.deleted_at is null and l.merged_into is null order by l.created_at` },
  { file: '결재.csv', label: '결재', sql: `select r.doc_no as "문서 번호", coalesce(f.name, r.kind) as "종류", rq.name as "요청한 사람", r.status as "상태", r.amount as "금액", r.data::text as "내용",
      r.reject_reason as "반려 사유", ${T('r.created_at')} as "요청", ${T('r.decided_at')} as "결정"
    from approval_requests r left join approval_forms f on f.id = r.form_id left join users rq on rq.id = r.requester_id where r.tenant = $1 order by r.created_at` },
  { file: '계약.csv', label: '계약', sql: `select c.doc_no as "문서 번호", c.title as "제목", c.kind as "종류", c.status as "상태", us.name as "대상", c.expires_at::text as "만료",
      ${T('c.completed_at')} as "서명 완료", c.body as "내용", ${T('c.created_at')} as "만든 때"
    from contracts c left join users us on us.id = c.user_id where c.tenant = $1 order by c.created_at` },
  { file: '대화.csv', label: '대화(회사·팀·업무 대화방)', sql: `select coalesce(r.name, t.title, tm.name, '회사 전체') as "대화방", ${caseOf('r.kind', { company: '회사 전체', team: '팀', task: '업무' })} as "종류",
      ${T('m.created_at')} as "시각", au.name as "보낸 사람", m.body as "내용", m.file_name as "파일 이름"
    from chat_messages m join chat_rooms r on r.id = m.room_id and r.tenant = $1 and r.kind in ('company', 'team', 'task') left join teams tm on tm.id = r.team_id
      left join tasks t on t.id = r.task_id left join users au on au.id = m.author_id
    where m.deleted_at is null and coalesce(m.kind, 'text') <> 'system' and not coalesce(tm.isolated, false) order by r.id, m.id` },
  { file: '출퇴근.csv', label: '출퇴근(위치 좌표 없음)', sql: `select a.day::text as "날짜", us.name as "이름", ${T('a.in_at')} as "출근", ${T('a.out_at')} as "퇴근",
      case a.in_inside when true then '근무지 안' when false then '근무지 밖' else '' end as "출근 위치 확인", case a.out_inside when true then '근무지 안' when false then '근무지 밖' else '' end as "퇴근 위치 확인",
      concat_ws(' / ', a.in_reason, a.out_reason) as "사유"
    from attendance a left join users us on us.id = a.user_id where a.tenant = $1 order by a.day, us.name` },
  { file: '점검_결과.csv', label: '점검 결과', sql: `select r.item_title as "항목", r.verdict as "판정", r.memo as "메모", us.name as "확인한 사람", ${T('r.created_at')} as "때"
    from chk_results r left join users us on us.id = r.by_user where r.tenant = $1 order by r.created_at` },
  { file: '결제.csv', label: '결제', sql: `select ${T('coalesce(p.paid_at, p.created_at)')} as "때", p.kind as "종류", p.plan_code as "요금제", p.amount as "금액", p.status as "상태", p.canceled_amount as "환불 금액", p.moid as "주문 번호"
    from payments p where p.tenant = $1 order by p.created_at` },
];

const cell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv(header: string[], rows: unknown[][]) {
  return Buffer.from(`﻿${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`, 'utf8');
}
async function areaCsv(sql: Sql, tenant: string, a: (typeof AREAS)[number]) {
  const r = await sql.unsafe(a.sql, [tenant]);
  const header = (r as unknown as { columns: { name: string }[] }).columns.map((c) => c.name);
  return { rows: r.length, data: toCsv(header, r.map((x: Record<string, unknown>) => header.map((h) => x[h]))) };
}

// ---------------- 담을 파일 목록 ----------------
type Listed = FileItem & { kind: string; where: string; title: string; name: string; by: string | null; at: string | null; big: boolean };
async function listFiles(sql: Sql, tenant: string, opts: Row['opts']): Promise<Listed[]> {
  const { effSec } = await import('./library');
  const folders = await sql<{ folder: string; security: 'public' | 'internal' | 'confidential' }[]>`select folder, security from library_folder_security where tenant = ${tenant}`;
  const ctx = { folders, internal: !!opts?.internal, confidential: !!opts?.confidential, confEdit: false };
  const lib = await sql<{ storage_key: string; folder: string; security: 'public' | 'internal' | 'confidential'; title: string | null; file_name: string; size_bytes: number | null; by: string | null; at: string | null; scope: string; team: string | null }[]>`
    select f.storage_key, coalesce(f.folder, '') as folder, coalesce(f.security, 'public') as security, f.title, f.file_name, f.size_bytes::float8 as size_bytes, us.name as by,
      to_char(f.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as at, f.scope, tm.name as team
    from library_files f left join users us on us.id = f.created_by left join teams tm on tm.id = f.team_id
    where f.tenant = ${tenant} and f.deleted_at is null and f.upload_status = 'ready' and f.storage_key is not null and f.scope in ('company', 'team') and not coalesce(tm.isolated, false)
    order by f.created_at, f.id`;
  const att = await sql<{ storage_key: string; file_name: string; size_bytes: number | null; by: string | null; at: string | null; task_id: string | null; task_title: string | null; event_title: string | null; event_id: string | null }[]>`
    select a.storage_key, a.file_name, a.size_bytes::float8 as size_bytes, us.name as by, to_char(a.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as at,
      a.task_id::text, t.title as task_title, case when e.is_private then '비공개 일정' else e.title end as event_title, a.event_id::text
    from attachments a left join users us on us.id = a.created_by
      left join tasks t on t.id = a.task_id and t.deleted_at is null left join org_units o on o.id = t.org_unit_id left join teams tt on tt.id = t.team_id
      left join events e on e.id = a.event_id and e.deleted_at is null left join calendars c on c.id = e.calendar_id left join teams et on et.id = c.team_id
    where a.deleted_at is null and a.kind = 'file' and a.upload_status = 'ready' and a.storage_key is not null
      and ((t.id is not null and o.tenant = ${tenant} and not o.is_demo and not coalesce(tt.isolated, false)) or (e.id is not null and c.tenant = ${tenant} and not coalesce(et.isolated, false)))
    order by a.created_at, a.id`;
  const { zipSeg } = await import('./zip');
  const used = new Map<string, number>();
  const uniq = (p: string) => {
    const n = (used.get(p) ?? 0) + 1; used.set(p, n);
    if (n === 1) return p;
    const m = /^(.*?)(\.[^./]+)?$/.exec(p)!; return `${m[1]} (${n})${m[2] ?? ''}`;
  };
  const out: Listed[] = [];
  for (const f of lib) {
    const sec = effSec(ctx, { folder: f.folder, security: f.security });
    if (sec === 'internal' && !ctx.internal) continue;
    if (sec === 'confidential' && !ctx.confidential) continue;
    const segs = f.folder.split('/').map((x) => x.trim()).filter(Boolean).map((x) => zipSeg(x, 80));
    const top = f.scope === 'team' ? ['팀 자료실', zipSeg(f.team ?? '팀', 60)] : ['자료실'];
    const s = Number(f.size_bytes) || 0;
    out.push({ k: f.storage_key, p: uniq(['파일', ...top, ...segs, zipSeg(f.file_name)].join('/')), s, kind: f.scope === 'team' ? '팀 자료실' : '자료실', where: f.folder || '(맨 위)', title: f.title ?? '', name: f.file_name, by: f.by, at: f.at, big: s > READ_GUARD_MAX });
  }
  for (const a of att) {
    const isTask = !!a.task_id;
    const holder = isTask ? `${zipSeg(a.task_title ?? '업무', 60)} ~${a.task_id!.slice(0, 8)}` : `${zipSeg(a.event_title ?? '일정', 60)} ~${a.event_id!.slice(0, 8)}`;
    const s = Number(a.size_bytes) || 0;
    out.push({ k: a.storage_key, p: uniq(['파일', isTask ? '업무 첨부' : '일정 첨부', holder, zipSeg(a.file_name)].join('/')), s, kind: isTask ? '업무 첨부' : '일정 첨부',
      where: isTask ? `${a.task_title ?? ''} (업무 번호 ${a.task_id})` : a.event_title ?? '', title: '', name: a.file_name, by: a.by, at: a.at, big: s > READ_GUARD_MAX });
  }
  return out.slice(0, MAX_FILES);
}

function readme(tenantName: string, counts: Record<string, any>, at: Date) {
  const d = at.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const areas = (counts.areas as { file: string; label: string; rows: number }[]).map((a) => `  - 자료/${a.file}: ${a.label} ${a.rows}줄`).join('\r\n');
  return Buffer.from(`﻿워크인 회사 전체 내보내기 — ${tenantName}\r\n만든 때: ${d}(서울)\r\n\r\n` +
    `■ 들어 있는 것\r\n${areas}\r\n  - 파일/: 자료실(회사·팀)·업무 첨부·일정 첨부 원본 ${counts.files}개 (큰 파일 ${counts.big}개는 빠짐 — 아래)\r\n  - 파일_목록.csv: 모든 파일의 원래 위치·압축 안 경로·담김 여부\r\n\r\n` +
    `■ 압축 파일이 여러 개일 때\r\n  모두 같은 폴더에 풀면 하나로 합쳐집니다(폴더 구조가 같음). 자료(CSV)는 첫 번째 압축 파일에만 있습니다.\r\n\r\n` +
    `■ 넣지 않은 것\r\n  - 비밀번호·인증 정보·외부 연동 열쇠\r\n  - 1:1 대화·개인 그룹 대화, 직원의 '내 파일', 메모(주요 메모 포함) — 개인 영역이라 각자 받아 두세요(설정 › 내 데이터 내려받기)\r\n` +
    `  - 출퇴근 위치 좌표(근무지 안/밖 결과만 담음), 비공개 일정의 제목·내용\r\n  - 격리된 팀의 업무·일정·대화·자료\r\n  - 요청한 사람이 볼 수 없는 등급(내부·기밀)의 자료실 파일\r\n` +
    `  - 200MB 넘는 파일(파일_목록.csv 에 '큰 파일'로 표시 — 워크인 화면에서 직접 내려받기)\r\n\r\n` +
    `■ CSV 파일은 엑셀에서 바로 열립니다(UTF-8). 날짜·시각은 서울 시간입니다.\r\n`, 'utf8');
}

// ---------------- 요청·목록·내려받기 ----------------
export async function requestCompanyExport(u: SessionUser, ip: string | null) {
  guard(u);
  const sql = db(); const tenant = tenantOf(u);
  const [busy] = await sql<{ id: string; status: string }[]>`select id, status from company_exports where tenant = ${tenant}
    and (status in ('queued', 'running') or (status = 'done' and created_at > now() - interval '1 day')) order by created_at desc limit 1`;
  if (busy) throw badRequest(busy.status === 'done' ? '회사 전체 내보내기는 하루 한 번 요청할 수 있습니다 — 만든 파일은 7일 동안 내려받을 수 있습니다' : '이미 만들고 있습니다 — 끝나면 알림·메일로 알려 드립니다');
  const { secCtx } = await import('./library');
  const c = await secCtx(u);
  const [row] = await sql<{ id: string }[]>`insert into company_exports (tenant, requested_by, opts) values (${tenant}, ${u.id}, ${sql.json({ internal: c.internal, confidential: c.confidential })}) returning id`;
  await audit(sql, u.id, 'company.export_request', 'company_export', row.id, { tenant }, ip);
  (await import('./later')).runLater('companyExport', () => companyExportTick(row.id));
  return { ok: true, id: row.id };
}

export async function listCompanyExports(u: SessionUser) {
  guard(u);
  const rows = await db()<{ id: string; status: string; cursor: number; total: number; parts: Row['parts']; counts: Record<string, any> | null; error: string | null; created_at: Date; finished_at: Date | null; expires_at: Date | null; by: string | null }[]>`
    select x.id, x.status, x.cursor, coalesce(jsonb_array_length(x.files), 0)::int as total, x.parts, x.counts, x.error, x.created_at, x.finished_at, x.expires_at, us.name as by
    from company_exports x left join users us on us.id = x.requested_by where x.tenant = ${tenantOf(u)} order by x.created_at desc limit 5`;
  return { items: rows.map((r) => ({ ...r, parts: r.parts.map((p) => ({ n: p.n, size: p.size, files: p.files })), counts: r.counts ? { big: r.counts.big ?? 0, files: r.counts.files ?? 0, missing: r.counts.missingCount ?? 0, areas: r.counts.areas ?? [] } : null })), keepDays: KEEP_DAYS };
}

export async function companyExportDownload(u: SessionUser, id: string, part: number, ip: string | null) {
  guard(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db();
  const [r] = await sql<{ tenant: string; status: string; parts: Row['parts']; expires_at: Date | null; created_at: Date; name: string | null }[]>`
    select x.tenant, x.status, x.parts, x.expires_at, x.created_at, t.name from company_exports x left join tenants t on t.id = x.tenant where x.id = ${id}`;
  if (!r || r.tenant !== tenantOf(u)) throw notFound();
  if (r.status !== 'done' || !r.expires_at || r.expires_at < new Date()) throw badRequest('내려받기 기간(7일)이 지났거나 아직 만들고 있습니다');
  const p = r.parts.find((x) => x.n === part);
  if (!p) throw notFound();
  await audit(sql, u.id, 'company.export_download', 'company_export', id, { part, size: p.size }, ip);
  const day = r.created_at.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/-/g, '');
  const { downloadUrl } = await import('./storage');
  return downloadUrl(p.key, `${(r.name ?? '회사').replace(/[\\/:*?"<>|]+/g, '_')}-전체 내보내기-${day}${r.parts.length > 1 ? `-${part}` : ''}.zip`, false, 300, 'application/zip');
}

// ---------------- 정기 실행: 만들기 · 지우기 ----------------
/** 정기 실행이 할 일이 있는지(만들 것 · 7일 지난 것 · 실패해 남은 조각) */
export async function companyExportPending() {
  const [r] = await db()<{ w: boolean }[]>`select exists (select 1 from company_exports where (status in ('queued', 'running') and (locked_until is null or locked_until < now()))
    or (status = 'done' and expires_at < now()) or (status = 'failed' and finished_at < now() - interval '1 day' and jsonb_array_length(parts) > 0)) as w`;
  return !!r?.w;
}
/** 정기 실행·요청 직후: 기간 지난 것 지우기 → 만들 것 하나를 골라 압축 파일 한 개를 만듦 */
export async function companyExportTick(onlyId?: string) {
  const sql = db();
  const expired = await expireOld(sql).catch(async (e) => { await logError('companyExport:expire', e); return 0; });
  const pick = onlyId ? sql`and id = ${onlyId}` : sql``;
  const [row] = await sql<Row[]>`update company_exports set status = 'running', attempts = attempts + 1, locked_until = now() + interval '6 minutes'
    where id = (select id from company_exports where status in ('queued', 'running') and (locked_until is null or locked_until < now()) ${pick} order by created_at limit 1 for update skip locked)
    returning id, tenant, requested_by, status, cursor, files, parts, counts, opts, attempts, created_at`;
  if (!row) return { expired, ran: null };
  try {
    const r = await buildPart(sql, row);
    return { expired, ran: row.id, ...r };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    await logError('companyExport', e, { id: row.id, tenant: row.tenant });
    const giveUp = row.attempts >= 3;
    await sql`update company_exports set status = ${giveUp ? 'failed' : 'running'}, error = ${msg}, locked_until = null, finished_at = ${giveUp ? new Date() : null} where id = ${row.id}`;
    if (giveUp) await tell(sql, row, false).catch(() => {});
    return { expired, ran: row.id, error: msg };
  }
}

async function buildPart(sql: Sql, row: Row) {
  const started = Date.now();
  const { objectWriter, getObject } = await import('./storage');
  const { ZipWriter } = await import('./zip');
  let files = row.files; let counts = row.counts ?? {};
  const n = row.parts.length + 1;
  const key = `${row.tenant}/export/${row.id}/part-${n}.zip`;
  const w = await objectWriter(key, 'application/zip');
  const zip = new ZipWriter(w);
  try {
    if (!files) {
      // 첫 압축 파일: 영역별 CSV + 파일 목록 + 읽어 주세요
      const [t] = await sql<{ name: string }[]>`select name from tenants where id = ${row.tenant}`;
      const listed = await listFiles(sql, row.tenant, row.opts);
      const areas: { file: string; label: string; rows: number }[] = [];
      const csvs: { file: string; data: Buffer }[] = [];
      for (const a of AREAS) {
        const r = await areaCsv(sql, row.tenant, a).catch(async (e) => { await logError(`companyExport:${a.file}`, e, { tenant: row.tenant }); return null; });
        if (!r) continue; // 표가 없는 오래된 DB 등 — 빼고 계속(목록에 없음)
        areas.push({ file: a.file, label: a.label, rows: r.rows }); csvs.push({ file: a.file, data: r.data });
      }
      files = listed.filter((f) => !f.big).map(({ k, p, s }) => ({ k, p, s }));
      counts = { areas, files: files.length, big: listed.length - files.length, missing: [], missingCount: 0 };
      await zip.add('읽어 주세요.txt', readme(t?.name ?? row.tenant, counts, row.created_at));
      for (const c of csvs) await zip.add(`자료/${c.file}`, c.data);
      await zip.add('파일_목록.csv', toCsv(['구분', '원래 위치', '제목', '파일 이름', '크기(MB)', '올린 사람', '올린 때', '압축 안 경로', '담김'],
        listed.map((f) => [f.kind, f.where, f.title, f.name, Math.round((f.s / MB) * 10) / 10, f.by, f.at, f.big ? '' : f.p, f.big ? '큰 파일(200MB 넘음) — 워크인에서 직접 내려받기' : '담김'])));
      await sql`update company_exports set files = ${sql.json(files as never)}, counts = ${sql.json(counts as never)} where id = ${row.id}`;
    }
    let cursor = row.cursor; const missing: string[] = [...(counts.missing ?? [])]; let missingCount = counts.missingCount ?? 0;
    const max = partMax(); const budget = budgetMs();
    while (cursor < files.length) {
      const f = files[cursor];
      // 이번 압축 파일에 무언가 담긴 뒤에만 끊음(첫 압축 파일은 자료 CSV 가 이미 있음) — 한 번에 적어도 파일 하나는 나아감
      if (zip.files > 0 && (zip.bytes + f.s > max || Date.now() - started > budget || zip.files >= 60_000)) break;
      try {
        const data = await getObject(f.k);
        await zip.add(f.p, data);
      } catch (e) {
        missingCount++; if (missing.length < 50) missing.push(f.p);
        if (!/NoSuchKey|ENOENT|not found|404/i.test(String((e as Error)?.message ?? e)) && missingCount <= 3) await logError('companyExport:file', e, { id: row.id });
      }
      cursor++;
    }
    await zip.finish();
    const size = await w.close();
    const parts = [...row.parts, { n, key, size, files: zip.files }];
    counts = { ...counts, missing, missingCount };
    const done = cursor >= files.length;
    await sql`update company_exports set parts = ${sql.json(parts as never)}, cursor = ${cursor}, counts = ${sql.json(counts as never)}, attempts = 0, error = null, locked_until = null,
      status = ${done ? 'done' : 'running'}, finished_at = ${done ? new Date() : null}, expires_at = ${done ? new Date(Date.now() + KEEP_DAYS * 864e5) : null} where id = ${row.id}`;
    if (done) await tell(sql, row, true).catch(() => {});
    return { part: n, size, files: zip.files, cursor, total: files.length, done };
  } catch (e) {
    await w.abort();
    throw e;
  }
}

/** 끝·실패 알림: 요청한 사람에게 알림 + 메일(링크는 설정 화면 — 내려받기는 로그인해야 됨) */
async function tell(sql: Sql, row: Row, ok: boolean) {
  if (!row.requested_by) return;
  const [u] = await sql<{ email: string; status: string }[]>`select email, status from users where id = ${row.requested_by} and deleted_at is null`;
  if (!u) return;
  const { notify } = await import('./notifications');
  const title = ok ? '회사 전체 내보내기가 준비되었습니다' : '회사 전체 내보내기를 만들지 못했습니다';
  const body = ok ? `${KEEP_DAYS}일 동안 설정 › 내보내기에서 내려받을 수 있습니다` : '잠시 뒤 설정 › 내보내기에서 다시 요청해 주세요. 계속되면 고객센터로 알려 주세요';
  await notify(sql, { userIds: [row.requested_by], type: 'company_export', title, body, link: '/settings#company-export', dedupeKey: `company-export:${row.id}:${ok ? 'ok' : 'fail'}` });
  if (u.status === 'active') {
    const { sendMail, appUrl } = await import('./mail');
    await sendMail(u.email, `[워크인] ${title}`, `${title}.\n${body}.\n${appUrl()}/settings#company-export\n\n내려받기는 회사 대표·관리자 로그인 뒤에만 됩니다.`).catch(() => {});
  }
}

/** 7일 지난 내보내기 파일을 저장소에서 지움(기록 줄은 남김 — 언제 누가 받았는지는 감사 기록) · 실패해 남은 조각도 지움 */
async function expireOld(sql: Sql) {
  const rows = await sql<{ id: string; parts: Row['parts'] }[]>`select id, parts from company_exports
    where (status = 'done' and expires_at < now()) or (status = 'failed' and finished_at < now() - interval '1 day' and jsonb_array_length(parts) > 0) limit 20`;
  const { deleteKeys } = await import('./storage');
  for (const r of rows) {
    await deleteKeys(r.parts.map((p) => p.key));
    await sql`update company_exports set status = case when status = 'done' then 'expired' else status end, parts = '[]'::jsonb where id = ${r.id}`;
  }
  return rows.length;
}
