import { z } from 'zod';
import { DateTime } from 'luxon';
import { db } from '../db';
import { HttpError, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../log';
import { isAdmin, denyDemo } from '../access';
import { todaySeoul } from '../time';
import { listTasks, listQuery, getTaskDetail, createTask, updateTask, addComment, taskInput } from '../tasks';
import { listEvents, eventInput, createEvent, updateEvent, deleteEvent, findConflicts, loadEvent } from '../events';
import { canSeeRevenue } from '../revenue';
import { directory } from '../admin';
import { listLibrary, loadLibraryFile, attachLibraryToTask, saveGeneratedFile, tenantOf, folderLevel, updateLibraryFile, organizeLibraryFile, cleanFolder } from '../library';
import { RANK } from '../menuPerms';
import { writeXlsx } from '../xlsx';
import { anthropicProvider, aiEnabled, modelFor, costUsd, usdKrw, type AiMessage, type AiProvider, type AiTool } from './provider';
import type { SessionUser } from '../types';

/**
 * V9 워크인 AI 비서. 요청한 사람의 권한으로만 데이터를 읽고(서버 함수 재사용 — 권한 검사 그대로),
 * 쓰기(업무 만들기·고치기·댓글·첨부·보고서)는 "AI 제안"으로만 만들고 사람이 [확인]해야 실행한다.
 */
const TZ = 'Asia/Seoul';
const MAX_STEPS = 8;

export function defaultBudget() {
  const n = Number(process.env.AI_MONTHLY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
export async function usageThisMonth(tenant: string) {
  const sql = db();
  const start = DateTime.now().setZone(TZ).startOf('month').toJSDate();
  const [[u], [l]] = await Promise.all([
    sql<{ cost: number; requests: number; tokens: number }[]>`select coalesce(sum(cost_usd), 0)::float8 cost, count(*)::int requests,
      coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::float8 tokens from ai_usage where tenant = ${tenant} and created_at >= ${start}`,
    sql<{ monthly_usd: number }[]>`select monthly_usd::float8 monthly_usd from ai_limits where tenant = ${tenant}`,
  ]);
  return { costUsd: Math.round(u.cost * 10000) / 10000, requests: u.requests, tokens: u.tokens, limitUsd: l?.monthly_usd ?? defaultBudget() };
}

export async function aiStatus(u: SessionUser) {
  const { menuLevel } = await import('../menuPerms');
  const enabled = aiEnabled() && !u.isDemo && (await menuLevel(u, 'assistant')) === 'use';
  if (!enabled) return { enabled: false };
  const usage = await usageThisMonth(tenantOf(u));
  // V10 요금제 월 AI 요청 수
  const { effectiveLimits, currentUsage } = await import('../plans');
  const [{ limits }, cu] = await Promise.all([effectiveLimits(tenantOf(u)), currentUsage(tenantOf(u))]);
  const quota = { used: cu.aiRequests, limit: limits.aiRequests };
  const G = await import('./guard');
  const [budget, creditUntil] = await Promise.all([G.userAiBudget(u), G.creditBlockedUntil()]);
  return { enabled: true, model: modelFor(), usage: isAdmin(u) ? usage : { ...usage, costUsd: undefined, tokens: undefined }, quota,
    budget, creditBlocked: !!creditUntil, creditMessage: creditUntil ? G.CREDIT_MSG : null,
    overLimit: usage.costUsd >= usage.limitUsd || (quota.limit !== null && quota.used >= quota.limit) || budget.usedKrw >= budget.limitKrw || !!creditUntil, canSetLimit: u.role === 'owner' };
}
export async function setLimit(u: SessionUser, monthlyUsd: number) {
  if (u.role !== 'owner') throw new HttpError(403, 'forbidden', '대표만 바꿀 수 있습니다');
  const sql = db();
  await sql`insert into ai_limits (tenant, monthly_usd, updated_by) values (${tenantOf(u)}, ${monthlyUsd}, ${u.id})
    on conflict (tenant) do update set monthly_usd = excluded.monthly_usd, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'ai.limit', null, null, { monthlyUsd }, null);
  return { ok: true };
}

// ---------------- 도구 ----------------
const str = (d: string) => ({ type: 'string' as const, description: d });
const TOOLS: AiTool[] = [
  { name: 'search_library', description: '회사 자료실(로고·소개서·단가표·보고서 등)에서 제목·폴더·태그·본문으로 자료를 찾는다. 결과의 id 로 읽거나 업무에 첨부할 수 있다.',
    input_schema: { type: 'object', properties: { query: str('찾을 말 (예: "다짐 로고", "단가표")'), folder: str('폴더로 좁히기 (선택)') }, required: ['query'] } },
  { name: 'read_library_file', description: '자료실 파일의 본문 글자를 읽는다(문서·엑셀·텍스트). 이미지·PDF 는 본문이 없을 수 있다.',
    input_schema: { type: 'object', properties: { fileId: str('자료 id') }, required: ['fileId'] } },
  { name: 'search_tasks', description: '사용자가 볼 수 있는 업무를 찾는다.',
    input_schema: { type: 'object', properties: {
      query: str('제목 검색어 (선택)'),
      view: { type: 'string', enum: ['all', 'my', 'today', 'overdue', 'week', 'review', 'requested', 'done'], description: 'my=내 담당, requested=내가 지시한 업무, done=완료' },
      assigneeId: str('담당자 id (선택)'), from: str('마감일 시작 YYYY-MM-DD (선택)'), to: str('마감일 끝 YYYY-MM-DD (선택)'),
    } } },
  { name: 'get_task', description: '업무 하나의 상세(설명·체크리스트·댓글·첨부 이름)를 본다.',
    input_schema: { type: 'object', properties: { taskId: str('업무 id') }, required: ['taskId'] } },
  { name: 'list_events', description: '사용자가 볼 수 있는 캘린더 일정을 기간으로 본다 (최대 62일).',
    input_schema: { type: 'object', properties: { from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD (포함)') }, required: ['from', 'to'] } },
  { name: 'list_people', description: '업무를 배정할 수 있는 사람과 조직(현장·부서) 목록. 사람 이름을 id 로 바꿀 때 쓴다.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'revenue_summary', description: '현장별 월 매출·지출·회원 수 (대표·본사만). 다른 사람은 권한 없음.',
    input_schema: { type: 'object', properties: { fromMonth: str('YYYY-MM'), toMonth: str('YYYY-MM') }, required: ['fromMonth', 'toMonth'] } },
  { name: 'propose_create_task', description: '업무 만들기를 제안한다. 사용자가 화면에서 [확인]해야 만들어진다.',
    input_schema: { type: 'object', properties: {
      title: str('제목'), description: str('설명 (선택)'), assigneeId: str('담당자 id (선택)'), dueDate: str('마감일 YYYY-MM-DD (선택)'), dueTime: str('마감 시각 HH:MM (선택)'),
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, projectId: str('프로젝트 id (선택)'), orgUnitId: str('조직 id (선택)'),
      checklist: { type: 'array', items: { type: 'string' }, description: '체크리스트 (선택)' },
    }, required: ['title'] } },
  { name: 'propose_create_tasks', description: '같은 업무를 여러 담당자에게 각각 1건씩 만들기를 제안한다(첨부 자료를 읽고 정리할 때). 체크리스트·설명(메모)·마감 시각·지시자·첨부 자료를 함께. [확인] 후 생성.',
    input_schema: { type: 'object', properties: {
      title: str('업무 제목'), description: str('설명·메모 (자료 요약, 촬영 팁 등)'),
      assigneeIds: { type: 'array', items: { type: 'string' }, description: '담당자 id 목록 (list_people 로 찾기)' },
      dueDate: str('마감일 YYYY-MM-DD'), dueTime: str('마감 시각 HH:MM (선택)'), priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
      requestedById: str('지시자 id (기본: 요청한 사람)'),
      checklist: { type: 'array', items: { type: 'string' }, description: '체크리스트 항목 (예: 자료 표의 각 줄)' },
      attachFileIds: { type: 'array', items: { type: 'string' }, description: '만든 업무마다 붙일 첨부 자료 id' },
    }, required: ['title', 'assigneeIds'] } },
  { name: 'propose_update_task', description: '업무 고치기(상태·마감·담당·우선순위·제목)를 제안한다. [확인] 후 실행.',
    input_schema: { type: 'object', properties: {
      taskId: str('업무 id'), title: str('새 제목'), status: { type: 'string', enum: ['todo', 'in_progress', 'review', 'on_hold', 'done'] },
      dueDate: str('YYYY-MM-DD'), dueTime: str('HH:MM'), assigneeId: str('담당자 id'), priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
    }, required: ['taskId'] } },
  { name: 'propose_comment', description: '업무에 댓글 달기를 제안한다. [확인] 후 실행.',
    input_schema: { type: 'object', properties: { taskId: str('업무 id'), text: str('댓글 내용') }, required: ['taskId', 'text'] } },
  { name: 'propose_attach_file', description: '자료실 파일을 업무에 첨부하기를 제안한다. [확인] 후 실행.',
    input_schema: { type: 'object', properties: { taskId: str('업무 id'), fileId: str('자료 id') }, required: ['taskId', 'fileId'] } },
  { name: 'find_free_time', description: '참석자들(나 포함)이 모두 비어 있는 근무 시간(평일 9~12시·13~18시, 공휴일·연차·출장 제외)을 찾는다. 회의 시간을 정할 때 먼저 쓴다.',
    input_schema: { type: 'object', properties: {
      attendeeIds: { type: 'array', items: { type: 'string' }, description: '참석자 id (list_people 로 찾기, 나는 자동 포함)' },
      from: str('찾기 시작 날짜 YYYY-MM-DD'), to: str('끝 날짜 YYYY-MM-DD (포함, 최대 14일)'), durationMinutes: { type: 'number', description: '필요한 길이(분), 기본 60' },
      notBefore: str('이 시각 이후만 HH:MM (선택)'), notAfter: str('이 시각까지 끝나야 HH:MM (선택)'),
    }, required: ['from', 'to'] } },
  { name: 'propose_create_event', description: '캘린더 일정(회의 등) 만들기를 제안한다. 참석자 충돌·연차/부재를 함께 경고한다. [확인] 후 생성되고 참석자에게 초대 알림이 간다.',
    input_schema: { type: 'object', properties: {
      title: str('제목'), date: str('날짜 YYYY-MM-DD'), startTime: str('시작 HH:MM (종일이면 생략)'), endTime: str('끝 HH:MM (선택)'),
      durationMinutes: { type: 'number', description: '끝 시각 대신 길이(분), 기본 60' }, allDay: { type: 'boolean', description: '종일 일정' }, endDate: str('여러 날 종일 일정의 마지막 날 YYYY-MM-DD (선택)'),
      location: str('장소 (선택)'), attendeeIds: { type: 'array', items: { type: 'string' }, description: '참석자 id (list_people 로 찾기)' },
      calendar: { type: 'string', enum: ['personal', 'company'], description: 'personal=내 캘린더(기본), company=회사 공용 캘린더' },
      repeat: { type: 'string', enum: ['none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly'], description: '반복 (선택)' }, repeatUntil: str('반복 끝 날짜 YYYY-MM-DD (선택)'),
      reminderMinutes: { type: 'array', items: { type: 'number' }, description: '알림: 시작 몇 분 전 (예: [10], 하루 전은 1440)' },
      description: str('메모 (선택)'), taskId: str('연결할 업무 id (선택)'), isPrivate: { type: 'boolean', description: '비공개 (선택)' },
      taskAssigneeIds: { type: 'array', items: { type: 'string' }, description: '일정과 함께 업무도 만들 때 업무 담당자 id — 담당자마다 연결 업무 1건(마감 = 일정 시작, 날짜 연동). 같은 내용으로 propose_create_task(s) 를 따로 부르지 않는다' },
    }, required: ['title', 'date'] } },
  { name: 'propose_update_event', description: '일정 시간 바꾸기 또는 취소(삭제)를 제안한다. 일정 id 는 list_events 로 찾는다. [확인] 후 실행되고 참석자에게 알림이 간다.',
    input_schema: { type: 'object', properties: {
      eventId: str('일정 id'), action: { type: 'string', enum: ['move', 'cancel'] },
      date: str('새 날짜 YYYY-MM-DD (move)'), startTime: str('새 시작 HH:MM (move)'), endTime: str('새 끝 HH:MM (선택)'), durationMinutes: { type: 'number', description: '새 길이(분, 선택 — 없으면 원래 길이)' },
      title: str('새 제목 (선택)'), location: str('새 장소 (선택)'),
      scope: { type: 'string', enum: ['this', 'all'], description: '반복 일정이면 this=이번 일정만(occurrenceDate 필요), all=전체' }, occurrenceDate: str('반복 중 바꿀 회차의 날짜 YYYY-MM-DD'),
    }, required: ['eventId', 'action'] } },
  { name: 'propose_xlsx_report', description: '표를 엑셀(.xlsx)로 만들어 자료실 "AI 보고서" 폴더에 저장(업무 id 가 있으면 그 업무에도 첨부)하기를 제안한다. 숫자는 도구로 확인한 값만 넣는다.',
    input_schema: { type: 'object', properties: {
      title: str('파일 제목'), taskId: str('첨부할 업무 id (선택)'),
      sheets: { type: 'array', items: { type: 'object', properties: { name: str('시트 이름'), rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } }, description: '첫 줄은 머리글' } }, required: ['name', 'rows'] } },
    }, required: ['title', 'sheets'] } },
  // 대표 요청(2026-10-14): 이미지·대화 자료로 문서 파일 만들기, 대화에 올린 자료를 자료실에 정리
  { name: 'list_library_folders', description: '자료실에 이미 있는 폴더 목록(내가 볼 수 있는 것). 자료를 정리하거나 문서를 저장할 폴더를 고를 때 먼저 본다.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'propose_create_document', description: '첨부 이미지·문서 분석이나 대화 내용을 바탕으로 문서 파일(Word .docx, 또는 .md/.txt)을 만들어 자료실에 저장(업무 id 가 있으면 그 업무에도 첨부)하기를 제안한다. 표 형식 숫자 위주면 propose_xlsx_report 를 쓴다. [확인] 후 생성.',
    input_schema: { type: 'object', properties: {
      title: str('문서 제목(파일 이름)'),
      content: str('본문 — 간단한 마크다운: "# 제목"(1~3단계), "- 글머리", "1. 번호", "| 표 | 머리 |" 줄, **굵게**. 첨부·대화에 있는 내용만, 지어내지 않는다'),
      format: { type: 'string', enum: ['docx', 'md', 'txt'], description: '기본 docx(Word)' },
      folder: str('저장할 자료실 폴더 "상위/하위" (선택, 기본 "AI 문서"). 가능하면 이미 있는 폴더'),
      tags: { type: 'array', items: { type: 'string' }, description: '태그 2~5개 (선택)' },
      taskId: str('첨부할 업무 id (선택)'),
    }, required: ['title', 'content'] } },
  { name: 'propose_organize_files', description: '대화에 올린 자료(첨부 id)나 자료실 파일을 알맞은 자료실 폴더로 옮기고 제목·태그를 정리하기를 제안한다. 폴더는 list_library_folders 로 이미 있는 폴더를 먼저 고르고, 맞는 것이 없을 때만 새 폴더. folder 를 비우면 자료실 자동 정리(AI)에 맡긴다. [확인] 후 실행.',
    input_schema: { type: 'object', properties: {
      items: { type: 'array', items: { type: 'object', properties: {
        fileId: str('자료 id'), folder: str('옮길 폴더 "상위/하위" (비우면 자동 정리)'), title: str('새 제목 (선택)'),
        tags: { type: 'array', items: { type: 'string' }, description: '태그 (선택)' }, description: str('한 줄 요약 (선택)'),
      }, required: ['fileId'] } },
    }, required: ['items'] } },
  // V22 문서 엔진: 서식 있는 문서·디자인·데이터 분석은 코드 실행으로 실제 파일을 만든다(결과 카드 → 사람이 [자료실에 저장])
  { name: 'run_file_task', description: '엑셀·워드·PPT·PDF 를 새로 만들거나(디자인 포함), 앞서 만든 파일을 고치거나(baseJobId), 올린 엑셀/CSV 를 코드로 계산·차트로 분석한다. 견적서·보고서·제안서·안내문 등 서식이 중요한 문서는 이 도구를 쓴다. 만드는 데 1~3분 걸리며 결과는 화면 카드에 미리보기로 나온다. 실행 즉시 작업이 시작되니 무엇을 만들지 정해진 뒤 한 번만 호출.',
    input_schema: { type: 'object', properties: {
      mode: { type: 'string', enum: ['create', 'edit', 'analyze'], description: 'create=새로, edit=앞서 만든 파일 고치기(baseJobId 필수), analyze=자료 계산·분석' },
      kind: { type: 'string', enum: ['xlsx', 'docx', 'pptx', 'pdf', 'chart', 'none'], description: '결과 파일 종류(분석만이면 none 또는 chart)' },
      title: str('파일 제목(한국어, 확장자 없이)'),
      instructions: str('만들 내용·디자인 요구를 자세히: 들어갈 항목·숫자·문장, 1페이지 여부, 강조할 점, 참고 양식에서 따를 것/바꿀 것. 사용자가 준 숫자만'),
      referenceFileIds: { type: 'array', items: { type: 'string' }, description: '참고할 자료실 파일 id(첨부·검색으로 찾은 것)' },
      baseJobId: str('고칠 이전 파일 작업 id (대화 기록의 [파일 작업: id=…])'),
      company: str('회사 정보 키(예: dagym, hilink) — 공급자·로고·브랜드 색. 모르면 비움(기본 회사)'),
      design: { type: 'boolean', description: '사용자가 "새로 디자인/세련되게/처음부터" 를 원할 때만 true(더 비싼 모델). 보통은 비움' },
      confirmedCost: { type: 'boolean', description: '도구가 needConfirm 을 돌려준 뒤 사용자가 비용에 동의했을 때만 true' },
    }, required: ['mode', 'kind', 'title', 'instructions'] } },
  // V22-A·부록 2: 양식 채우기 — 코드 실행 없이 서버가 원본 양식의 칸·문장만 바꿈(서식·로고 자리·인쇄 설정 그대로, 거의 무료)
  { name: 'list_templates', description: '자료실의 문서 양식(태그·폴더 "양식", xlsx·docx) 목록. 견적서·공문·월 보고처럼 같은 양식에 값만 바꾸는 요청이면 먼저 본다.',
    input_schema: { type: 'object', properties: { query: str('찾을 말(예: 견적서)') } } },
  { name: 'read_template_layout', description: '양식 파일(xlsx·docx) 요약 지도: 시트별 값 있는 칸 주소·수식 칸·병합·인쇄 설정(xlsx), 단락 글(docx) + 고른 회사 정보. fill_template 전에 본다.',
    input_schema: { type: 'object', properties: { fileId: str('자료실 파일 id'), company: str('회사 정보 키(모르면 비움 = 기본 회사)') }, required: ['fileId'] } },
  { name: 'fill_template', description: '양식을 복사해 칸 값(xlsx: edits)·문장(docx: replacements)만 바꿔 새 파일을 바로 만든다(화면 카드, 자료실 저장은 사람이). 수식 칸은 쓰지 말 것(열 때 다시 계산됨). 공급자 칸은 read_template_layout 의 [회사] 값만, 다른 회사 정보는 남기지 말 것.',
    input_schema: { type: 'object', properties: {
      sourceFileId: str('양식 파일 id'), title: str('새 파일 제목(확장자 없이)'), company: str('회사 정보 키'),
      edits: { type: 'array', items: { type: 'object', properties: { sheet: { type: 'string' }, cell: { type: 'string' }, value: { type: ['string', 'number', 'null'] } }, required: ['cell', 'value'] }, description: 'xlsx 칸 값(예: {cell:"B3", value:"주식회사 다짐"})' },
      replacements: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] }, description: 'docx 문장 바꾸기' },
      fitOnePage: { type: 'boolean', description: 'xlsx 인쇄를 A4 한 페이지에 맞춤' },
      replaceLogo: { type: 'boolean', description: '원본 로고 그림을 고른 회사 로고로 바꿈(그림 1개·같은 형식일 때)' },
    }, required: ['sourceFileId', 'title'] } },
];

const WEB_TOOLS: AiTool[] = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 } as never,
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 } as never,
];

const SYSTEM = `당신은 사내 업무·일정 서비스 "워크인"의 AI 비서입니다. 한국 피트니스 회사(다짐·하이링크) 직원을 돕습니다.
- 사실(업무·일정·자료·매출)은 반드시 도구로 확인하고 답하세요. 도구 결과에 없는 숫자·이름·날짜를 지어내지 마세요.
- 데이터를 바꾸는 일(업무 만들기·고치기·댓글·첨부·일정 만들기·변경·취소·엑셀 보고서·문서 만들기·자료실 정리)은 propose_* 도구로만 제안하세요. 제안은 사용자가 화면의 [확인] 버튼을 눌러야 실행됩니다. 실행됐다고 말하지 말고 "확인을 누르면 반영됩니다"라고 안내하세요.
- 첨부 자료를 업무로 정리해 달라고 하면 자료 내용을 읽고 propose_create_tasks 로 담당자별 업무(체크리스트·메모·마감·첨부)를 한 번에 제안하세요.
- 일정과 업무를 함께 요청하면(예: "회의 잡고 참석자들 업무로도") propose_create_event 하나에 taskAssigneeIds 를 넣어 "일정 1 + 연결 업무"로 제안하세요. 업무 마감은 일정 시작과 같고 날짜가 연동됩니다. 같은 내용의 propose_create_task(s) 를 따로 만들지 마세요(사용자가 다른 마감을 지시한 경우만 예외). 일정 주인 본인에게는 업무를 또 만들지 않습니다.
- 회의·일정 잡기: 참석자를 list_people 로 찾고, 시간이 정해지지 않았으면 find_free_time 으로 빈 시간을 찾은 뒤 propose_create_event 로 제안하세요. 시간 변경·취소는 list_events 로 일정 id 를 찾아 propose_update_event. 충돌·연차 경고가 나오면 답에서 알려 주세요.
- 문서 비용을 아끼세요: 우리 회사 양식(자료실 "양식")에 **값만 바꾸면 되는** 요청은 list_templates(또는 첨부·참고 xlsx/docx) → read_template_layout → fill_template 로 바로 만드세요(거의 무료, 서식 그대로). 양식이 없거나, **다른 회사 양식을 "참고해서" 만드는 요청**, 구조·디자인을 새로 해야 할 때는 run_file_task(참고 파일은 referenceFileIds).
- 서식·디자인이 중요한 문서(견적서·보고서·제안서·안내문·PPT)나 "참고해서 만들어/더 세련되게/색 바꿔" 같은 요청, 엑셀·CSV 계산·차트 분석은 run_file_task 를 쓰세요(실제 파일·미리보기). 앞서 만든 파일을 고칠 때는 대화 기록의 [파일 작업: id=…] 를 baseJobId 로 mode=edit. run_file_task 를 부른 뒤에는 "만들기 시작했습니다(1~3분, 아래 카드에 미리보기가 나옵니다)"처럼 시작했다고만 말하고, "~했습니다·~뺐습니다·~맞췄습니다" 같은 완료형으로 결과를 설명하지 마세요(아직 만들지 않았음). 간단한 글 문서는 propose_create_document, 단순 데이터 표는 propose_xlsx_report.
- 최신 정보·외부 자료가 필요하면 웹 검색(켜져 있을 때)을 쓰고 출처 링크를 답에 붙이세요.
- 첨부한 이미지·문서를 보고 간단한 글 문서를 만들어 달라고 하면 propose_create_document 로, 표·숫자 위주면 propose_xlsx_report 로 제안하세요. 이미지에서 읽은 내용만 쓰고, 읽기 어려운 부분은 "확인 필요"로 표시하세요.
- 대화에 올린 자료를 자료실에 정리해 달라고 하면 list_library_folders 로 기존 폴더를 보고 propose_organize_files 로 폴더·제목·태그를 제안하세요(기존 폴더 우선). 앞선 질문의 첨부 id 는 대화 기록의 [첨부] 줄에 있습니다.
- 사람 이름은 list_people 로 id 를 찾아 쓰세요. 날짜는 Asia/Seoul 기준입니다.
- 권한 오류가 나면 그 사람이 볼 수 없는 정보라고 짧게 알려 주세요.
- 답은 한국어로 짧고 분명하게. 2~3문장마다 빈 줄로 단락을 나누고, 여러 항목은 줄머리표(-)로 한 줄씩.`;

/** confidential: 이번 차례에 기밀 자료(기밀 파일·매출)를 읽었는지 — 결과물·제안이 같은 등급을 따른다(V14 15번) */
type Ctx = { u: SessionUser; proposals: { id: string; kind: string; summary: string; preview?: unknown }[]; confidential?: boolean; threadId?: string; docJobs?: { id: string; title: string; kind: string; version: number; status: string }[] };
const clip = (s: unknown, n = 400) => (typeof s === 'string' ? (s.length > n ? s.slice(0, n) + '…' : s) : s);
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function propose(c: Ctx, kind: string, summary: string, payload: unknown, preview?: unknown) {
  const [p] = await db()<{ id: string }[]>`insert into ai_proposals (tenant, user_id, kind, summary, payload, confidential) values (${tenantOf(c.u)}, ${c.u.id}, ${kind}, ${summary}, ${db().json(payload as never)}, ${!!c.confidential}) returning id`;
  c.proposals.push({ id: p.id, kind, summary, preview });
  return { proposalId: p.id, status: '사용자 확인 대기 — 화면의 [확인]을 눌러야 실행됩니다' };
}


// ---- V14 22번: 일정 도구 ----
const isTime = (s?: string) => !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const at = (date: string, time: string) => DateTime.fromISO(`${date}T${time}`, { zone: TZ });
const fmtWhen = (s: DateTime, e: DateTime, allDay: boolean) => allDay
  ? `${s.toFormat('M/d(ccc)', { locale: 'ko' })}${e.minus({ days: 1 }).toISODate() !== s.toISODate() ? ` ~ ${e.minus({ days: 1 }).toFormat('M/d(ccc)', { locale: 'ko' })}` : ''} 종일`
  : `${s.toFormat('M/d(ccc) HH:mm', { locale: 'ko' })}~${e.toFormat('HH:mm')}`;
const REPEAT: Record<string, string> = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY' };

async function peopleNames(u: SessionUser, ids: string[]) {
  if (!ids.length) return [] as { id: string; name: string; title?: string | null }[];
  const people = (await directory(u)).users as unknown as { id: string; name: string; title?: string | null }[];
  const unknown = ids.filter((id) => !people.some((p) => p.id === id));
  if (unknown.length) throw badRequest(`찾을 수 없는 사람 id: ${unknown.join(', ')} — list_people 로 다시 찾으세요`);
  return ids.map((id) => people.find((p) => p.id === id)!);
}

/** 충돌(같은 시간 다른 일정)·연차/출장·반차/외근 경고 */
async function eventWarnings(u: SessionUser, ids: string[], s: Date, e: Date, allDay: boolean, excludeIds: string[] = []) {
  const out: string[] = [];
  if (!allDay) for (const c of await findConflicts(u, ids, s, e, excludeIds)) {
    out.push(`겹치는 일정: ${c.who.join('·') || '나'} — ${c.title} ${DateTime.fromJSDate(c.start).setZone(TZ).toFormat('HH:mm')}~${DateTime.fromJSDate(c.end).setZone(TZ).toFormat('HH:mm')}`);
  }
  const { busyOf } = await import('../availability');
  const sql = db();
  const all = [...new Set([u.id, ...ids])];
  const users = await sql<{ id: string; name: string }[]>`select id, name from users where id = any(${all}::uuid[]) and tenant = ${tenantOf(u)}`;
  const day0 = DateTime.fromJSDate(s).setZone(TZ).startOf('day'), day1 = DateTime.fromJSDate(e).setZone(TZ).endOf('day');
  const half = await sql<{ name: string; kind: string; start_at: Date; end_at: Date }[]>`select us.name, e.kind, e.start_at, e.end_at from events e join users us on us.id = e.created_by
    where e.deleted_at is null and e.kind in ('half_day', 'outside') and e.created_by = any(${users.map((x) => x.id)}::uuid[]) and e.start_at < ${e} and e.end_at > ${s}`;
  for (const x of users) {
    const { away } = await busyOf(x.id, day0.toJSDate(), day1.toJSDate(), sql).catch(() => ({ away: new Set<string>() }));
    if (away.size) out.push(`${x.name}: 연차·출장 (${[...away].sort().map((d) => DateTime.fromISO(d).toFormat('M/d')).join(', ')})`);
  }
  for (const h of half) out.push(`${h.name}: ${h.kind === 'half_day' ? '반차' : '외근'} ${DateTime.fromJSDate(h.start_at).setZone(TZ).toFormat('HH:mm')}~${DateTime.fromJSDate(h.end_at).setZone(TZ).toFormat('HH:mm')}`);
  const hol = await sql<{ d: string; name: string }[]>`select to_char(date, 'YYYY-MM-DD') d, name from holidays where date between ${day0.toISODate()} and ${day1.toISODate()} and (tenant is null or tenant = ${tenantOf(u)})`;
  for (const h of hol) out.push(`공휴일: ${h.name} (${DateTime.fromISO(h.d).toFormat('M/d')})`);
  return [...new Set(out)].slice(0, 10);
}

async function findFreeTime(u: SessionUser, input: any) {
  if (!isDate(input.from) || !isDate(input.to)) throw badRequest('날짜는 YYYY-MM-DD');
  const ids = [...new Set((Array.isArray(input.attendeeIds) ? input.attendeeIds : []).map(String))].slice(0, 20) as string[];
  const people = await peopleNames(u, ids);
  const dur = Math.min(Math.max(Number(input.durationMinutes) || 60, 15), 480);
  const now = DateTime.now().setZone(TZ);
  let from = DateTime.fromISO(input.from, { zone: TZ }).startOf('day');
  if (from < now.startOf('day')) from = now.startOf('day');
  const to = DateTime.fromISO(input.to, { zone: TZ }).plus({ days: 1 }).startOf('day');
  if (to.diff(from, 'days').days > 15) throw badRequest('최대 14일까지 찾을 수 있습니다');
  const { busyOf, WORK } = await import('../availability');
  const sql = db();
  const busy: { s: number; e: number }[] = [];
  const away = new Set<string>();
  for (const id of [u.id, ...people.map((p) => p.id)]) {
    const b = await busyOf(id, from.toJSDate(), to.toJSDate(), sql);
    busy.push(...b.intervals.map((x) => ({ s: x.s, e: x.e })));
    b.away.forEach((d) => away.add(d));
  }
  const hol = new Set((await sql<{ d: string }[]>`select to_char(date, 'YYYY-MM-DD') d from holidays where date between ${from.toISODate()} and ${to.toISODate()} and (tenant is null or tenant = ${tenantOf(u)})`).map((h) => h.d));
  const nb = isTime(input.notBefore) ? Number(input.notBefore.slice(0, 2)) * 60 + Number(input.notBefore.slice(3)) : 0;
  const na = isTime(input.notAfter) ? Number(input.notAfter.slice(0, 2)) * 60 + Number(input.notAfter.slice(3)) : 24 * 60;
  const slots: { date: string; start: string; end: string; freeUntil: string }[] = [];
  for (let d = from; d < to && slots.length < 12; d = d.plus({ days: 1 })) {
    const date = d.toISODate()!;
    if (d.weekday > 5 || hol.has(date) || away.has(date)) continue;
    for (const w of WORK) {
      let cur = d.plus({ minutes: Math.max(w.s, nb) }).toMillis();
      const end = d.plus({ minutes: Math.min(w.e, na) }).toMillis();
      cur = Math.max(cur, Math.ceil(now.toMillis() / 1800000) * 1800000); // 지금 이후, 30분 단위
      const blocks = busy.filter((x) => x.e > cur && x.s < end).sort((a, b) => a.s - b.s);
      for (const x of [...blocks, { s: end, e: end }]) {
        if (x.s - cur >= dur * 60000) {
          slots.push({ date, start: DateTime.fromMillis(cur).setZone(TZ).toFormat('HH:mm'), end: DateTime.fromMillis(cur + dur * 60000).setZone(TZ).toFormat('HH:mm'), freeUntil: DateTime.fromMillis(x.s).setZone(TZ).toFormat('HH:mm') });
          if (slots.length >= 12) break;
        }
        cur = Math.max(cur, x.e);
        if (cur >= end) break;
      }
    }
  }
  return { attendees: [u.name, ...people.map((p) => p.name)], durationMinutes: dur, slots, note: slots.length ? '근무 시간(9~12·13~18시) 기준. 비공개 일정도 바쁨으로 계산했습니다.' : '조건에 맞는 빈 시간이 없습니다. 기간·길이를 바꿔 보세요.' };
}

async function personalCalendarId(u: SessionUser) {
  const { ensurePersonalCalendar } = await import('../access');
  await ensurePersonalCalendar(u.id, u.name);
  const [c] = await db()<{ id: string }[]>`select id from calendars where type = 'personal' and owner_user_id = ${u.id}`;
  return c.id;
}

async function runTool(c: Ctx, name: string, input: any): Promise<unknown> {
  const u = c.u;
  switch (name) {
    case 'search_library': {
      const r = await listLibrary(u, { q: String(input.query ?? ''), folder: input.folder, limit: 10 }); // 등급·폴더 권한 밖 파일은 여기서 이미 빠짐
      if (r.files.some((f: any) => f.effective_security === 'confidential')) c.confidential = true;
      return r.files.map((f: any) => ({ id: f.id, title: f.title, folder: f.folder, tags: f.tags, fileName: f.file_name, type: f.mime_type, snippet: clip(f.snippet, 200) }));
    }
    case 'read_library_file': {
      const f = await loadLibraryFile(u, String(input.fileId), 'ai'); // 권한 밖이면 "자료가 없습니다"(존재도 숨김), 기밀이면 열람 기록
      if (f.effective_security === 'confidential') c.confidential = true;
      return { title: f.title, fileName: f.file_name, text: f.text_content ? clip(f.text_content, 30000) : '(본문 글자 없음 — 이미지·PDF 등은 제목·태그로만 알 수 있습니다)' };
    }
    case 'search_tasks': {
      const q = listQuery.parse({ view: input.view ?? 'all', q: input.query || undefined, assigneeId: input.assigneeId || undefined,
        from: isDate(input.from) ? input.from : undefined, to: isDate(input.to) ? input.to : undefined, limit: 40, includeDone: input.view === 'done' ? '1' : undefined });
      const rows = await listTasks(u, q);
      return rows.slice(0, 40).map((t: any) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due: t.due_date ? `${t.due_date}${t.due_time ? ' ' + String(t.due_time).slice(0, 5) : ''}` : null,
        assignee: t.assignee_name ?? null, project: t.project_name ?? null }));
    }
    case 'get_task': {
      const d = await getTaskDetail(u, String(input.taskId));
      const t: any = d.task;
      return { id: t.id, title: t.title, status: t.status, priority: t.priority, due: t.due_date, dueTime: t.due_time, assignee: t.assignee_name, requestedBy: t.requested_by_name,
        project: t.project_name, description: clip(t.description, 4000), checklist: d.checklist.map((x: any) => `${x.done ? '☑' : '☐'} ${x.text}`),
        comments: d.comments.slice(-15).map((x: any) => `${x.author_name}: ${clip(String(x.body).replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1'), 300)}`),
        attachments: d.attachments.map((a: any) => a.doc_title ?? a.file_name) };
    }
    case 'list_events': {
      if (!isDate(input.from) || !isDate(input.to)) throw badRequest('날짜는 YYYY-MM-DD');
      const from = DateTime.fromISO(input.from, { zone: TZ }), to = DateTime.fromISO(input.to, { zone: TZ }).plus({ days: 1 });
      if (to.diff(from, 'days').days > 62) throw badRequest('최대 62일');
      const evs = await listEvents(u, from.toJSDate(), to.toJSDate());
      return evs.slice(0, 100).map((e: any) => ({ id: e.id, title: e.title, start: DateTime.fromJSDate(new Date(e.start)).setZone(TZ).toFormat(e.allDay ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm'),
        end: e.allDay ? null : DateTime.fromJSDate(new Date(e.end)).setZone(TZ).toFormat('HH:mm'), allDay: e.allDay, calendar: e.calendarName ?? undefined }));
    }
    case 'list_people': {
      const d = await directory(u);
      return { people: d.users.map((x: any) => ({ id: x.id, name: x.name, title: x.title, role: x.role })), orgUnits: d.orgUnits.filter((o: any) => o.active).map((o: any) => ({ id: o.id, name: o.name, type: o.type })) };
    }
    case 'revenue_summary': {
      if (!(await canSeeRevenue(u))) throw new HttpError(403, 'forbidden', '매출 보기 권한이 없습니다(대표가 메뉴 권한에서 열 수 있음)');
      const ok = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
      if (!ok(input.fromMonth) || !ok(input.toMonth)) throw badRequest('YYYY-MM 형식');
      const rows = await db()`select o.name as site, to_char(r.month, 'YYYY-MM') as month, r.revenue::float8 revenue, r.expense::float8 expense, r.members, r.target::float8 target
        from revenue_entries r join org_units o on o.id = r.org_unit_id where o.tenant = 'default' and not o.is_demo and r.month between ${input.fromMonth + '-01'} and ${input.toMonth + '-01'} order by o.name, r.month limit 600`;
      c.confidential = true; // 매출은 기밀 근거
      return { unit: '원(회원 수는 명)', rows };
    }
    case 'find_free_time': return findFreeTime(u, input);
    case 'propose_create_event': {
      if (!isDate(input.date)) throw badRequest('날짜는 YYYY-MM-DD');
      const allDay = !!input.allDay || !isTime(input.startTime);
      let s: DateTime, e: DateTime;
      if (allDay) { s = DateTime.fromISO(input.date, { zone: TZ }); e = (isDate(input.endDate) && input.endDate >= input.date ? DateTime.fromISO(input.endDate, { zone: TZ }) : s).plus({ days: 1 }); }
      else { s = at(input.date, input.startTime); e = isTime(input.endTime) && input.endTime > input.startTime ? at(input.date, input.endTime) : s.plus({ minutes: Math.min(Math.max(Number(input.durationMinutes) || 60, 5), 24 * 60) }); }
      const ids = [...new Set((Array.isArray(input.attendeeIds) ? input.attendeeIds : []).map(String))].filter((x) => x !== u.id).slice(0, 50) as string[];
      const people = await peopleNames(u, ids);
      let calendarId: string; let calName = '내 캘린더';
      if (input.calendar === 'company') {
        const [cc] = await db()<{ id: string; name: string }[]>`select id, name from calendars where type = 'company' and tenant = ${tenantOf(u)}`;
        if (!cc) throw badRequest('회사 공용 캘린더가 없습니다');
        calendarId = cc.id; calName = cc.name;
      } else calendarId = await personalCalendarId(u);
      const until = isDate(input.repeatUntil) ? `;UNTIL=${input.repeatUntil.replace(/-/g, '')}T145959Z` : '';
      const rrule = REPEAT[input.repeat] ? REPEAT[input.repeat] + until : null;
      if (input.taskId) await getTaskDetail(u, String(input.taskId));
      // V14 47: "일정과 업무" = 일정 1 + 연결 업무(담당자별). 일정 주인은 이미 일정이 있으므로 다른 담당이 있으면 업무를 또 만들지 않는다
      let taskWho = [...new Set((Array.isArray(input.taskAssigneeIds) ? input.taskAssigneeIds : []).map(String))].slice(0, 20) as string[];
      if (taskWho.length > 1) taskWho = taskWho.filter((x) => x !== u.id);
      if (taskWho.length) {
        const dir = (await directory(u)).users as unknown as { id: string }[];
        const bad = taskWho.filter((id) => !dir.some((p) => p.id === id));
        if (bad.length) throw badRequest(`배정할 수 없는 사람 id: ${bad.join(', ')} — list_people 로 다시 찾으세요`);
      }
      const taskPeople = taskWho.length ? await peopleNames(u, taskWho.filter((x) => x !== u.id)) : [];
      const i = eventInput.parse({ calendarId, title: String(input.title ?? '').slice(0, 200), description: input.description ? String(input.description).slice(0, 5000) : undefined,
        location: input.location ? String(input.location).slice(0, 300) : undefined, allDay, start: s.toISO(), end: e.toISO(), rrule, attendeeIds: ids.length ? ids : undefined,
        reminderMinutes: Array.isArray(input.reminderMinutes) ? input.reminderMinutes.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 40320).slice(0, 5) : undefined,
        taskId: input.taskId || undefined, isPrivate: input.isPrivate ? true : undefined, kind: input.taskId ? 'normal' : undefined,
        ...(taskWho.length ? { alsoTask: true, taskAssigneeIds: taskWho, taskRequestedById: u.id } : {}) });
      const { calendarPerms } = await import('../access');
      const [cal] = await db()<any[]>`select id, type, org_unit_id, owner_user_id, tenant from calendars where id = ${calendarId}`;
      if (!(await calendarPerms(u, cal)).edit) throw new HttpError(403, 'forbidden', `${calName}에 일정을 만들 권한이 없습니다 — 내 캘린더(personal)로 만드세요`);
      const warnings = await eventWarnings(u, ids, s.toJSDate(), e.toJSDate(), allDay);
      const when = fmtWhen(s, e, allDay) + (rrule ? ` · 반복 ${({ daily: '매일', weekdays: '평일', weekly: '매주', biweekly: '격주', monthly: '매월' } as Record<string, string>)[input.repeat]}` : '');
      const linked = taskWho.length ? ` · 연결 업무 ${taskWho.length}` : '';
      return { ...(await propose(c, 'create_event', `일정 1${linked} 만들기: ${i.title} — ${when}${people.length ? ` · ${people.map((p) => p.name).join('·')}` : ''}`, i,
        { when, place: i.location || null, attendees: people.map((p) => `${p.name}${p.title ? ` · ${p.title}` : ''}`), calendar: calName, warnings,
          ...(taskWho.length ? { tasks: taskWho.map((id) => id === u.id ? '나' : (taskPeople.find((p) => p.id === id)?.name ?? '')), taskDue: when.split('~')[0] } : {}) })), warnings };
    }
    case 'propose_update_event': {
      const { event: ev, perms } = await loadEvent(u, String(input.eventId));
      if (!perms.edit) throw new HttpError(403, 'forbidden', '이 일정을 바꿀 권한이 없습니다(만든 사람·캘린더 편집 권한)');
      const series = !!ev.rrule;
      const scope = series && input.scope === 'this' ? 'this' : 'all';
      let occ: DateTime | null = null;
      if (scope === 'this') {
        if (!isDate(input.occurrenceDate)) throw badRequest('반복 일정의 이번 회차만 바꾸려면 occurrenceDate 가 필요합니다');
        const t0 = DateTime.fromJSDate(ev.start_at).setZone(TZ);
        occ = DateTime.fromISO(input.occurrenceDate, { zone: TZ }).set({ hour: t0.hour, minute: t0.minute });
      }
      const ids = (await db()<{ user_id: string }[]>`select user_id from event_attendees where event_id = ${ev.id}`).map((r) => r.user_id).filter((x) => x !== u.id);
      const scopeLabel = series ? (scope === 'this' ? ' (이번 회차만)' : ' (반복 전체)') : '';
      if (input.action === 'cancel') {
        return propose(c, 'cancel_event', `일정 취소: ${ev.title}${scopeLabel}`, { eventId: ev.id, scope: { scope, occurrenceStart: occ?.toISO() ?? undefined } },
          { when: fmtWhen(occ ?? DateTime.fromJSDate(ev.start_at).setZone(TZ), (occ ?? DateTime.fromJSDate(ev.start_at).setZone(TZ)).plus({ milliseconds: ev.end_at.getTime() - ev.start_at.getTime() }), ev.all_day), attendees: [], warnings: ids.length ? [`참석자 ${ids.length}명에게 취소 알림이 갑니다`] : [] });
      }
      if (!isDate(input.date) && !isTime(input.startTime) && !input.title && !input.location) throw badRequest('바꿀 내용이 없습니다');
      const base = occ ?? DateTime.fromJSDate(ev.start_at).setZone(TZ);
      const durMs = ev.end_at.getTime() - ev.start_at.getTime();
      const date = isDate(input.date) ? input.date : base.toISODate()!;
      let s: DateTime, e: DateTime;
      if (ev.all_day) { s = DateTime.fromISO(date, { zone: TZ }); e = s.plus({ milliseconds: durMs }); }
      else {
        s = at(date, isTime(input.startTime) ? input.startTime : base.toFormat('HH:mm'));
        e = isTime(input.endTime) && input.endTime > s.toFormat('HH:mm') ? at(date, input.endTime) : Number(input.durationMinutes) > 0 ? s.plus({ minutes: Math.min(Number(input.durationMinutes), 1440) }) : s.plus({ milliseconds: durMs });
      }
      const patch: Record<string, unknown> = { start: s.toISO(), end: e.toISO() };
      if (input.title) patch.title = String(input.title).slice(0, 200);
      if (input.location) patch.location = String(input.location).slice(0, 300);
      eventInput.partial().parse(patch);
      const warnings = await eventWarnings(u, ids, s.toJSDate(), e.toJSDate(), ev.all_day, [ev.recurring_event_id ?? ev.id]);
      const when = fmtWhen(s, e, ev.all_day);
      return { ...(await propose(c, 'update_event', `일정 변경: ${ev.title}${scopeLabel} → ${when}`, { eventId: ev.id, patch, scope: { scope, occurrenceStart: occ?.toISO() ?? undefined } },
        { when, attendees: [], warnings: [...warnings, ...(ids.length ? [`참석자 ${ids.length}명에게 변경 알림이 갑니다`] : [])] })), warnings };
    }
    case 'propose_create_task': {
      if (c.proposals.some((p) => p.kind === 'create_event' && p.summary.includes(`: ${String(input.title ?? '').trim()} —`)
          && (!isDate(input.dueDate) || p.summary.includes(`— ${Number(input.dueDate.slice(5, 7))}/${Number(input.dueDate.slice(8, 10))}(`))))
        throw badRequest('같은 내용의 일정을 이미 제안했습니다 — 업무는 propose_create_event 의 taskAssigneeIds 로 일정에 연결해 만드세요(마감이 따로 정해진 경우만 별도 업무)');
      const i = taskInput.parse({ title: input.title, description: input.description || undefined, assigneeId: input.assigneeId || undefined, dueDate: isDate(input.dueDate) ? input.dueDate : undefined,
        dueTime: /^\d{2}:\d{2}$/.test(input.dueTime ?? '') ? input.dueTime : undefined, priority: input.priority || undefined, projectId: input.projectId || undefined,
        orgUnitId: input.orgUnitId || undefined, checklist: Array.isArray(input.checklist) ? input.checklist.slice(0, 50) : undefined });
      return propose(c, 'create_task', `업무 만들기: ${i.title}${i.dueDate ? ` (마감 ${i.dueDate}${i.dueTime ? ' ' + i.dueTime : ''})` : ''}`, i);
    }
    case 'propose_create_tasks': {
      if (c.proposals.some((p) => p.kind === 'create_event' && p.summary.includes(`: ${String(input.title ?? '').trim()} —`)
          && (!isDate(input.dueDate) || p.summary.includes(`— ${Number(input.dueDate.slice(5, 7))}/${Number(input.dueDate.slice(8, 10))}(`))))
        throw badRequest('같은 내용의 일정을 이미 제안했습니다 — 업무는 propose_create_event 의 taskAssigneeIds 로 일정에 연결해 만드세요(마감이 따로 정해진 경우만 별도 업무)');
      const ids = [...new Set((Array.isArray(input.assigneeIds) ? input.assigneeIds : []).map(String))].slice(0, 50);
      if (!ids.length) throw badRequest('담당자를 1명 이상 정하세요');
      const people = (await directory(u)).users as unknown as { id: string; name: string; title?: string | null }[];
      const unknown = ids.filter((id) => !people.some((p) => p.id === id));
      if (unknown.length) throw badRequest(`배정할 수 없는 사람 id: ${unknown.join(', ')} — list_people 로 다시 찾으세요`);
      const files = (Array.isArray(input.attachFileIds) ? input.attachFileIds : []).map(String).slice(0, 5);
      for (const f of files) await loadLibraryFile(u, f, 'meta');
      const i = taskInput.parse({ title: input.title, description: input.description || undefined, dueDate: isDate(input.dueDate) ? input.dueDate : undefined,
        dueTime: /^\d{2}:\d{2}$/.test(input.dueTime ?? '') ? input.dueTime : undefined, priority: input.priority || undefined, requestedById: input.requestedById || u.id,
        checklist: Array.isArray(input.checklist) ? input.checklist.map((x: unknown) => String(x).slice(0, 300)).filter(Boolean).slice(0, 100) : undefined,
        assigneeIds: ids, approvalRequired: false });
      const names = ids.map((id) => { const p = people.find((x) => x.id === id)!; return `${p.name}${p.title ? ` · ${p.title}` : ''}`; }); // V13 13번 이름·직책
      return propose(c, 'create_tasks', `업무 ${ids.length}건 만들기: ${i.title} — ${names.join('·')}${i.dueDate ? ` (마감 ${i.dueDate}${i.dueTime ? ' ' + i.dueTime : ''})` : ''}`,
        { input: i, attachFileIds: files }, { assignees: names, due: i.dueDate ? `${i.dueDate}${i.dueTime ? ' ' + i.dueTime : ''}` : null, checklist: i.checklist ?? [], description: clip(i.description ?? '', 600), files: files.length });
    }
    case 'propose_update_task': {
      const d = await getTaskDetail(u, String(input.taskId));
      const patch = taskInput.partial().parse({ title: input.title || undefined, status: input.status || undefined, dueDate: isDate(input.dueDate) ? input.dueDate : undefined,
        dueTime: /^\d{2}:\d{2}$/.test(input.dueTime ?? '') ? input.dueTime : undefined, assigneeId: input.assigneeId || undefined, priority: input.priority || undefined });
      if (!Object.values(patch).some((v) => v !== undefined)) throw badRequest('바꿀 내용이 없습니다');
      // V14 50: 제안 단계에서 권한 확인 — 상태는 담당자만, 내용·일정은 지시자·담당자만, 담당자 변경은 지시자만
      const tk = d.task as any; const req = tk.requested_by ?? tk.created_by;
      if (patch.status && (tk.assignee_id ?? req) !== u.id && tk.status !== 'review') throw new HttpError(403, 'forbidden', '상태는 담당자만 바꿀 수 있습니다 — 담당자에게 요청하세요');
      if (!(d.perms as any).edit) throw new HttpError(403, 'forbidden', '이 업무의 내용·일정은 지시자·담당자만 바꿀 수 있습니다 — 댓글로 요청하세요');
      if (patch.assigneeId && req !== u.id) throw new HttpError(403, 'forbidden', '담당자 변경은 지시자만 할 수 있습니다 — 담당자는 "넘기기 요청"을 쓰세요');
      return propose(c, 'update_task', `업무 고치기: ${(d.task as any).title} — ${Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(', ')}`, { taskId: input.taskId, patch });
    }
    case 'propose_comment': {
      const d = await getTaskDetail(u, String(input.taskId));
      const text = String(input.text ?? '').trim().slice(0, 5000);
      if (!text) throw badRequest('내용이 없습니다');
      return propose(c, 'comment', `댓글: ${(d.task as any).title} — ${clip(text, 80)}`, { taskId: input.taskId, text });
    }
    case 'propose_attach_file': {
      const [d, f] = await Promise.all([getTaskDetail(u, String(input.taskId)), loadLibraryFile(u, String(input.fileId), 'meta')]);
      return propose(c, 'attach_file', `첨부: ${f.title} → ${(d.task as any).title}`, { taskId: input.taskId, fileId: input.fileId, fileTitle: f.title, mime: f.mime_type });
    }
    case 'propose_xlsx_report': {
      const sheets = z.array(z.object({ name: z.string().max(31), rows: z.array(z.array(z.union([z.string().max(5000), z.number(), z.null()])).max(200)).max(5000) })).min(1).max(10).parse(input.sheets);
      const title = String(input.title ?? 'AI 보고서').slice(0, 100);
      if (input.taskId) await getTaskDetail(u, String(input.taskId));
      return propose(c, 'xlsx_report', `엑셀 보고서 만들기: ${title} (${sheets.length}개 시트, ${sheets.reduce((n, s) => n + s.rows.length, 0)}줄)${input.taskId ? ' + 업무 첨부' : ''}`, { title, taskId: input.taskId || null, sheets });
    }
    case 'run_file_task': {
      const i = z.object({ mode: z.enum(['create', 'edit', 'analyze']), kind: z.enum(['xlsx', 'docx', 'pptx', 'pdf', 'chart', 'none']), title: z.string().trim().min(1).max(100),
        instructions: z.string().trim().min(1).max(20000), referenceFileIds: z.array(z.string().uuid()).max(5).optional(), baseJobId: z.string().uuid().optional(), company: z.string().max(30).optional(), design: z.boolean().optional(), confirmedCost: z.boolean().optional() }).parse(input);
      const T = await import('./threads');
      if (!(await T.aiSettings(tenantOf(u))).doc_engine) return { error: '회사 설정에서 문서 작업이 꺼져 있습니다. 대신 propose_create_document·propose_xlsx_report 를 쓰세요.' };
      const usage = await usageThisMonth(tenantOf(u));
      if (usage.costUsd >= usage.limitUsd) throw new HttpError(429, 'ai_limit', '이번 달 AI 사용 한도에 도달해 문서 작업을 시작할 수 없습니다');
      for (const f of i.referenceFileIds ?? []) { const lf = await loadLibraryFile(u, f, 'ai'); if (lf.effective_security === 'confidential') c.confidential = true; }
      // V23 4장·4.5: 예상 비용(최근 내 문서 평균, 새 디자인은 3배)이 남은 한도보다 크면 시작하지 않음, 500원 넘으면 먼저 확인
      {
        const G = await import('./guard');
        const b = await G.userAiBudget(u);
        const est = Math.round(b.avgDocKrw * (i.design ? 3 : 1));
        if (est > b.remainingKrw) return { error: `예상 비용 약 ${est.toLocaleString('ko-KR')}원이 남은 AI 한도 ${b.remainingKrw.toLocaleString('ko-KR')}원보다 커서 시작하지 않았습니다. 양식 채우기(fill_template)를 쓰거나 대표에게 한도 추가를 요청하라고 안내하세요.` };
        if (est > 500 && !i.confirmedCost) return { needConfirm: true, estimateKrw: est, note: `비용이 큰 작업입니다(약 ${est.toLocaleString('ko-KR')}원). 사용자에게 "계속할까요?"라고 물어보고, 동의하면 confirmedCost=true 로 다시 부르세요.` };
      }
      let version = 1;
      if (i.mode === 'edit') {
        if (!i.baseJobId) throw badRequest('고칠 파일(baseJobId)이 필요합니다');
        const [b] = await db()<{ version: number; status: string; confidential: boolean }[]>`select version, status, confidential from ai_doc_jobs where id = ${i.baseJobId} and user_id = ${u.id}`;
        if (!b) throw notFound();
        if (b.status !== 'done') return { error: '이전 파일 작업이 아직 끝나지 않았습니다' };
        if (b.confidential) c.confidential = true;
        version = b.version + 1;
      }
      const [j] = await db()<{ id: string }[]>`insert into ai_doc_jobs (tenant, user_id, thread_id, mode, kind, title, instructions, company_key, ref_file_ids, base_job_id, version, confidential, design)
        values (${tenantOf(u)}, ${u.id}, ${c.threadId ?? null}, ${i.mode}, ${i.kind}, ${i.title}, ${i.instructions}, ${i.company ?? null}, ${i.referenceFileIds ?? []}, ${i.baseJobId ?? null}, ${version}, ${!!c.confidential}, ${!!i.design})
        returning id`;
      (c.docJobs ??= []).push({ id: j.id, title: i.title, kind: i.kind, version, status: 'queued' });
      return { jobId: j.id, version, status: '만드는 중 — 결과(미리보기·내려받기·자료실에 저장)는 화면 카드에 1~3분 뒤 나옵니다. 아직 아무것도 만들지 않았습니다. "만들기 시작했습니다"라고만 답하고, 결과 내용(무엇을 넣고 뺐는지)을 완료형으로 말하지 마세요.' };
    }
    case 'list_templates': {
      const i = z.object({ query: z.string().max(60).optional() }).parse(input ?? {});
      const r = await listLibrary(u, { q: i.query || '양식', limit: 100 });
      const files = (r.files as any[]).filter((f) => /\.(xlsx|docx)$/i.test(f.file_name) && ((f.tags ?? []).includes('양식') || /양식|template/i.test(`${f.folder} ${f.title}`) || i.query));
      return { templates: files.slice(0, 20).map((f) => ({ id: f.id, title: f.title, file: f.file_name, folder: f.folder, tags: f.tags })) };
    }
    case 'read_template_layout': {
      const i = z.object({ fileId: z.string().uuid(), company: z.string().max(30).optional() }).parse(input);
      const f = await loadLibraryFile(u, i.fileId, 'ai');
      if (f.effective_security === 'confidential') c.confidential = true;
      const ext = String(f.file_name).split('.').pop()!.toLowerCase();
      if (ext !== 'xlsx' && ext !== 'docx') return { error: 'xlsx·docx 양식만 칸 채우기가 됩니다. 다른 형식은 run_file_task 를 쓰세요.' };
      const { getObject } = await import('../storage');
      const { templateLayout } = await import('../docFill');
      const { companyProfiles, profileText } = await import('../companyProfiles');
      const profiles = await companyProfiles(tenantOf(u));
      const co = profiles.find((p) => p.key === i.company) ?? profiles.find((p) => p.is_default) ?? null;
      return { file: f.file_name, layout: templateLayout(await getObject(f.storage_key), ext), company: co ? profileText(co) : '[회사] 회사 정보 설정 없음 — 공급자 칸은 비우고 "회사 정보 설정 필요"' };
    }
    case 'fill_template': {
      const i = z.object({ sourceFileId: z.string().uuid(), title: z.string().trim().min(1).max(100), company: z.string().max(30).optional(),
        edits: z.array(z.object({ sheet: z.string().max(60).optional(), cell: z.string().regex(/^[A-Za-z]{1,3}\d{1,7}$/), value: z.union([z.string().max(2000), z.number(), z.null()]) })).max(500).optional(),
        replacements: z.array(z.object({ from: z.string().min(1).max(500), to: z.string().max(2000) })).max(200).optional(),
        fitOnePage: z.boolean().optional(), replaceLogo: z.boolean().optional() }).parse(input);
      const f = await loadLibraryFile(u, i.sourceFileId, 'ai');
      if (f.effective_security === 'confidential') c.confidential = true;
      const ext = String(f.file_name).split('.').pop()!.toLowerCase();
      if (ext !== 'xlsx' && ext !== 'docx') return { error: 'xlsx·docx 양식만 됩니다' };
      const { getObject, putObject } = await import('../storage');
      const { fillXlsx, fillDocx } = await import('../docFill');
      let logo: { data: Buffer; ext: string } | null = null;
      if (i.replaceLogo) {
        const { companyProfiles } = await import('../companyProfiles');
        const profiles = await companyProfiles(tenantOf(u));
        const co = profiles.find((p) => p.key === i.company) ?? profiles.find((p) => p.is_default);
        if (co?.logo_file_id) { const lf = await loadLibraryFile(u, co.logo_file_id, 'ai'); logo = { data: await getObject(lf.storage_key), ext: String(lf.file_name).split('.').pop()! }; }
      }
      const src = await getObject(f.storage_key);
      // 로컬 운영 시험: 다른 회사 양식(하이링크)에 다짐 값을 채우면 수신처·품목·소개 문구가 남는다 → 다른 회사 정보가 든 양식은 채우기 금지, 참고해 새로 만들기로
      {
        const { templateLayout } = await import('../docFill');
        const { companyProfiles } = await import('../companyProfiles');
        const profiles = await companyProfiles(tenantOf(u));
        const target = profiles.find((p) => p.key === i.company) ?? profiles.find((p) => p.is_default) ?? null;
        const plain = JSON.stringify(templateLayout(src, ext)).replace(/\s+/g, '');
        const foreign = profiles.filter((p) => p.key !== target?.key && [p.name, p.biz_no].some((v) => v && v.replace(/\s+/g, '').length >= 3 && plain.includes(v.replace(/\s+/g, ''))));
        if (foreign.length) return { error: `이 양식에는 다른 회사(${foreign.map((p) => p.name).join(', ')}) 정보가 들어 있어 칸 채우기를 하지 않습니다. run_file_task(mode=create, referenceFileIds=[이 파일 id])로 "참고해서 새로 만들기"를 하세요(가벼운 모델·저렴).` };
      }
      let out: { data: Buffer; warnings: string[] };
      try { out = ext === 'xlsx' ? fillXlsx(src, i.edits ?? [], { fitOnePage: i.fitOnePage, logo }) : fillDocx(src, i.replacements ?? [], { logo }); }
      catch (e: any) { return { error: `양식을 고치지 못했습니다: ${e.message}` }; }
      const name = `${i.title.replace(/[\\/:*?"<>|]+/g, ' ').trim()}.${ext}`;
      const mime = ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const [j] = await db()<{ id: string }[]>`insert into ai_doc_jobs (tenant, user_id, thread_id, mode, kind, title, instructions, company_key, ref_file_ids, version, confidential, status, started_at, finished_at, source_file_id, summary, model)
        values (${tenantOf(u)}, ${u.id}, ${c.threadId ?? null}, 'fill', ${ext}, ${i.title}, ${'양식 채우기'}, ${i.company ?? null}, ${[i.sourceFileId]}, 1, ${!!c.confidential}, 'done', now(), now(), ${i.sourceFileId},
          ${`「${f.title}」 양식에 ${ext === 'xlsx' ? `칸 ${i.edits?.length ?? 0}개` : `문장 ${i.replacements?.length ?? 0}곳`}을 채웠습니다.${out.warnings.length ? `\n확인: ${out.warnings.slice(0, 5).join(' · ')}` : ''}`}, 'fill') returning id`;
      const key = `ai-doc/${tenantOf(u)}/${j.id}/${name}`;
      await putObject(key, out.data, mime);
      await db()`update ai_doc_jobs set result_key = ${key}, result_name = ${name}, result_mime = ${mime}, result_size = ${out.data.length} where id = ${j.id}`;
      (c.docJobs ??= []).push({ id: j.id, title: i.title, kind: ext, version: 1, status: 'done' });
      return { jobId: j.id, done: true, warnings: out.warnings, note: '파일을 만들었습니다(화면 카드에서 내려받기·자료실에 저장). 경고가 있으면 짧게 알려 주세요.' };
    }
    case 'list_library_folders': {
      const r = await listLibrary(u, { limit: 1 });
      return { folders: (r.folders as any[]).map((f) => (typeof f === 'string' ? f : f.path ?? f.folder ?? f.name)).filter(Boolean).slice(0, 200) };
    }
    case 'propose_create_document': {
      const i = z.object({ title: z.string().trim().min(1).max(100), content: z.string().min(1).max(60000), format: z.enum(['docx', 'md', 'txt']).catch('docx').default('docx'),
        folder: z.string().max(200).optional(), tags: z.array(z.string().trim().min(1).max(30)).max(8).optional(), taskId: z.string().optional() }).parse(input);
      const folder = cleanFolder(i.folder ?? '') || 'AI 문서';
      if (RANK[await folderLevel(u, folder)] < RANK.edit) throw forbidden(`"${folder}" 폴더에 저장할 권한이 없습니다`);
      if (i.taskId) await getTaskDetail(u, i.taskId);
      const fileName = `${i.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'AI 문서'}.${i.format}`;
      return propose(c, 'create_document', `문서 만들기: ${fileName} → 자료실 ${folder}${i.taskId ? ' + 업무 첨부' : ''}`, { ...i, folder, fileName },
        { folder, description: clip(i.content, 600) });
    }
    case 'propose_organize_files': {
      const items = z.array(z.object({ fileId: z.string().uuid(), folder: z.string().max(200).optional(), title: z.string().trim().max(200).optional(),
        tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(), description: z.string().max(500).optional() })).min(1).max(20).parse(input.items);
      const moves: string[] = [];
      for (const it of items) {
        const f = await loadLibraryFile(u, it.fileId, 'meta'); // 볼 수 없는 자료면 404
        if (f.created_by !== u.id && !isAdmin(u)) throw forbidden(`${f.title}: 올린 사람 또는 관리자만 정리할 수 있습니다`);
        const to = it.folder ? cleanFolder(it.folder) : '';
        if (to && RANK[await folderLevel(u, to)] < RANK.edit) throw forbidden(`"${to}" 폴더에 넣을 권한이 없습니다`);
        moves.push(`${f.title} (${f.folder || '폴더 없음'}) → ${to || '자동 정리'}${it.title && it.title !== f.title ? ` · 제목 "${it.title}"` : ''}${it.tags?.length ? ` · #${it.tags.join(' #')}` : ''}`);
      }
      return propose(c, 'organize_files', `자료실 정리: ${items.length}개 — ${moves[0]}${items.length > 1 ? ` 외 ${items.length - 1}개` : ''}`, { items }, { moves });
    }
  }
  throw badRequest(`모르는 도구: ${name}`);
}

const chatInput = z.object({
  /** V14 2번: 보관된 대화로 이어 묻기 — threadId + text (예전 방식 messages 도 받음) */
  threadId: z.string().uuid().optional(),
  text: z.string().max(20000).optional(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(8000) })).min(1).max(30).optional(),
  taskId: z.string().uuid().optional(),
  /** V14 11번: 어느 화면에서 물었는지 — id 만 받고 서버가 권한 안에서 조회 */
  context: z.object({ page: z.enum(['home', 'tasks', 'task', 'calendar', 'library', 'revenue', 'reports', 'messages', 'other']), id: z.string().max(80).optional() }).optional(),
  /** V12 8번: 이번 질문에 붙인 자료실 파일(최대 5개) — 이미지는 비전, PDF 는 문서, 그 밖은 추출한 글자로 전달 */
  fileIds: z.array(z.string().uuid()).max(5).optional(),
  /** 부록 A3: 마지막 질문을 고쳐 보내기·다시 답하기 — 그 질문과 이후 답변·확정 안 된 제안을 지우고 새로 답한다 */
  replaceLast: z.boolean().optional(),
  /** 바꿀 원래 질문 — 서버의 마지막 질문과 같을 때만 지운다(멈춘 요청이 늦게 저장되는 경우 엉뚱한 질문을 지우지 않게) */
  replaceText: z.string().max(20000).optional(),
});
export { chatInput };

const IMG = /^image\/(png|jpe?g|gif|webp)$/;
/** 첨부 파일 → Claude 입력 블록 (회사 자료실 권한 그대로, 큰 파일은 글자만) */
/** 다른 기능(매출 자료로 입력)에서도 같은 첨부 → 입력 블록 변환을 쓴다 */
export const fileBlocksFor = (u: SessionUser, ids: string[]) => fileBlocks(u, ids);
async function fileBlocks(u: SessionUser, ids: string[]) {
  const { getObject } = await import('../storage');
  const blocks: any[] = [];
  const notes: string[] = [];
  let confidential = false;
  for (const id of ids) {
    const f = await loadLibraryFile(u, id, 'ai');
    if (f.effective_security === 'confidential') confidential = true;
    notes.push(`- id=${f.id} · ${f.title} (${f.file_name})`);
    const size = Number(f.size_bytes);
    if (IMG.test(f.mime_type) && size <= 4.5 * 1024 * 1024) {
      const data = (await getObject(f.storage_key)).toString('base64');
      blocks.push({ type: 'image', source: { type: 'base64', media_type: f.mime_type === 'image/jpg' ? 'image/jpeg' : f.mime_type, data } });
    } else if (f.mime_type === 'application/pdf' && size <= 20 * 1024 * 1024) {
      const data = (await getObject(f.storage_key)).toString('base64');
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: f.title });
    } else if (f.text_content) {
      blocks.push({ type: 'text', text: `[첨부 자료: ${f.title}]\n${String(f.text_content).slice(0, 60000)}` });
    } else notes.push(`  (이 파일은 내용을 읽을 수 없습니다 — 이름만 참고)`);
  }
  return { confidential, blocks, note: `사용자가 이번에 자료를 첨부했습니다. 업무에 붙일 때 아래 id 를 attachFileIds 로 쓰세요.\n${notes.join('\n')}` };
}

/**
 * V22 부록 2 ⑥: 문서 요청(견적서·공문·엑셀 등 + 만들기/채우기/고치기)은 대화도 싸게 — 가벼운 모델(Haiku)·짧은 지시·문서 도구만·최근 대화 6개.
 * 목표 대화 건당 $0.02 이하. 분류는 규칙(추가 AI 호출 없음)
 */
const DOC_NOUN = /(견적서|거래\s*명세서|명세서|공문|안내문|보고서|제안서|계약서|문서|엑셀|워드|ppt|피피티|파워포인트|pdf|양식|발주서|청구서|영수증|xlsx|docx)/i;
const DOC_VERB = /(만들|작성|채워|채우|바꿔|고쳐|다듬|수정|뽑아|써\s*줘|생성|디자인)/;
export const isDocRequest = (text: string) => (DOC_NOUN.test(text) && DOC_VERB.test(text)) || /^「[^」]+」\s*v\d+을/.test(text.trim());
const DOC_TOOL_NAMES = new Set(['run_file_task', 'list_templates', 'read_template_layout', 'fill_template', 'search_library', 'read_library_file', 'list_library_folders',
  'propose_create_document', 'propose_xlsx_report', 'propose_organize_files', 'propose_attach_file', 'search_tasks', 'get_task']);
const DOC_SYSTEM = `당신은 사내 서비스 "워크인"의 문서 담당 AI 입니다. 이번 요청은 문서·파일 만들기입니다.
- 우리 회사 양식(자료실 "양식")에 값만 바꾸면 되면: list_templates → read_template_layout → fill_template (거의 무료, 서식 그대로).
- 양식이 없거나, 다른 회사 양식을 "참고해서" 만들거나, 새 디자인이면: run_file_task (참고 파일은 referenceFileIds, "새로 디자인"만 design=true). 앞서 만든 파일을 고칠 때는 대화 기록의 [파일 작업: id=…] 를 baseJobId 로 mode=edit.
- 참고 자료는 첨부·search_library 로 찾고, 숫자·이름은 사용자가 준 것만 씁니다.
- 서식이 중요하지 않은 간단한 글 문서(회의록·메모)는 propose_create_document, 데이터 표는 propose_xlsx_report, 자료실 정리는 propose_organize_files(확인을 눌러야 반영). 첨부 id 는 대화 기록의 [첨부] 줄.
- run_file_task 뒤에는 "만들기 시작했습니다(1~3분, 아래 카드)"라고만 짧게. fill_template 뒤에는 결과·경고를 한두 줄로.
- 답은 한국어로 짧게.`;

export async function chat(u: SessionUser, i: z.infer<typeof chatInput>, providerArg?: AiProvider, signal?: AbortSignal) {
  denyDemo(u);
  if (!aiEnabled()) throw notFound();
  await (await import('../menuPerms')).requireMenu(u, 'assistant', 'use'); // V13 메뉴 권한
  const tenant = tenantOf(u);
  const usage = await usageThisMonth(tenant);
  if (usage.costUsd >= usage.limitUsd) throw new HttpError(429, 'ai_limit', `이번 달 AI 사용 한도($${usage.limitUsd})에 도달했습니다. 대표에게 한도 조정을 요청하세요.`);
  const userText = (i.text ?? (i.messages?.[i.messages.length - 1]?.role === 'user' ? i.messages[i.messages.length - 1].text : '')).trim();
  if (!userText) throw badRequest('질문을 입력하세요');
  await (await import('../plans')).assertAiRequest(u); // V10 요금제 월 AI 요청 수
  const G = await import('./guard');
  await G.assertAiCredit();
  await G.assertUserBudget(u); // V23 4장: 사람별 월·하루 한도
  const requestId = crypto.randomUUID();
  // V14 2·5번: 대화 보관 + 사전 점검(입력 길이·하루 한도·반복·업무 무관 질문)
  const T = await import('./threads');
  if (i.threadId) await T.ownThread(u, i.threadId);
  let kept: string[] = [];
  if (i.replaceLast && i.threadId) { // 부록 A3: 고쳐 보내기 — 이전 첨부는 그대로 다시 쓴다
    const r = await T.dropLastTurn(i.threadId, i.replaceText);
    kept = r.kept;
    if (!i.fileIds?.length && r.fileIds.length) i = { ...i, fileIds: r.fileIds };
  }
  const blocked = await T.precheck(u, userText, i.threadId ?? null, !!i.fileIds?.length);
  const threadId = i.threadId ?? (await T.startThread(u, userText, i.taskId ?? null, db(), i.context));
  const fileNames = i.fileIds?.length ? (await db()<{ file_name: string }[]>`select file_name from library_files where id = any(${i.fileIds}::uuid[])`).map((f) => f.file_name) : [];
  if (blocked) {
    await T.saveTurn(u, threadId, { text: userText, fileIds: i.fileIds, fileNames }, { text: blocked, status: 'blocked', reason: blocked });
    return { reply: blocked, proposals: [], tools: [], threadId, blocked: true };
  }
  const hist = i.threadId ? await T.threadHistory(i.threadId) : null;
  const settings = await T.aiSettings(tenant);
  // 문서 요청이면 가벼운 모델·문서 도구만(부록 2 ⑥) — 문서 작업이 꺼져 있으면 보통 경로
  const docMode = !providerArg && settings.doc_engine && isDocRequest(userText);
  const provider: AiProvider = providerArg ?? anthropicProvider(docMode ? { tier: 'fast' } : {});

  let context = '';
  if (i.taskId) {
    const d = await getTaskDetail(u, i.taskId); // 볼 수 없는 업무면 여기서 404
    context = `\n지금 사용자가 보고 있는 업무: id=${i.taskId}, 제목="${(d.task as any).title}". "이 업무"는 이것을 뜻합니다.`;
  }
  if (i.context && !i.taskId) context += await pageContext(u, i.context);
  const system = `${docMode ? DOC_SYSTEM : SYSTEM}\n\n오늘: ${todaySeoul()} (${DateTime.now().setZone(TZ).toFormat('cccc', { locale: 'ko' })}), 사용자: ${u.name}(id=${u.id}, 역할=${u.role}).${context}${hist?.summary ? `\n\n이 대화의 앞부분 요약:\n${hist.summary}` : ''}`;
  // 문맥: 보관된 대화면 최근 20개 + 요약, 예전 방식이면 화면이 보낸 것
  const recent = hist ? (docMode ? hist.messages.slice(-6) : hist.messages) : [];
  while (docMode && recent[0]?.role === 'assistant') recent.shift(); // 대화는 사용자 말로 시작
  const messages: AiMessage[] = hist ? [...recent.map((m) => ({ role: m.role, content: m.text })), { role: 'user', content: userText }]
    : (i.messages ?? [{ role: 'user' as const, text: userText }]).map((m) => ({ role: m.role, content: m.text }));
  let fbConf = false;
  if (i.fileIds?.length) {
    const fb = await fileBlocks(u, i.fileIds);
    fbConf = fb.confidential;
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = { role: 'user', content: [...fb.blocks, { type: 'text', text: `${fb.note}\n\n${last.content as string}` }] as never };
  }
  const c: Ctx = { u, proposals: [], confidential: false, threadId, docJobs: [] };
  // V22 웹 검색·페이지 읽기 (회사 설정으로 끄기)
  const tools = docMode ? TOOLS.filter((t) => DOC_TOOL_NAMES.has(t.name)) : settings.web_tools ? [...TOOLS, ...WEB_TOOLS] : TOOLS;
  if (i.fileIds?.length && fbConf) c.confidential = true;
  const sql = db();
  const steps: string[] = [];
  let reply = '';
  let turnCost = 0, inTok = 0, outTok = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal?.aborted) break;
    const r = await provider.chat({ system, messages, tools, signal }).catch((e: any) => {
      if (signal?.aborted) return null; // 부록 A2: 사용자가 멈춤
      if (e instanceof HttpError) throw e; // V23-1: 크레딧 부족·요청 한도·일시 장애 문구
      throw new HttpError(502, 'ai_unavailable', `AI 서버 응답 오류${e?.status ? ` (${e.status})` : ''}. 잠시 후 다시 시도하세요.`);
    });
    if (!r) break;
    const used = r.usage;
    turnCost += costUsd(r.model ?? provider.model, used); inTok += used.input_tokens; outTok += used.output_tokens;
    await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose, web_searches)
      values (${tenant}, ${u.id}, ${requestId}, ${provider.name}, ${r.model ?? provider.model}, ${used.input_tokens}, ${used.output_tokens}, ${used.cache_read_input_tokens ?? 0},
        ${used.cache_creation_input_tokens ?? 0}, ${costUsd(r.model ?? provider.model, used)}, 'assistant', ${(used as any).server_tool_use?.web_search_requests ?? 0})`;
    const text = r.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (r.stop_reason === 'refusal') { reply = '이 요청은 처리할 수 없습니다. 다르게 요청해 주세요.'; break; }
    if (r.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: r.content as never }); continue; }
    if (r.stop_reason !== 'tool_use') { reply = text || (r.stop_reason === 'max_tokens' ? '답이 너무 길어 중간에 끊겼습니다. 범위를 좁혀 다시 요청해 주세요.' : ''); break; }
    messages.push({ role: 'assistant', content: r.content as never });
    const uses = r.content.filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use');
    const results = await Promise.all(uses.map(async (t) => {
      steps.push(t.name);
      try {
        return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify(await runTool(c, t.name, t.input)) };
      } catch (e: any) {
        const msg = e instanceof HttpError ? (e.status === 404 ? '찾을 수 없거나 볼 권한이 없습니다' : e.message) : e?.issues ? '입력값이 올바르지 않습니다' : '처리 중 오류';
        return { type: 'tool_result' as const, tool_use_id: t.id, content: msg, is_error: true };
      }
    }));
    messages.push({ role: 'user', content: results });
    if (step === MAX_STEPS - 1) reply = text || '여러 단계를 거쳤지만 끝내지 못했습니다. 요청을 나눠서 다시 해 주세요.';
  }
  if (signal?.aborted) { // 부록 A2: 멈춘 질문 — 만들던 제안은 버리고(실행 안 됨) "멈춤"만 남긴다. 사용량은 쓴 만큼 이미 기록됨
    if (c.proposals.length) await sql`update ai_proposals set status = 'cancelled', decided_at = now() where id = any(${c.proposals.map((p) => p.id)}::uuid[]) and status = 'pending'`;
    if (c.docJobs?.length) await sql`update ai_doc_jobs set status = 'failed', error = '멈춤', finished_at = now() where id = any(${c.docJobs.map((j) => j.id)}::uuid[]) and status = 'queued'`;
    await T.saveTurn(u, threadId, { text: userText, fileIds: i.fileIds, fileNames }, { text: '(멈춤)', status: 'stopped', cost: turnCost, inTok, outTok });
    await audit(sql, u.id, 'ai.chat_stopped', null, null, { threadId, steps }, null);
    return { reply: '', proposals: [], tools: steps, threadId, stopped: true };
  }
  await audit(sql, u.id, 'ai.chat', i.taskId ? 'task' : null, i.taskId ?? null, { tools: steps, proposals: c.proposals.map((p) => p.id), threadId }, null);
  await T.saveTurn(u, threadId, { text: userText, fileIds: i.fileIds, fileNames }, { text: reply, proposalIds: c.proposals.map((p) => p.id), docJobIds: c.docJobs?.map((j) => j.id), cost: turnCost, inTok, outTok });
  if (c.confidential) await sql`update ai_threads set confidential = true where id = ${threadId}`; // 사용 내역에서 기밀 권한 없는 사람에게 내용 가림
  await T.maybeSummarize(u, threadId);
  const budget = await G.userBudgetAlerts(u).catch(() => null); // 80%·100% 알림
  return { reply, proposals: c.proposals, tools: steps, threadId, costKrw: Math.round(turnCost * usdKrw()), budget, ...(kept.length ? { kept } : {}), ...(c.docJobs?.length ? { docJobs: c.docJobs } : {}) };
}

// ---------------- 제안 실행 (사람이 [확인]) ----------------
export async function decideProposal(u: SessionUser, id: string, accept: boolean) {
  denyDemo(u);
  const sql = db();
  const [p] = await sql<any[]>`select * from ai_proposals where id = ${id} and user_id = ${u.id}`;
  if (!p) throw notFound('제안이 없습니다');
  if (p.status !== 'pending') throw badRequest('이미 처리한 제안입니다');
  if (!accept) {
    await sql`update ai_proposals set status = 'cancelled', decided_at = now() where id = ${id}`;
    return { ok: true, status: 'cancelled' };
  }
  const x = p.payload;
  let result: Record<string, unknown>;
  try {
    // V14 15번: 기밀 자료(기밀 파일·매출)를 근거로 만든 제안 — 받는 사람도 기밀 열람 권한이 있어야 한다(서버 강제)
    if (p.confidential) {
      const { userSeesConfidential, assertConfidentialAudience } = await import('../library');
      const need = (ids: unknown[]) => Promise.all(ids.filter(Boolean).map(async (id) => { if (!(await userSeesConfidential(String(id)))) throw forbidden('기밀 자료를 근거로 한 내용이라 기밀 열람 권한이 없는 사람에게 줄 수 없습니다'); }));
      if (p.kind === 'create_task') await need([x.assigneeId, x.requestedById, ...(x.collaboratorIds ?? [])]);
      if (p.kind === 'create_event') await need(x.attendeeIds ?? []);
      if (p.kind === 'create_tasks') await need([...(x.input?.assigneeIds ?? []), x.input?.requestedById]);
      if (p.kind === 'update_task' || p.kind === 'comment') await assertConfidentialAudience(x.taskId, [x.patch?.assigneeId].filter(Boolean));
      if ((p.kind === 'xlsx_report' || p.kind === 'create_document') && x.taskId) await assertConfidentialAudience(x.taskId);
    }
    switch (p.kind) {
      case 'create_task': { const r: any = await createTask(u, taskInput.parse(x)); result = { taskId: r.id, link: `/tasks/${r.id}` }; break; }
      case 'create_tasks': {
        const { createTasksForAssignees } = await import('../tasks');
        const r: any = await createTasksForAssignees(u, taskInput.parse(x.input));
        const ids: string[] = r.ids ?? [r.id];
        for (const t of ids) for (const f of x.attachFileIds ?? []) await attachLibraryToTask(u, f, t);
        result = { taskIds: ids, link: ids.length === 1 ? `/tasks/${ids[0]}` : `/tasks?view=requested` };
        break;
      }
      case 'update_task': { await updateTask(u, x.taskId, taskInput.partial().parse(x.patch)); result = { taskId: x.taskId, link: `/tasks/${x.taskId}` }; break; }
      case 'comment': { const r = await addComment(u, x.taskId, `${x.text}\n\n— AI 제안을 확인해 작성`); result = { commentId: r.id, link: `/tasks/${x.taskId}#c-${r.id}` }; break; }
      case 'attach_file': { const r = await attachLibraryToTask(u, x.fileId, x.taskId); result = { attachmentId: r.id, link: `/tasks/${x.taskId}` }; break; }
      case 'xlsx_report': {
        const buf = writeXlsx(x.sheets);
        const fileName = `${x.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'AI 보고서'}.xlsx`;
        const f = await saveGeneratedFile(u, { fileName, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: buf, title: x.title, folder: 'AI 보고서', tags: ['AI'], description: 'AI 비서가 만든 보고서(사용자 확인)', security: p.confidential ? 'confidential' : undefined });
        if (x.taskId) await attachLibraryToTask(u, f.id, x.taskId);
        result = { fileId: f.id, link: x.taskId ? `/tasks/${x.taskId}` : `/library?file=${f.id}` };
        break;
      }
      case 'create_document': {
        const { writeDocx } = await import('../docx');
        const data = x.format === 'docx' ? writeDocx(x.title, x.content) : Buffer.from((x.format === 'md' ? `# ${x.title}\n\n` : `${x.title}\n\n`) + x.content, 'utf8');
        const mime = x.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : x.format === 'md' ? 'text/markdown' : 'text/plain';
        if (RANK[await folderLevel(u, x.folder)] < RANK.edit) throw forbidden(`"${x.folder}" 폴더에 저장할 권한이 없습니다`);
        const f = await saveGeneratedFile(u, { fileName: x.fileName, mime, data, title: x.title, folder: x.folder, tags: ['AI', ...(x.tags ?? [])].slice(0, 8), description: 'AI 비서가 만든 문서(사용자 확인)', security: p.confidential ? 'confidential' : undefined });
        await sql`insert into library_folders (tenant, path, created_by) values (${tenantOf(u)}, ${x.folder}, ${u.id}) on conflict do nothing`;
        if (x.taskId) await attachLibraryToTask(u, f.id, x.taskId);
        result = { fileId: f.id, link: x.taskId ? `/tasks/${x.taskId}` : `/library?file=${f.id}` };
        break;
      }
      case 'organize_files': {
        const done: { id: string; folder: string }[] = [];
        for (const it of x.items as { fileId: string; folder?: string; title?: string; tags?: string[]; description?: string }[]) {
          if (it.folder) {
            const f = await loadLibraryFile(u, it.fileId, 'meta');
            await updateLibraryFile(u, it.fileId, { folder: it.folder, ...(it.title ? { title: it.title } : {}), tags: [...new Set([...f.tags.filter((t: string) => t !== 'AI 첨부'), ...(it.tags ?? [])])].slice(0, 20),
              ...(it.description && !f.description ? { description: it.description } : {}) });
            const folder = cleanFolder(it.folder);
            if (folder) await sql`insert into library_folders (tenant, path, created_by) values (${tenantOf(u)}, ${folder}, ${u.id}) on conflict do nothing`;
            done.push({ id: it.fileId, folder });
          } else {
            const r = await organizeLibraryFile(u, it.fileId);
            done.push({ id: it.fileId, folder: r.folder });
          }
          // 대화 첨부였던 자료도 이제 일반 자료(전체 정리 대상)로
          await sql`update library_files set source = 'upload' where id = ${it.fileId} and source = 'ai_attach'`;
        }
        result = { files: done, link: done.length === 1 ? `/library?file=${done[0].id}` : `/library${done[0]?.folder ? `?folder=${encodeURIComponent(done[0].folder)}` : ''}` };
        break;
      }
      case 'create_event': { const r = await createEvent(u, eventInput.parse(x)); result = { eventId: r.id, link: `/calendar?event=${r.id}` }; break; }
      case 'update_event': { await updateEvent(u, x.eventId, eventInput.partial().parse(x.patch), x.scope); result = { eventId: x.eventId, link: `/calendar?event=${x.eventId}` }; break; }
      case 'cancel_event': { await deleteEvent(u, x.eventId, x.scope); result = { eventId: x.eventId, link: '/calendar' }; break; }
      default: throw badRequest('모르는 제안');
    }
  } catch (e) {
    await sql`update ai_proposals set status = 'failed', result = ${sql.json({ error: (e as Error).message })}, decided_at = now() where id = ${id}`;
    throw e;
  }
  await sql`update ai_proposals set status = 'done', result = ${sql.json(result as never)}, decided_at = now() where id = ${id}`;
  await audit(sql, u.id, 'ai.proposal_done', null, null, { id, kind: p.kind, result }, null);
  return { ok: true, status: 'done', ...result };
}

// ---------------- V12 8번 "📎 자료로 채우기": 첨부를 읽어 업무 등록 칸을 채움(저장은 사람이) ----------------
export const fillInput = z.object({ fileIds: z.array(z.string().uuid()).min(1).max(5), hint: z.string().max(2000).optional() });
const FILL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, description: { type: 'string' },
    checklist: { type: 'array', items: { type: 'string' } },
    dueDate: { type: ['string', 'null'] }, dueTime: { type: ['string', 'null'] },
  },
  required: ['title', 'description', 'checklist', 'dueDate', 'dueTime'],
};
export async function fillFromFiles(u: SessionUser, i: z.infer<typeof fillInput>, provider: AiProvider = anthropicProvider()) {
  denyDemo(u);
  if (!aiEnabled()) throw notFound();
  await (await import('../menuPerms')).requireMenu(u, 'assistant', 'use');
  const tenant = tenantOf(u);
  const usage = await usageThisMonth(tenant);
  if (usage.costUsd >= usage.limitUsd) throw new HttpError(429, 'ai_limit', `이번 달 AI 사용 한도($${usage.limitUsd})에 도달했습니다.`);
  await (await import('../plans')).assertAiRequest(u);
  const fb = await fileBlocks(u, i.fileIds);
  const system = `워크인 업무 등록 도우미입니다. 첨부 자료를 읽고 업무 한 건의 제목(짧게), 설명(핵심 요약·메모, 한국어), 체크리스트(자료의 각 항목·할 일, 최대 30개), 자료에 마감이 있으면 dueDate(YYYY-MM-DD)·dueTime(HH:MM)을 JSON 으로만 답하세요. 없는 내용은 지어내지 말고 null. 오늘: ${todaySeoul()} (Asia/Seoul).`;
  const r = await provider.chat({ system, tools: [], format: FILL_SCHEMA,
    messages: [{ role: 'user', content: [...fb.blocks, { type: 'text', text: `${i.hint ? `요청: ${i.hint}\n` : ''}이 자료로 업무 등록 칸을 채워 주세요.` }] as never }] });
  await db()`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenant}, ${u.id}, ${crypto.randomUUID()}, ${provider.name}, ${r.model ?? provider.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0},
      ${r.usage.cache_creation_input_tokens ?? 0}, ${costUsd(r.model ?? provider.model, r.usage)}, 'fill')`;
  if (r.stop_reason === 'refusal') throw badRequest('이 자료로는 채울 수 없습니다');
  const text = r.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
  let j: any;
  try { j = JSON.parse(text); } catch { throw new HttpError(502, 'ai_bad_output', 'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.'); }
  return {
    title: String(j.title ?? '').slice(0, 200), description: String(j.description ?? '').slice(0, 20000),
    checklist: (Array.isArray(j.checklist) ? j.checklist : []).map((x: unknown) => String(x).slice(0, 300)).filter(Boolean).slice(0, 50),
    dueDate: isDate(j.dueDate) ? j.dueDate : null, dueTime: /^\d{2}:\d{2}$/.test(j.dueTime ?? '') ? j.dueTime : null,
  };
}

/** V14 11번: 화면 맥락 — id 로 권한 안에서만 조회해 한 줄로. 볼 수 없으면 맥락 없이(404 를 드러내지 않음) */
async function pageContext(u: SessionUser, c: { page: string; id?: string }) {
  const PAGE: Record<string, string> = { home: '홈(오늘 할 일)', tasks: '업무 목록', calendar: '캘린더', library: '자료실', revenue: '매출', reports: '주간 보고', messages: '메시지', other: '' };
  try {
    if (c.page === 'library' && c.id) { const f = await loadLibraryFile(u, c.id, 'meta'); return `\n지금 사용자가 보고 있는 자료실 파일: id=${f.id}, 제목="${f.title}". "이 자료"는 이것을 뜻합니다.`; }
    if (c.page === 'messages' && c.id) {
      const { roomDetail } = await import('../chat');
      const r = await roomDetail(u, c.id, {});
      const recent = r.messages.slice(-15).filter((m: any) => !m.deleted).map((m: any) => `${m.author_name}: ${String(m.body).replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1').slice(0, 200)}`).join('\n');
      return `\n지금 사용자가 보고 있는 대화방: "${r.room.name}". 최근 메시지(요약·업무로 만들기 요청에 참고):\n${recent}`;
    }
    if (c.page === 'calendar' && c.id && /^\d{4}-\d{2}-\d{2}$/.test(c.id)) return `\n지금 사용자가 캘린더에서 ${c.id} 를 보고 있습니다. "이 날"은 이 날짜입니다.`;
    if (c.page === 'revenue' && !(await canSeeRevenue(u))) return '';
  } catch { return ''; }
  return PAGE[c.page] ? `\n지금 사용자가 보고 있는 화면: ${PAGE[c.page]}.` : '';
}
