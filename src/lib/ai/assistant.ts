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
import { listLibrary, loadLibraryFile, attachLibraryToTask, saveGeneratedFile, tenantOf, folderLevel, updateLibraryFile, organizeLibraryFile, cleanFolder, listConfidentialSuggestions, getAttachToLibrary, setAttachToLibrary, SEC_LABEL } from '../library';
import { getAiProfile, saveAiProfile } from './persona';
import { quoteInput, previewQuote, createQuote, saveTemplate, templateInput, listTemplates, won } from '../quotes';
import { companyProfiles } from '../companyProfiles';
import { RANK } from '../menuPerms';
import { writeXlsx } from '../xlsx';
import { anthropicProvider, aiEnabled, modelFor, costUsd, usdKrw, type AiMessage, type AiProvider, type AiTool } from './provider';
import type { SessionUser } from '../types';
import { readNotice, searchNotices } from '../sales/noticeLookup';

/**
 * V9 워크인 AI 비서. 요청한 사람의 권한으로만 데이터를 읽고(서버 함수 재사용 — 권한 검사 그대로),
 * 쓰기(업무 만들기·고치기·댓글·첨부·보고서)는 "AI 제안"으로만 만들고 사람이 [확인]해야 실행한다.
 */
const TZ = 'Asia/Seoul';
const MAX_STEPS = 8;

/** 이번 달 회사 AI 사용($·요청·토큰) + 대표 10/24 ② 회사 월 AI 예산(원, ai/companyBudget). limitUsd = 예산을 달러로(무제한이면 0) — 예전 화면 호환 */
export async function usageThisMonth(tenant: string) {
  const sql = db();
  const start = DateTime.now().setZone(TZ).startOf('month').toJSDate();
  const [[u], budget] = await Promise.all([
    sql<{ cost: number; requests: number; tokens: number }[]>`select coalesce(sum(cost_usd), 0)::float8 cost, count(*)::int requests,
      coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::float8 tokens from ai_usage where tenant = ${tenant} and created_at >= ${start}`,
    (await import('./companyBudget')).companyAiBudget(tenant, sql),
  ]);
  return { costUsd: Math.round(u.cost * 10000) / 10000, requests: u.requests, tokens: u.tokens, limitUsd: budget.limitKrw === null ? 0 : Math.round((budget.limitKrw / usdKrw()) * 100) / 100, budget };
}

export async function aiStatus(u: SessionUser) {
  const { menuLevel } = await import('../menuPerms');
  // 로컬 10/20(심사): 체험 조직(심사 계정)도 AI 비서를 봄 — 플랫폼 키, 'demo' 회사 월 한도·하루 횟수는 review.ts 가 작게 잡아 둠
  const enabled = aiEnabled() && (await menuLevel(u, 'assistant')) === 'use';
  if (!enabled) return { enabled: false };
  const usage = await usageThisMonth(tenantOf(u));
  // V10 요금제 월 AI 요청 수
  const { effectiveLimits, currentUsage } = await import('../plans');
  const [{ limits }, cu] = await Promise.all([effectiveLimits(tenantOf(u)), currentUsage(tenantOf(u))]);
  const quota = { used: cu.aiRequests, limit: limits.aiRequests };
  const G = await import('./guard');
  const [budget, creditUntil] = await Promise.all([G.userAiBudget(u), G.creditBlockedUntil()]);
  // 대표 10/24 ② 회사 월 AI 예산: 직원에게는 %·다시 채워지는 날만(금액은 관리자만), 다 썼으면 안내 문구
  const B = await import('./companyBudget');
  const cb = usage.budget;
  const company = { pct: cb.pct, over: cb.over, resetLabel: cb.resetLabel, message: cb.over ? B.budgetMessage(cb) : null, ...(isAdmin(u) ? { limitKrw: cb.limitKrw, usedKrw: cb.usedKrw, leftKrw: cb.leftKrw } : {}) };
  const { budget: _cb, ...usageOut } = usage;
  return { enabled: true, model: modelFor(), usage: isAdmin(u) ? usageOut : { ...usageOut, costUsd: undefined, tokens: undefined }, quota,
    budget, company, creditBlocked: !!creditUntil, creditMessage: creditUntil ? G.CREDIT_MSG : null,
    overLimit: cb.over || (quota.limit !== null && quota.used >= quota.limit) || budget.usedKrw >= budget.limitKrw || !!creditUntil, canSetLimit: u.role === 'owner' };
}
/** 대표가 정하는 회사 AI 월 한도($) — null 이면 지움(요금제 예산 그대로, 예전 요금제는 기본 한도) */
export async function setLimit(u: SessionUser, monthlyUsd: number | null) {
  if (u.role !== 'owner') throw new HttpError(403, 'forbidden', '대표만 바꿀 수 있습니다');
  const sql = db();
  if (monthlyUsd === null) await sql`delete from ai_limits where tenant = ${tenantOf(u)}`;
  else await sql`insert into ai_limits (tenant, monthly_usd, updated_by) values (${tenantOf(u)}, ${monthlyUsd}, ${u.id})
    on conflict (tenant) do update set monthly_usd = excluded.monthly_usd, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'ai.limit', null, null, { monthlyUsd }, null);
  return { ok: true };
}

// ---------------- 도구 ----------------
const str = (d: string) => ({ type: 'string' as const, description: d });
const TOOLS: AiTool[] = [
  { name: 'search_library', description: '회사 자료실(로고·소개서·단가표·보고서 등)에서 제목·폴더·태그·본문으로 자료를 찾는다. 결과의 id 로 읽거나 업무에 첨부할 수 있다.',
    input_schema: { type: 'object', properties: { query: str('찾을 말 (예: "회사 로고", "단가표")'), folder: str('폴더로 좁히기 (선택)') }, required: ['query'] } },
  { name: 'read_library_file', description: '자료실 파일의 본문 글자를 읽는다(문서·엑셀·텍스트). 이미지·PDF 는 본문이 없을 수 있다.',
    input_schema: { type: 'object', properties: { fileId: str('자료 id') }, required: ['fileId'] } },
  { name: 'search_tasks', description: '사용자가 볼 수 있는 업무를 찾는다.',
    input_schema: { type: 'object', properties: {
      query: str('제목 검색어 (선택)'),
      view: { type: 'string', enum: ['all', 'my', 'today', 'overdue', 'week', 'review', 'requested', 'done'], description: 'my=내 담당, requested=내가 요청한 업무, done=완료' },
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
      checklist: { type: 'array', items: { type: 'string' }, description: '체크리스트 (선택). 고객에게 보여 주는 단계는 "데모" 대신 "시연"(예: 플랫폼 시연 일정 잡기) — "데모"는 체험 계정과 헷갈림' },
    }, required: ['title'] } },
  { name: 'propose_create_tasks', description: '여러 담당자에게 같은 업무 만들기를 제안한다(첨부 자료를 읽고 정리할 때). 기본은 한 업무를 함께 담당(1건, 첫 사람이 주 담당 — 댓글·첨부·체크가 한곳에 모임). 사용자가 "각자·각각·한 명씩 따로"라고 분명히 말했을 때만 mode=each(사람마다 1건). 체크리스트·설명(메모)·마감 시각·요청자·첨부 자료를 함께. [확인] 후 생성.',
    input_schema: { type: 'object', properties: {
      title: str('업무 제목'), description: str('설명·메모 (자료 요약, 촬영 팁 등)'),
      assigneeIds: { type: 'array', items: { type: 'string' }, description: '담당자 id 목록 (list_people 로 찾기). together 면 첫 사람이 주 담당' },
      mode: { type: 'string', enum: ['together', 'each'], description: 'together(기본) = 함께 담당 1건 · each = 사용자가 각자 따로 만들라고 분명히 말한 경우만' },
      dueDate: str('마감일 YYYY-MM-DD'), dueTime: str('마감 시각 HH:MM (선택)'), priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
      requestedById: str('요청자 id (기본: 요청한 사람)'),
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
      company: str('회사 정보 키(회사 정보·디자인에 등록된 key) — 공급자·로고·브랜드 색. 모르면 비움(기본 회사)'),
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
      edits: { type: 'array', items: { type: 'object', properties: { sheet: { type: 'string' }, cell: { type: 'string' }, value: { type: ['string', 'number', 'null'] } }, required: ['cell', 'value'] }, description: 'xlsx 칸 값(예: {cell:"B3", value:"주식회사 ○○"})' },
      replacements: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] }, description: 'docx 문장 바꾸기' },
      fitOnePage: { type: 'boolean', description: 'xlsx 인쇄를 A4 한 페이지에 맞춤' },
      replaceLogo: { type: 'boolean', description: '원본 로고 그림을 고른 회사 로고로 바꿈(그림 1개·같은 형식일 때)' },
    }, required: ['sourceFileId', 'title'] } },
];

const WEB_TOOLS: AiTool[] = [
  // 대기열 ②(2026-10-19): 기밀 후보 확인·기밀 지정 제안·회사 설정 보기/바꾸기 제안 — 모두 [확인] 뒤 반영, 권한은 서버가 검사
  { name: 'list_confidential_suggestions', description: '자료실에서 이름·본문 규칙이 "기밀 후보"로 표시했지만 아직 기밀로 확정되지 않은 자료 목록(기밀 관리자만). "기밀로 해야 할 자료 있어?"·"기밀 후보 보여줘"에 쓴다.',
    input_schema: { type: 'object', properties: { limit: { type: 'number', description: '최대 건수(기본 50)' } } } },
  { name: 'propose_set_confidential', description: '자료실 파일의 보안 등급을 기밀(또는 내부·일반)로 바꾸기를 제안한다. 파일 id 는 list_confidential_suggestions 또는 search_library 로 찾는다. [확인] 후 실행.',
    input_schema: { type: 'object', properties: { fileIds: { type: 'array', items: { type: 'string' }, description: '파일 id 목록(최대 50)' }, security: { type: 'string', enum: ['confidential', 'internal', 'public'], description: '바꿀 등급(기본 confidential)' } }, required: ['fileIds'] } },
  { name: 'get_company_settings', description: '회사 설정 중 AI 가 바꿀 수 있는 항목의 현재 값(관리자만): 업무 첨부 자료실 자동 저장, 기밀 단어, AI 회사 정보(업종·사업·고객·말투·주의). 바꾸기 전에 먼저 본다.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'propose_update_company_settings', description: '회사 설정 바꾸기를 제안한다(관리자만). 바꿀 항목만 넣는다: attachToLibrary(업무 첨부 자료실 자동 저장 켜기/끄기), confWords(기밀 단어 전체 목록 — 기존 목록에 더할 때는 get_company_settings 값에 추가해 전체를 보낸다, 빈 배열 = 기본값), industry·business·customers·tone·cautions(AI 회사 정보). [확인] 후 반영.',
    input_schema: { type: 'object', properties: { attachToLibrary: { type: 'boolean', description: '업무 첨부를 자료실에도 자동 저장' }, confWords: { type: 'array', items: { type: 'string' }, description: '기밀로 분류할 파일 이름 단어 전체 목록' },
      industry: str('업종'), business: str('사업 내용·방향'), customers: str('주요 고객'), tone: str('말투'), cautions: str('AI 가 주의할 점') } } },
  // V19(2026-10-15 대표 지시): 문자·견적서는 AI 가 초안만 — 카드에서 사람이 고치고 [보내기]/[만들기]를 누른다. AI 가 직접 보내는 경로는 없다
  { name: 'propose_draft_sms', description: '고객·직원에게 보낼 문자(SMS) 초안을 제안한다. 받는 번호는 업무의 문의 연락처·영업 리드·사용자가 말한 번호에서만 쓰고, 모르면 비워 둔다(지어내지 않음). 사용자가 카드에서 고친 뒤 자기 휴대폰 문자앱으로 보낸다. 90바이트 넘으면 장문.',
    input_schema: { type: 'object', properties: { body: str('문자 내용(존댓말, 회사명·연락처 포함, 짧게)'), to: { type: 'array', items: { type: 'string' }, description: '받는 전화번호(사용자가 말했거나 도구 결과에 있는 것만)' },
      taskId: str('관련 업무 id(문의 업무면 연락처를 여기서 찾음, 선택)'), leadId: str('영업 리드 id(선택)') }, required: ['body'] } },
  { name: 'list_quote_companies', description: '견적서 공급자로 쓸 수 있는 우리 회사 정보(회사 키·상호)와 저장된 견적서 양식 목록. 견적서를 만들기 전에 먼저 본다.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'propose_draft_quote', description: '견적서 초안을 제안한다(회사 양식, A4 1페이지 PDF). 금액(공급가액·부가세 10%·합계)은 서버가 다시 계산한다. 품목·수량·단가는 사용자가 준 것·자료에서 읽은 것만. [견적서 만들기] 후 PDF 가 자료실 "견적서" 폴더에 저장되고 업무가 있으면 첨부된다.',
    input_schema: { type: 'object', properties: { company: str('공급자 회사 키(list_quote_companies 의 key)'), templateId: str('양식 id(선택, 없으면 기본)'),
      to: { type: 'object', properties: { name: str('받는 곳(회사·고객 이름)'), contact: str('담당자(선택)'), phone: str('전화(선택)'), email: str('이메일(선택)') }, required: ['name'] },
      items: { type: 'array', items: { type: 'object', properties: { name: str('품목'), spec: str('규격(선택)'), qty: { type: 'number' }, unitPrice: { type: 'number', description: '단가(원, 부가세 별도)' } }, required: ['name', 'qty', 'unitPrice'] } },
      validDays: { type: 'number', description: '유효기간 일수(기본 30)' }, note: str('비고·결제조건 등(선택)'), taskId: str('관련 업무 id(선택)'), leadId: str('영업 리드 id(선택)') }, required: ['company', 'to', 'items'] } },
  { name: 'propose_create_quote_template', description: '회사별 견적서 양식 만들기를 제안한다. 기존 양식 파일(자료실)을 read_library_file 로 읽고 항목 구성(열·조건 문구·맺음말)을 따라 하되, 공급자 정보는 양식에 넣지 않는다(회사 정보에서 자동). [확인] 후 저장.',
    input_schema: { type: 'object', properties: { company: str('회사 키'), name: str('양식 이름(예: 다짐 기본 견적서)'), sourceFileId: str('참고한 자료실 파일 id(선택)'),
      layout: { type: 'object', properties: { title: str('제목(기본 견 적 서)'), columns: { type: 'array', items: { type: 'object', properties: { key: { type: 'string', enum: ['name', 'spec', 'qty', 'unitPrice', 'amount'] }, label: str('열 이름'), width: { type: 'number', description: '너비 비율 0.05~0.8' } }, required: ['key', 'label', 'width'] } },
        terms: { type: 'array', items: { type: 'string' }, description: '조건 문구들({validUntil} 치환)' }, footer: str('맺음말'), accent: str('강조색 #rrggbb(선택)') } }, isDefault: { type: 'boolean' } }, required: ['company', 'name'] } },
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 } as never,
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 } as never,
];
// #650(대표 10/25 23:20 "AI 세일즈가 온비드 공고를 웹 검색으로 찾다 실패"): 공고 도구 — 웹 검색 전에 우리 영업 DB 의 원문·첨부부터. 영업 공간이거나 질문에 공고·입찰 낱말이 있을 때 붙고, more_tools 로도 받음
const SALES_TOOLS: AiTool[] = [
  { name: 'search_sales_notices', description: '우리 영업 DB(수집한 입찰·임대·협력사 모집 공고)에서 공고를 찾는다 — 공고 제목 일부·공고번호·발주처·단지 이름으로. "이 공고"·"○○ 공고문"처럼 공고를 말하면 웹 검색(web_search)보다 먼저 이 도구로 찾고, 결과 id 로 read_sales_notice 를 부른다.',
    input_schema: { type: 'object', properties: { query: str('찾을 말(공고 제목 일부·공고번호·발주처·단지 이름)'), limit: { type: 'number', description: '최대 건수(기본 8)' } }, required: ['query'] } },
  { name: 'read_sales_notice', description: '영업 DB 공고 한 건의 상세(발주처·마감·개찰·계약 방식·추정가·과업·참가 자격·연락처)와 첨부(공고문·과업지시서)의 본문 글자를 읽는다. 첨부는 서버가 받아 자료실 "영업/공고"에 저장한 뒤 글자를 뽑는다(최대 3개). 공고 요약·참가 자격·제안서 목차·질문 뽑기는 이 결과를 근거로 답한다.',
    input_schema: { type: 'object', properties: { id: str('search_sales_notices 결과의 id') }, required: ['id'] } },
];
// 255차 #793(대표 10/29 01:45 'AI 마케터가 승인함을 조회할 도구가 없다며 현 문제를 모름'): 마케팅 운영 상태 읽기 — 마케팅 공간이거나 승인·시안·게시·자동 제작 낱말이 있을 때 붙고, more_tools 로도 받음
const MKT_TOOLS: AiTool[] = [
  { name: 'marketing_inbox_status', description: '마케팅 승인함 현황(승인함 화면과 같은 계산): 승인할 시안 수(게시일 지난 것 포함)·시안 없음·수정 요청(AI 수정본 처리 상태)·보류·미뤄진 글·초안 보관·승인됨 게시 전·제작 요청 카드·운영 제안/예산/목표 대기 수와, 승인 대기가 0이거나 적은 이유(why). "승인할 게 왜 없지", "승인함", "게시가 안 된다"는 질문에 먼저 쓴다.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'marketing_content_status', description: '마케팅 콘텐츠(게시물) 상태: 상태·버전·게시 예정·승인 마감·게시일 지남·마지막 결정(승인/수정 요청/보류)과 의견·AI 수정본 결과·제작 요청 카드(영상·이미지 다시 만들기 비용)·검사 문제. 제목 일부나 콘텐츠 id 로 찾고, 비우면 승인 대기·수정 요청 글.',
    input_schema: { type: 'object', properties: { query: str('제목 일부 또는 콘텐츠 id(비우면 승인 대기·수정 요청 글)'), limit: { type: 'number', description: '최대 건수(기본 5, 최대 10)' } } } },
  { name: 'marketing_auto_status', description: '마케팅 자동 제작 상태: 일시정지 여부·언제·누가(어느 결정)·멈춘 동안 멈추는 일·다음 자동 제작 예정·7일 안 계획 칸·마지막 제작·켜진 규칙 수·글 모델·이번 달 남은 크레딧/영상/재생성.',
    input_schema: { type: 'object', properties: {} } },
];

const SYSTEM = `당신은 사내 업무·일정 서비스 "워크인"의 AI 비서입니다. 아래 [우리 회사] 직원을 돕습니다. 그 회사의 업종·사업 방향·말투에 맞춰 답하고, 다른 회사 이야기를 지어내지 마세요.
- 사실(업무·일정·자료·매출)은 반드시 도구로 확인하고 답하세요. 도구 결과에 없는 숫자·이름·날짜를 지어내지 마세요.
- 데이터를 바꾸는 일(업무 만들기·고치기·댓글·첨부·일정 만들기·변경·취소·엑셀 보고서·문서 만들기·자료실 정리)은 propose_* 도구로만 제안하세요. 제안은 사용자가 화면의 [확인] 버튼을 눌러야 실행됩니다.
- 실행 상태는 도구 결과·대화 기록 표시 그대로 말하세요(대표 지적 10/19 ④): 이번 답에서 만든 제안 = "확인을 누르면 반영됩니다". 대화 기록의 [실행됨] = 이미 반영된 것 → "만들었습니다/바꿨습니다(화면의 [열기])"라고 하고 다시 확인을 안내하지 마세요. [취소됨] = 반영 안 됨. 도구 오류 = "하지 못했습니다: 이유".
[할 수 있는 일 — 아래 도구로 되는 일을 "안 된다·화면에서 직접 하세요"라고 답하지 마세요(대표 지적 10/19 ②). 되는지 모르겠으면 도구 목록을 먼저 보고, 정말 도구가 없을 때만 안 된다고 하세요]
- 업무: 찾기 search_tasks · 상세 get_task · 만들기 propose_create_task(한 사람)·propose_create_tasks(여러 사람 — 기본 함께 담당 1건, '각자'라고 하면 사람마다) · 고치기 propose_update_task(담당자 변경·마감일·마감 시각·상태·우선순위·제목) · 댓글 propose_comment · 자료 첨부 propose_attach_file
- 일정: 보기 list_events · 빈 시간 find_free_time · 만들기 propose_create_event · 시간 변경·취소 propose_update_event
- 문자·견적서(V19): 문자 초안 propose_draft_sms(보내기는 사람이 휴대폰 문자앱에서) · 견적서 list_quote_companies → propose_draft_quote(금액은 서버 재계산, A4 1장) · 양식 propose_create_quote_template. 전화번호·금액·품목을 지어내지 마세요.
- 기밀·회사 설정(관리자): 기밀 후보 list_confidential_suggestions · 등급 바꾸기 propose_set_confidential · 설정 보기 get_company_settings · 설정 바꾸기 propose_update_company_settings(기밀 단어·첨부 자동 저장·AI 회사 정보)
- 자료실: 찾기 search_library · 읽기 read_library_file · 폴더 list_library_folders · 정리 propose_organize_files · 문서·엑셀 propose_create_document·propose_xlsx_report·run_file_task·fill_template
- 사람·조직 list_people · 매출 revenue_summary(대표·본사)
[지시 해석 — 대표 지적 10/19 ①] "○○한테/에게 ~하라고 해줘·시켜줘·전달해줘·맡겨줘·부탁해줘"는 기본이 업무 배정입니다: 담당 = ○○(list_people 로 id), 요청자 = 말한 사람, 마감은 말에서 해석(예: "다음주 금요일까지"), 제목은 시킬 일. propose_create_task 로 제안하세요. "메시지로·문자로·카톡으로·메일로"라고 분명히 말할 때만 메시지 전달로 봅니다(메시지 보내기 도구는 없으니 그때는 보낼 문구를 써 주세요).
[중복 막기 — 대표 지적 10/19 ③] 새 업무를 제안하기 전에 search_tasks 로 비슷한 제목의 열린 업무를 확인하세요. 있으면 그 업무 이름·담당·마감을 보여 주고 "이 업무에 붙일까요, 새로 만들까요?"를 한 번만 물으세요(둘 다 제안하지 않기). 사용자가 요청하지 않은 일(다른 업무에 첨부 등)을 먼저 제안하지 마세요.
[근거 — 대표 지적 10/19 ⑤⑥] 첨부·자료실 파일 내용(담당자 이름·금액·날짜 등)은 이번 대화에서 파일 내용을 실제로 받았거나 read_library_file 로 읽은 경우에만 말하고 "(파일명, n쪽/시트)"처럼 근거를 붙이세요. 앞선 차례에 올린 파일은 이름만 기록에 있으니 내용이 필요하면 read_library_file 로 다시 읽고, 못 읽었으면 "아직 열어 보지 않았습니다"라고 하세요. 기존 업무의 담당·마감·상태는 search_tasks·get_task 결과로만 말하세요(기억·추측 금지).
- 첨부 자료를 업무로 정리해 달라고 하면 자료 내용을 읽고 propose_create_tasks 로 담당자별 업무(체크리스트·메모·마감·첨부)를 한 번에 제안하세요.
- 일정과 업무를 함께 요청하면(예: "회의 잡고 참석자들 업무로도") propose_create_event 하나에 taskAssigneeIds 를 넣어 "일정 1 + 연결 업무"로 제안하세요. 업무 마감은 일정 시작과 같고 날짜가 연동됩니다. 같은 내용의 propose_create_task(s) 를 따로 만들지 마세요(사용자가 다른 마감을 요청한 경우만 예외). 일정 주인 본인에게는 업무를 또 만들지 않습니다.
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
type Ctx = { allTools?: boolean; u: SessionUser; proposals: { id: string; kind: string; summary: string; preview?: unknown }[]; confidential?: boolean;
  /** #753 이번 대화에서 search_library 로 찾은 자료(답에 이름이 나온 것만 카드로) */ found?: { id: string; title: string; folder: string | null; fileName: string | null; mime: string | null }[]; threadId?: string; docJobs?: { id: string; title: string; kind: string; version: number; status: string }[] };
const clip = (s: unknown, n = 400) => (typeof s === 'string' ? (s.length > n ? s.slice(0, n) + '…' : s) : s);
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
/** #650(대표 10/25 23:20 캡처 첫 줄 "Results are JSON strings; parse."): 모델이 도구 결과의 안내·형식 문장을 답에 옮겨 적은 줄만 지운다 — 우리 소스·SDK 에 없는 문장이라 모델이 도구 결과 설명을 그대로 쓴 것 */
const TOOL_NOISE = /^\s*(?:results?\s+(?:are|is)\s+(?:json|text|string|a\s+json)[^\n]{0,80}|(?:the\s+)?(?:tool|function)[ _]?(?:results?|outputs?|calls?)\s*(?:are|is|were|:)[^\n]{0,80}|<\/?function_results>[^\n]*|\[?tool_results?\]?\s*:?[^\n]{0,80})\s*$/i;
export function cleanReply(text: string): string {
  if (!text || !/results?\s+(?:are|is)|tool|function_results/i.test(text)) return text;
  const out = text.split('\n').filter((l) => !TOOL_NOISE.test(l)).join('\n');
  return out === text ? text : out.replace(/^\s*\n+/, '').trim();
}
/** 스트리밍(#497 R44): 답 첫 줄이 끝날 때까지(또는 200자) 잠깐 모았다가 안내 문장이면 빼고 보낸다 — 그 뒤는 그대로 흘림 */
function noiseSink(emit: (d: string) => void) {
  let buf = ''; let checking = true;
  return {
    push(delta: string) {
      if (!checking) return emit(delta);
      buf += delta;
      const nl = buf.indexOf('\n'); if (nl < 0 && buf.length < 200) return;
      const first = nl < 0 ? buf : buf.slice(0, nl); const rest = nl < 0 ? '' : buf.slice(nl);
      checking = false; buf = '';
      const out = TOOL_NOISE.test(first) ? rest.replace(/^\n+/, '') : first + rest;
      if (out) emit(out);
    },
    flush() { if (!checking) return; checking = false; const out = TOOL_NOISE.test(buf) ? '' : buf; buf = ''; if (out) emit(out); },
    reset() { buf = ''; checking = true; },
  };
}

/** 대표 지적(10/19 ①): "○○한테 ~하라고 해줘" = 업무 배정 — 규칙으로 의도 힌트(추가 AI 호출 없음). 메시지·문자·메일로 라고 하면 전달 */
export function intentHint(text: string): string {
  const t = text.replace(/\s+/g, ' ');
  if (/(메시지|문자|카톡|카카오톡|메일|이메일|DM)\s*(로|으로)/.test(t)) return '';
  const m = t.match(/([가-힣A-Za-z]{2,10})\s*(?:[가-힣]{2,4}님?)?\s*(?:한테|에게|께)\s/);
  if (m && /(라고|하게|도록)\s*(해\s*줘|해\s*주세요|해라|시켜|전달|맡겨|부탁)|시켜\s*(줘|주세요)|맡겨\s*(줘|주세요)/.test(t)) {
    const who = m[1].replace(/(부사장|사장|대표|본부장|부장|차장|과장|팀장|실장|이사|대리|주임|매니저|선생)$/, '') || m[1];
    return `\n의도 힌트(규칙): "${who}" 에게 일을 시키는 요청 — 업무 배정으로 처리(list_people → search_tasks 로 비슷한 업무 확인 → propose_create_task, 요청자 = 사용자). 메시지 전달로 해석하지 마세요.`;
  }
  return '';
}

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
    case 'more_tools': { c.allTools = true; return { ok: true, note: '모든 도구를 붙였습니다 — 다음 단계에서 필요한 도구를 쓰세요' }; }
    case 'search_sales_notices': return searchNotices(u, String(input.query ?? ''), Number(input.limit) || 8); // #650
    case 'read_sales_notice': return readNotice(u, String(input.id ?? ''));
    case 'marketing_inbox_status': return (await import('../mktStatus')).inboxStatus(u); // 255차 #793
    case 'marketing_content_status': return (await import('../mktStatus')).contentStatus(u, String(input.query ?? ''), Number(input.limit) || 5);
    case 'marketing_auto_status': return (await import('../mktStatus')).autoStatus(u);
    case 'search_library': {
      const q = String(input.query ?? '');
      let r = await listLibrary(u, { q, folder: input.folder, limit: 10 }); // 등급·폴더 권한 밖 파일은 여기서 이미 빠짐
      // #753(대표 10/28): 낱말이 여럿인데 모두 맞는 자료가 없으면 낱말마다 찾아 많이 맞은 순('다짐 로고 원본 파일'처럼 말해도 찾게)
      const terms = q.trim().split(/\s+/).filter((x) => x.length >= 2).slice(0, 4);
      if (!r.files.length && terms.length > 1) {
        const hit = new Map<string, { f: any; n: number }>();
        for (const t of terms) for (const f of (await listLibrary(u, { q: t, folder: input.folder, limit: 10 })).files) { const h = hit.get(f.id); if (h) h.n++; else hit.set(f.id, { f, n: 1 }); }
        r = { ...r, files: [...hit.values()].sort((a, b) => b.n - a.n).slice(0, 10).map((x) => x.f) };
      }
      if (r.files.some((f: any) => f.effective_security === 'confidential')) c.confidential = true;
      for (const f of r.files) if (!(c.found ??= []).some((x) => x.id === f.id)) c.found.push({ id: f.id, title: f.title, folder: f.folder ?? null, fileName: f.file_name ?? null, mime: f.mime_type ?? null });
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
        from revenue_entries r join org_units o on o.id = r.org_unit_id where o.tenant = ${tenantOf(u)} and not o.is_demo and r.month between ${input.fromMonth + '-01'} and ${input.toMonth + '-01'} order by o.name, r.month limit 600`;
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
      const [cal] = await db()<any[]>`select id, type, org_unit_id, owner_user_id, team_id, tenant from calendars where id = ${calendarId}`;
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
      // 대표 #794: 여러 명이면 기본 '함께 담당 1건' — 사람마다 따로 만들면 댓글·첨부가 서로 안 보여 일이 갈라짐. '각자'는 분명히 말한 경우만
      const each = input.mode === 'each' && ids.length > 1;
      const what = ids.length > 1 ? (each ? `업무 ${ids.length}건 만들기(각자 1건씩)` : `업무 1건 만들기(${ids.length}명 함께 담당)`) : '업무 만들기';
      return propose(c, 'create_tasks', `${what}: ${i.title} — ${names.join('·')}${i.dueDate ? ` (마감 ${i.dueDate}${i.dueTime ? ' ' + i.dueTime : ''})` : ''}`,
        { input: i, attachFileIds: files, mode: each ? 'each' : 'together' }, { assignees: names, due: i.dueDate ? `${i.dueDate}${i.dueTime ? ' ' + i.dueTime : ''}` : null, checklist: i.checklist ?? [], description: clip(i.description ?? '', 600), files: files.length, mode: each ? 'each' : 'together' });
    }
    case 'propose_update_task': {
      const d = await getTaskDetail(u, String(input.taskId));
      const patch = taskInput.partial().parse({ title: input.title || undefined, status: input.status || undefined, dueDate: isDate(input.dueDate) ? input.dueDate : undefined,
        dueTime: /^\d{2}:\d{2}$/.test(input.dueTime ?? '') ? input.dueTime : undefined, assigneeId: input.assigneeId || undefined, priority: input.priority || undefined });
      if (!Object.values(patch).some((v) => v !== undefined)) throw badRequest('바꿀 내용이 없습니다');
      // V14 50: 제안 단계에서 권한 확인 — 상태는 담당자만, 내용·일정은 요청자·담당자만, 담당자 변경은 요청자만
      const tk = d.task as any; const req = tk.requested_by ?? tk.created_by;
      if (patch.status && (tk.assignee_id ?? req) !== u.id && tk.status !== 'review') throw new HttpError(403, 'forbidden', '상태는 담당자만 바꿀 수 있습니다 — 담당자에게 요청하세요');
      if (!(d.perms as any).edit) throw new HttpError(403, 'forbidden', '이 업무의 내용·일정은 요청자·담당자만 바꿀 수 있습니다 — 댓글로 요청하세요');
      if (patch.assigneeId && req !== u.id) throw new HttpError(403, 'forbidden', '담당자 변경은 요청자만 할 수 있습니다 — 담당자는 "넘기기 요청"을 쓰세요');
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
      await (await import('./companyBudget')).assertCompanyAi(tenantOf(u)); // 대표 10/24 ② 회사 월 AI 예산(원) — 다 썼으면 다음 달 1일까지 시작 안 함
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
    case 'list_confidential_suggestions': {
      const files = await listConfidentialSuggestions(u, Math.min(Math.max(Number(input.limit) || 50, 1), 100));
      return { files: files.map((f) => ({ ...f, security: SEC_LABEL[f.security] })), note: files.length ? '기밀로 바꾸려면 propose_set_confidential 로 제안' : '기밀 후보가 없습니다' };
    }
    case 'propose_set_confidential': {
      const i = z.object({ fileIds: z.array(z.string().uuid()).min(1).max(50), security: z.enum(['confidential', 'internal', 'public']).default('confidential') }).parse(input);
      const lines: string[] = []; const items: { fileId: string; title: string; from: string }[] = [];
      for (const id of [...new Set(i.fileIds)]) {
        const f = await loadLibraryFile(u, id, 'meta'); // 볼 수 없는 자료면 404
        if (f.security === i.security) continue;
        items.push({ fileId: id, title: f.title, from: f.security });
        lines.push(`${f.title} (${f.folder || '폴더 없음'}): ${SEC_LABEL[f.security as keyof typeof SEC_LABEL]} → ${SEC_LABEL[i.security]}`);
      }
      if (!items.length) return { ok: true, note: '이미 그 등급입니다 — 바꿀 것이 없습니다' };
      return propose(c, 'set_security', `보안 등급 ${SEC_LABEL[i.security]}로: ${items.length}개 — ${items[0].title}${items.length > 1 ? ` 외 ${items.length - 1}개` : ''}`, { items, security: i.security }, { moves: lines });
    }
    case 'get_company_settings': {
      const [a, p] = await Promise.all([getAttachToLibrary(u), getAiProfile(u)]); // 관리자(회사 정보 보기)만 — 아니면 403
      return { attachToLibrary: a.on, confWords: a.confWords, confWordsDefault: a.confWordsDefault, industry: p.industry, industries: p.industries, business: p.business, customers: p.customers, tone: p.tone, cautions: p.cautions };
    }
    case 'propose_update_company_settings': {
      const i = z.object({ attachToLibrary: z.boolean().optional(), confWords: z.array(z.string().trim().min(1).max(50)).max(200).optional(),
        industry: z.string().max(200).optional(), business: z.string().max(4000).optional(), customers: z.string().max(4000).optional(), tone: z.string().max(1000).optional(), cautions: z.string().max(4000).optional() }).parse(input);
      const { requireAnyMenu } = await import('../menuPerms');
      await requireAnyMenu(u, ['company', 'ops'], 'edit'); // 제안 단계에서 먼저 막는다(실행 때 다시 검사)
      const lines: string[] = []; const warnings: string[] = [];
      const cur = await getAttachToLibrary(u);
      if (i.attachToLibrary !== undefined) lines.push(`업무 첨부 자료실 자동 저장: ${cur.on ? '켬' : '끔'} → ${i.attachToLibrary ? '켬' : '끔'}`);
      if (i.confWords) {
        const next = [...new Set(i.confWords.map((x) => x.trim()).filter(Boolean))];
        const added = next.filter((w) => !cur.confWords.includes(w)); const removed = cur.confWords.filter((w) => !next.includes(w));
        lines.push(`기밀 단어: ${next.length ? `${next.length}개` : '기본값'}${added.length ? ` (+ ${added.join(', ')})` : ''}${removed.length ? ` (− ${removed.join(', ')})` : ''}`);
        const outbound = added.filter((w) => /견적|제안서|회사 ?소개|소개서|안내문|카탈로그/.test(w));
        if (outbound.length) warnings.push(`${outbound.join(', ')}: 고객에게 보내는 문서 단어라 이 단어가 든 파일을 밖으로 보낼 때마다 한 번 확인하게 됩니다`);
        i.confWords = next;
      }
      const L: Record<string, string> = { industry: '업종', business: '사업 내용', customers: '주요 고객', tone: '말투', cautions: '주의할 점' };
      for (const k of Object.keys(L) as (keyof typeof L)[]) if ((i as any)[k] !== undefined) lines.push(`AI 회사 정보 · ${L[k]}: ${clip(String((i as any)[k]), 120) || '(비움)'}`);
      if (!lines.length) throw badRequest('바꿀 항목이 없습니다');
      return propose(c, 'company_settings', `회사 설정 바꾸기: ${lines[0]}${lines.length > 1 ? ` 외 ${lines.length - 1}건` : ''}`, i, { moves: lines, warnings: warnings.length ? warnings : undefined });
    }
    case 'propose_draft_sms': {
      const i = z.object({ body: z.string().trim().min(1).max(2000), to: z.array(z.string().trim().max(40)).max(20).optional(), taskId: z.string().uuid().optional(), leadId: z.string().uuid().optional() }).parse(input);
      const sql = db();
      const found: string[] = []; const warnings: string[] = []; let taskTitle: string | undefined;
      if (i.taskId) {
        const d = await getTaskDetail(u, i.taskId); taskTitle = (d.task as any).title;
        const [q] = await sql<{ phone: string | null }[]>`select payload->>'phone' as phone from inquiries where task_id = ${i.taskId} and tenant = ${tenantOf(u)} order by created_at desc limit 1`;
        if (q?.phone) found.push(q.phone);
      }
      if (i.leadId) {
        const [l] = await sql<{ phone: string | null }[]>`select phone from sales_leads where id = ${i.leadId} and tenant = ${tenantOf(u)}`;
        if (l?.phone) found.push(l.phone);
      }
      // 사용자가 말한 번호만(모양이 전화번호인 것) — 이름·추측은 버린다
      const said = (i.to ?? []).map((x) => x.replace(/[^0-9+\-]/g, '')).filter((x) => /^(\+?82|0)\d{8,10}$|^\d{3,4}-\d{3,4}-\d{4}$/.test(x));
      const to = [...new Set([...said, ...found])];
      if (!to.length) warnings.push('받는 번호를 찾지 못했습니다 — 카드에서 번호를 넣어 주세요(AI 는 번호를 지어내지 않습니다)');
      const bytes = [...i.body].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
      return propose(c, 'draft_sms', `문자 시안: ${to.length ? to.join(', ') : '(번호 확인 필요)'} — ${clip(i.body, 60)}`, { to, body: i.body, taskId: i.taskId ?? null, leadId: i.leadId ?? null },
        { sms: { to, body: i.body, bytes, long: bytes > 90, taskTitle }, warnings: warnings.length ? warnings : undefined });
    }
    case 'list_quote_companies': {
      const [profiles, t] = await Promise.all([companyProfiles(tenantOf(u)), listTemplates(u)]);
      if (!profiles.length) return { companies: [], templates: [], note: '회사 정보(공급자)가 없습니다 — 관리자가 회사 정보·디자인에서 상호·사업자번호·주소를 등록해야 견적서를 만들 수 있습니다' };
      return { companies: profiles.map((p) => ({ key: p.key, name: p.name, isDefault: p.is_default, hasBizInfo: !!(p.biz_no && p.address) })), templates: t.templates.map((x) => ({ id: x.id, company: x.company, name: x.name, isDefault: x.isDefault })) };
    }
    case 'propose_draft_quote': {
      const i = quoteInput.parse({ ...input, to: input.to ?? {}, items: input.items ?? [] });
      const pv = await previewQuote(u, i); // 회사·양식·업무 권한 확인 + 금액 재계산 + 1페이지 검사(저장 없음)
      const warnings: string[] = [];
      if (pv.overflow) warnings.push('A4 1페이지를 넘습니다 — 품목을 묶거나 줄여 주세요');
      if (!i.to.phone && !i.to.email) warnings.push('받는 곳 연락처가 없어 만든 뒤 PDF 를 직접 전달해야 합니다');
      const payload = { ...i, items: pv.items, supply: pv.supply, vat: pv.vat, total: pv.total, validUntil: pv.validUntil };
      return propose(c, 'draft_quote', `견적서 시안: ${pv.profile.name} → ${i.to.name} · ${i.items.length}개 품목 · 합계 ${won(pv.total)}원(VAT 포함)`, payload,
        { quote: { company: pv.profile.key, companyName: pv.profile.name, to: i.to, items: pv.items, supply: pv.supply, vat: pv.vat, total: pv.total, validUntil: pv.validUntil, overflow: pv.overflow, template: pv.template?.name ?? null }, warnings: warnings.length ? warnings : undefined });
    }
    case 'propose_create_quote_template': {
      const i = templateInput.parse({ ...input, layout: input.layout ?? {} });
      const { requireAnyMenu } = await import('../menuPerms');
      await requireAnyMenu(u, ['company', 'ops'], 'edit');
      if (i.sourceFileId) await loadLibraryFile(u, i.sourceFileId, 'meta');
      const cols = (i.layout.columns ?? []).map((x) => x.label).join(' · ') || '기본 열(품목·규격·수량·단가·공급가액)';
      return propose(c, 'quote_template', `견적서 양식 만들기: ${i.company} "${i.name}"${i.isDefault ? ' (기본)' : ''}`, i, { moves: [`열: ${cols}`, ...(i.layout.terms?.length ? [`조건: ${i.layout.terms.join(' / ')}`] : []), ...(i.layout.footer ? [`맺음말: ${i.layout.footer}`] : [])] });
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
  /** 대표 지적(10/18): 영업·마케팅 공간에서 연 AI 비서 — 그 공간 맥락으로 답함(권한은 서버가 다시 확인) */
  space: z.enum(['sales', 'marketing']).optional(),
  /** V14 11번: 어느 화면에서 물었는지 — id 만 받고 서버가 권한 안에서 조회 */
  context: z.object({ page: z.enum(['home', 'tasks', 'task', 'calendar', 'library', 'revenue', 'reports', 'messages', 'other']), id: z.string().max(80).optional() }).optional(),
  /** V12 8번: 이번 질문에 붙인 자료실 파일(최대 5개) — 이미지는 비전, PDF 는 문서, 그 밖은 추출한 글자로 전달 */
  fileIds: z.array(z.string().uuid()).max(5).optional(),
  /** 부록 A3: 마지막 질문을 고쳐 보내기·다시 답하기 — 그 질문과 이후 답변·확정 안 된 제안을 지우고 새로 답한다 */
  replaceLast: z.boolean().optional(),
  /** 바꿀 원래 질문 — 서버의 마지막 질문과 같을 때만 지운다(멈춘 요청이 늦게 저장되는 경우 엉뚱한 질문을 지우지 않게) */
  replaceText: z.string().max(20000).optional(),
  /** #497 R44: 답을 글자 단위로 받기(SSE) — 화면 대화창만. 없으면 지금처럼 한 번에 */
  stream: z.boolean().optional(),
});
export { chatInput };
/** #497 R44 스트리밍 중 화면에 보내는 것: 시작(대화 id) · 답 글자 조각 · 도구 단계(이번 단계 글은 지우고 '찾아보는 중' 표시) */
export type ChatEvent = { type: 'start'; threadId: string } | { type: 'text'; delta: string } | { type: 'tools'; names: string[] };

/** 공간 맥락: 그 공간 권한이 있을 때만 한 줄 요약(영업 = 영업기회, 마케팅 = 승인 대기·광고·전화 문의). 권한 없으면 아무것도 안 붙임 */
async function spaceContext(u: SessionUser, space: 'sales' | 'marketing') {
  const { userSpaces } = await import('../spaces');
  if (!(await userSpaces(u)).includes(space)) return '';
  const sql = db(); const t = tenantOf(u);
  if (space === 'sales') {
    const [r] = await sql<{ n: number; fresh: number }[]>`select count(*)::int n, count(*) filter (where p.opened_on >= current_date - 7)::int fresh
      from prospects p join tenant_data_sources ts on ts.source_code = p.source_code and ts.tenant = ${t} and ts.enabled
      left join tenant_prospects tp on tp.prospect_id = p.id and tp.tenant = ${t} where coalesce(tp.status, 'new') in ('new', 'contacting')`;
    return `\n지금 사용자는 '영업' 공간에서 묻고 있습니다(리드·영업기회·입찰·거래처 관점으로 답하세요). 진행 중 영업기회 ${r?.n ?? 0}건(최근 7일 새로 ${r?.fresh ?? 0}건) — 자세한 목록은 영업 › 영업기회 화면.
[공고 — #650] 공고문·공고 내용(참가 자격·과업·마감·첨부·요약)을 물으면 web_search 보다 먼저 search_sales_notices → read_sales_notice 로 우리 영업 DB 의 원문·첨부를 읽고, 거기 없을 때만 웹을 찾아 출처를 밝히세요. 도구 결과 안의 안내·형식 문장(예: "Results are JSON strings; parse.")은 답에 옮겨 적지 말고, 사용자에게 필요한 내용만 한국어로 쓰세요.`;
  }
  const [c] = await sql<{ pending: number; changes: number; calls: number }[]>`select (select count(*)::int from mkt_contents where tenant = ${t} and status = 'pending') pending,
      (select count(*)::int from mkt_contents where tenant = ${t} and status = 'changes') changes, (select count(*)::int from mkt_calls where tenant = ${t} and status = 'new') calls`;
  const [a] = await sql<{ cost: number; clicks: number; conv: number }[]>`select coalesce(sum(s.cost_krw), 0)::float8 cost, coalesce(sum(s.clicks), 0)::float8 clicks, coalesce(sum(s.conversions), 0)::float8 conv
      from mkt_ad_stats s join mkt_ad_accounts ac on ac.id = s.account_id where ac.tenant = ${t} and s.day >= current_date - 7`;
  return `\n지금 사용자는 '마케팅' 공간에서 묻고 있습니다(콘텐츠·게시 일정·광고 성과·전화 문의 관점으로 답하세요). 승인함·콘텐츠·자동 제작 상태는 marketing_inbox_status·marketing_content_status·marketing_auto_status 도구로 확인하고 결과의 숫자·이유(why)를 그대로 말하세요 — "조회할 도구가 없다"고 하지 마세요(255차 #793). 승인 대기 ${c?.pending ?? 0}건, 수정 요청 ${c?.changes ?? 0}건, 새 전화 문의 ${c?.calls ?? 0}건, 최근 7일 광고비 ${Math.round(a?.cost ?? 0).toLocaleString('ko-KR')}원·클릭 ${Math.round(a?.clicks ?? 0)}·전환 ${Math.round(a?.conv ?? 0)}. 게시·광고 변경은 직접 하지 말고 화면에서 사람이 하도록 안내하세요.`;
}

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
// ---- V45 원가(대표 지적 10/19: 질문 1번 중앙 73원) — 의도별 도구 묶음·빠른 모델·고정부 캐시 ----
/** 늘 붙는 도구(업무·사람·자료 찾기) + 의도 낱말이 있을 때만 붙는 묶음. 묶음은 몇 가지로 고정돼 같은 회사 안에서 캐시가 다시 쓰임 */
const CORE_TOOLS = new Set(['search_tasks', 'get_task', 'list_people', 'list_events', 'search_library', 'read_library_file', 'propose_create_task', 'propose_create_tasks', 'propose_update_task', 'propose_comment', 'propose_attach_file', 'more_tools']);
const BUNDLES: [RegExp, string[]][] = [
  [/일정|회의|미팅|약속|캘린더|시간|잡아|빈 ?시간|취소|연차|출장|방문/, ['find_free_time', 'propose_create_event', 'propose_update_event']],
  [/자료|파일|문서|엑셀|보고서|견적|양식|정리|폴더|PPT|피피티|워드|PDF|표|안내문|제안서|만들어/i, ['list_library_folders', 'propose_organize_files', 'propose_create_document', 'propose_xlsx_report', 'run_file_task', 'list_templates', 'read_template_layout', 'fill_template']],
  [/매출|지출|회원 ?수|실적/, ['revenue_summary']],
  [/문자|SMS|견적|양식|발송/i, ['propose_draft_sms', 'list_quote_companies', 'propose_draft_quote', 'propose_create_quote_template']],
  [/기밀|보안 ?등급|회사 ?설정|기밀 ?단어|업종|말투|사업 ?방향|고객층|주의 ?사항|자동 ?저장|설정/, ['list_confidential_suggestions', 'propose_set_confidential', 'get_company_settings', 'propose_update_company_settings']],
];
const MORE_TOOLS: AiTool = { name: 'more_tools', description: '이번 질문에는 자주 쓰는 도구만 붙어 있다. 일정·자료·문서·매출 등 필요한 도구가 목록에 없으면 먼저 이 도구를 불러 모든 도구를 받는다("안 된다"고 답하기 전에 반드시).',
  input_schema: { type: 'object', properties: { reason: { type: 'string', description: '필요한 일' } } } } as AiTool;
export function toolsFor(text: string, hasFiles: boolean, all = false, space?: string | null) {
  if (all) return [...TOOLS, ...SALES_TOOLS, ...MKT_TOOLS, MORE_TOOLS].filter((t) => t.name !== 'more_tools');
  const want = new Set(CORE_TOOLS);
  for (const [re, names] of BUNDLES) if (hasFiles && names.includes('propose_organize_files') ? true : re.test(text)) names.forEach((n) => want.add(n));
  const sales = space === 'sales' || /공고|입찰|온비드|나라장터|k-?apt|과업|발주처/i.test(text) ? SALES_TOOLS : []; // #650
  const mkt = space === 'marketing' || /승인함|승인\s*대기|시안|게시물|자동\s*제작|수정\s*요청|마케팅|릴스|카드뉴스/.test(text) ? MKT_TOOLS : []; // 255차 #793
  return [...TOOLS.filter((t) => want.has(t.name)), ...sales, ...mkt, MORE_TOOLS];
}
/** 조회만 하는 짧은 질문(만들기·바꾸기·배정 낱말 없음)은 빠른 모델 — 도구 여러 단계·문서·첨부는 기본 모델 */
export function lightQuestion(text: string, hasFiles: boolean) {
  if (hasFiles || text.length > 80) return false;
  if (/만들|추가|바꿔|바꾸|변경|배정|시켜|맡겨|보내|정리|등록|잡아|취소|삭제|수정|작성|분석|요약해|제안|계획|비교/.test(text)) return false;
  return /알려|보여|뭐|무엇|몇|언제|어디|누구|있어|있나|찾아|목록|조회|확인|남았|했어|됐어/.test(text);
}
const DOC_TOOL_NAMES = new Set(['run_file_task', 'list_templates', 'read_template_layout', 'fill_template', 'search_library', 'read_library_file', 'list_library_folders',
  'propose_create_document', 'propose_xlsx_report', 'propose_organize_files', 'propose_attach_file', 'search_tasks', 'get_task']);
const DOC_SYSTEM = `당신은 사내 서비스 "워크인"의 문서 담당 AI 입니다. 이번 요청은 문서·파일 만들기입니다.
- 우리 회사 양식(자료실 "양식")에 값만 바꾸면 되면: list_templates → read_template_layout → fill_template (거의 무료, 서식 그대로).
- 양식이 없거나, 다른 회사 양식을 "참고해서" 만들거나, 새 디자인이면: run_file_task (참고 파일은 referenceFileIds, "새로 디자인"만 design=true). 앞서 만든 파일을 고칠 때는 대화 기록의 [파일 작업: id=…] 를 baseJobId 로 mode=edit.
- 참고 자료는 첨부·search_library 로 찾고, 숫자·이름은 사용자가 준 것만 씁니다.
- 서식이 중요하지 않은 간단한 글 문서(회의록·메모)는 propose_create_document, 데이터 표는 propose_xlsx_report, 자료실 정리는 propose_organize_files(확인을 눌러야 반영). 첨부 id 는 대화 기록의 [첨부] 줄.
- run_file_task 뒤에는 "만들기 시작했습니다(1~3분, 아래 카드)"라고만 짧게. fill_template 뒤에는 결과·경고를 한두 줄로.
- 답은 한국어로 짧게.`;

export async function chat(u: SessionUser, i: z.infer<typeof chatInput>, providerArg?: AiProvider, signal?: AbortSignal, onEvent?: (e: ChatEvent) => void) {
  // #497 R44 로컬 10/24: 첫 글자 시각 기록(서버 기준, 요청 받은 때부터) — first = 처음 보낸 글자, answer = 마지막 도구 단계 뒤 답 첫 글자(화면에 남는 답), chunks = 그 답을 몇 조각으로 보냈는지
  const t0 = Date.now(); const tm = { first: 0, answer: 0, chunks: 0 };
  const onText0 = onEvent ? (delta: string) => { const now = Date.now(); if (!tm.first) tm.first = now; if (!tm.answer) tm.answer = now; tm.chunks++; onEvent({ type: 'text', delta }); } : undefined;
  const sink = onText0 ? noiseSink(onText0) : null; // #650: 답 첫 줄의 도구 안내 문장은 화면에도 안 보냄
  const onText = sink ? (d: string) => sink.push(d) : undefined;
  // 로컬 10/20(심사): 체험 계정도 대화는 됨(체험 조직 한도 안) — 제안 확인·자료로 채우기 등 바깥에 영향 주는 것은 그대로 막음(denyDemo)
  if (!aiEnabled()) throw notFound();
  await (await import('../menuPerms')).requireMenu(u, 'assistant', 'use'); // V13 메뉴 권한
  const tenant = tenantOf(u);
  const userText = (i.text ?? (i.messages?.[i.messages.length - 1]?.role === 'user' ? i.messages[i.messages.length - 1].text : '')).trim();
  if (!userText) throw badRequest('질문을 입력하세요');
  await (await import('../plans')).assertAiRequest(u, { legacy: true }); // 대표 10/24 ② 회사 월 AI 예산(원)·예전 달러 한도 + V10 요금제 월 AI 요청 수
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
  onEvent?.({ type: 'start', threadId }); // 여기까지 오면 사전 점검 통과 — 스트리밍 응답을 연다
  const fileNames = i.fileIds?.length ? (await db()<{ file_name: string }[]>`select file_name from library_files where id = any(${i.fileIds}::uuid[])`).map((f) => f.file_name) : [];
  if (blocked) {
    await T.saveTurn(u, threadId, { text: userText, fileIds: i.fileIds, fileNames }, { text: blocked, status: 'blocked', reason: blocked });
    return { reply: blocked, proposals: [], tools: [], threadId, blocked: true };
  }
  const hist = i.threadId ? await T.threadHistory(i.threadId) : null;
  const settings = await T.aiSettings(tenant);
  // 문서 요청이면 가벼운 모델·문서 도구만(부록 2 ⑥) — 문서 작업이 꺼져 있으면 보통 경로
  // 대표 지적(10/19 ①): "○○한테 보고서 만들라고 해줘" 는 문서 만들기가 아니라 업무 배정 — 문서 경로(업무 도구 없음)로 보내지 않음
  const assignHint = intentHint(userText);
  const docMode = !providerArg && settings.doc_engine && !assignHint && isDocRequest(userText);
  const light = !docMode && !assignHint && lightQuestion(userText, !!i.fileIds?.length); // V45: 조회 질문은 빠른 모델
  const provider: AiProvider = providerArg ?? anthropicProvider(docMode || light ? { tier: 'fast' } : {});

  let context = '';
  if (i.taskId) {
    const d = await getTaskDetail(u, i.taskId); // 볼 수 없는 업무면 여기서 404
    context = `\n지금 사용자가 보고 있는 업무: id=${i.taskId}, 제목="${(d.task as any).title}". "이 업무"는 이것을 뜻합니다.`;
  }
  if (i.context && !i.taskId) context += await pageContext(u, i.context);
  if (i.space) context += await spaceContext(u, i.space);
  context += assignHint;
  const Pn = await import('./persona');
  const [co, me] = await Promise.all([Pn.companyAi(u), Pn.writerOf(u)]);
  // V45 원가: 고정부(규칙 + 회사 정보)는 캐시 구간으로 따로 — 날짜·사용자·화면 문맥·요약은 그 뒤(매번 바뀌어도 고정부 캐시는 다시 씀)
  const system: { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] = [
    { type: 'text', text: `${docMode ? DOC_SYSTEM : SYSTEM}\n\n${Pn.companyBlock(co)}`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `오늘: ${todaySeoul()} (${DateTime.now().setZone(TZ).toFormat('cccc', { locale: 'ko' })}), 사용자: ${u.name}${me.title ? ` ${me.title}` : ''}(id=${u.id}, 역할=${u.role}).${context}${hist?.summary ? `\n\n이 대화의 앞부분 요약:\n${hist.summary}` : ''}\n답은 꼭 필요한 만큼만 짧게(보통 5줄 이내).` },
  ];
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
  const pick = () => { const base = docMode ? TOOLS.filter((t) => DOC_TOOL_NAMES.has(t.name)) : toolsFor(userText, !!i.fileIds?.length, c.allTools, i.space); return !docMode && settings.web_tools ? [...base, ...WEB_TOOLS] : base; };
  let tools = pick();
  if (i.fileIds?.length && fbConf) c.confidential = true;
  const sql = db();
  const steps: string[] = [];
  let reply = '';
  let turnCost = 0, inTok = 0, outTok = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal?.aborted) break;
    tools = pick(); // more_tools 를 부르면 다음 단계부터 모든 도구
    sink?.reset();
    const r = await provider.chat({ system, messages, tools, signal, ...(onText ? { onText } : {}) }).catch((e: any) => {
      if (signal?.aborted) return null; // 부록 A2: 사용자가 멈춤
      if (e instanceof HttpError) throw e; // V23-1: 크레딧 부족·요청 한도·일시 장애 문구
      throw new HttpError(502, 'ai_unavailable', `AI 서버 응답 오류${e?.status ? ` (${e.status})` : ''}. 잠시 후 다시 시도하세요.`);
    });
    sink?.flush();
    if (!r) break;
    const used = r.usage;
    turnCost += costUsd(r.model ?? provider.model, used); inTok += used.input_tokens; outTok += used.output_tokens;
    await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose, web_searches)
      values (${tenant}, ${u.id}, ${requestId}, ${provider.name}, ${r.model ?? provider.model}, ${used.input_tokens}, ${used.output_tokens}, ${used.cache_read_input_tokens ?? 0},
        ${used.cache_creation_input_tokens ?? 0}, ${costUsd(r.model ?? provider.model, used)}, ${i.space === 'sales' ? 'sales_assistant' : i.space === 'marketing' ? 'marketing_assistant' : 'assistant'}, ${(used as any).server_tool_use?.web_search_requests ?? 0})`; // #412 공간별 AI 사용량 구분
    const text = cleanReply(r.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim()); // #650 도구 안내 문장 제거
    if (r.stop_reason === 'refusal') { reply = '이 요청은 처리할 수 없습니다. 다르게 요청해 주세요.'; break; }
    if (r.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: r.content as never }); continue; }
    if (r.stop_reason !== 'tool_use') { reply = text || (r.stop_reason === 'max_tokens' ? '답이 너무 길어 중간에 끊겼습니다. 범위를 좁혀 다시 요청해 주세요.' : ''); break; }
    messages.push({ role: 'assistant', content: r.content as never });
    const uses = r.content.filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use');
    onEvent?.({ type: 'tools', names: uses.map((t) => t.name) });
    tm.answer = 0; tm.chunks = 0; // 도구 전에 쓴 말은 화면에서 지워짐 — 답 첫 글자는 다음 단계부터
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
  const timing = { firstMs: tm.first ? tm.first - t0 : null, answerMs: tm.answer ? tm.answer - t0 : null, totalMs: Date.now() - t0, chunks: tm.chunks };
  await audit(sql, u.id, 'ai.chat', i.taskId ? 'task' : null, i.taskId ?? null, { tools: steps, proposals: c.proposals.map((p) => p.id), threadId, timing }, null);
  await T.saveTurn(u, threadId, { text: userText, fileIds: i.fileIds, fileNames }, { text: reply, proposalIds: c.proposals.map((p) => p.id), docJobIds: c.docJobs?.map((j) => j.id), cost: turnCost, inTok, outTok });
  if (c.confidential) await sql`update ai_threads set confidential = true where id = ${threadId}`; // 사용 내역에서 기밀 권한 없는 사람에게 내용 가림
  await T.maybeSummarize(u, threadId);
  const budget = await G.userBudgetAlerts(u).catch(() => null); // 80%·100% 알림
  // #753 자료 카드: 찾은 자료 중 답에 이름이 나온 것(최대 8) — 답이 '자료실에서 찾았다'고만 하면 찾은 순서대로
  const named = (c.found ?? []).filter((f) => (f.title && reply.includes(f.title)) || (f.fileName && reply.includes(f.fileName)));
  const files = (named.length ? named : /자료실/.test(reply) ? c.found ?? [] : []).slice(0, 8);
  return { reply, proposals: c.proposals, tools: steps, threadId, costKrw: Math.round(turnCost * usdKrw()), budget, timing, ...(kept.length ? { kept } : {}), ...(c.docJobs?.length ? { docJobs: c.docJobs } : {}), ...(files.length ? { files } : {}) };
}

// ---------------- 제안 실행 (사람이 [확인]) ----------------
export async function decideProposal(u: SessionUser, id: string, accept: boolean, patch?: Record<string, unknown>) {
  denyDemo(u);
  const sql = db();
  const [p] = await sql<any[]>`select * from ai_proposals where id = ${id} and user_id = ${u.id}`;
  if (!p) throw notFound('제안이 없습니다');
  if (p.status !== 'pending') throw badRequest('이미 처리한 제안입니다');
  if (!accept) {
    await sql`update ai_proposals set status = 'cancelled', decided_at = now() where id = ${id}`;
    return { ok: true, status: 'cancelled' };
  }
  // V19: 문자 시안은 카드에서 고친 받는 번호·본문을 함께 받는다(그 종류만)
  const x = p.kind === 'draft_sms' && patch ? { ...p.payload, ...(Array.isArray(patch.to) ? { to: patch.to } : {}), ...(typeof patch.body === 'string' ? { body: patch.body } : {}) } : p.payload;
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
        const ti = taskInput.parse(x.input);
        // #794: 예전 제안(mode 없음)은 만들던 대로 각자, 새 제안은 기본 함께 담당 1건(첫 사람 = 주 담당)
        const ids0 = [...new Set(ti.assigneeIds ?? [])];
        const r: any = (x.mode ?? 'each') === 'each' || ids0.length < 2 ? await createTasksForAssignees(u, ti)
          : await createTask(u, { ...ti, assigneeIds: undefined, assigneeId: ids0[0], coAssigneeIds: ids0.slice(1) });
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
      case 'set_security': {
        const done: string[] = [];
        for (const it of x.items as { fileId: string }[]) { await updateLibraryFile(u, it.fileId, { security: x.security }); done.push(it.fileId); } // 등급 올리기·내리기 권한은 updateLibraryFile 이 검사
        result = { files: done, security: x.security, link: done.length === 1 ? `/library?file=${done[0]}` : '/library' };
        break;
      }
      case 'company_settings': {
        const { attachToLibrary, confWords, ...profile } = x as { attachToLibrary?: boolean; confWords?: string[]; industry?: string; business?: string; customers?: string; tone?: string; cautions?: string };
        if (attachToLibrary !== undefined || confWords !== undefined) await setAttachToLibrary(u, { on: attachToLibrary, confWords });
        if (Object.values(profile).some((v) => v !== undefined)) await saveAiProfile(u, profile);
        result = { link: '/admin/company' };
        break;
      }
      case 'draft_sms': { // 사람이 휴대폰 문자앱으로 보낸 뒤 [보냈어요] → 기록(외부 발송 권한)
        const { logSms, canSend } = await import('../mailbox');
        const to = z.array(z.string().trim().regex(/^[0-9+\-\s()]{8,20}$/, '전화번호 형식이 아닙니다')).min(1, '받는 번호가 없습니다').max(20).parse(x.to);
        const body = z.string().trim().min(1).max(2000).parse(x.body);
        if (x.taskId) { const r = await logSms(u, { taskId: x.taskId, to, body }, null); result = { outboxId: r.id, link: `/tasks/${x.taskId}` }; }
        else {
          if (!(await canSend(u))) throw forbidden('문자 보내기 권한이 없습니다. 대표에게 요청하세요(설정 > 메뉴 권한 > 외부 발송)');
          const oid = crypto.randomUUID();
          await sql`insert into outbox (id, tenant, channel, status, created_by, to_addrs, subject, body_text, message_id, sent_at) values (${oid}, ${tenantOf(u)}, 'sms:handoff', 'sent', ${u.id}, ${to}, '문자', ${body}, ${`sms-${oid}`}, now())`;
          result = { outboxId: oid, link: '/mail/outbox' };
        }
        break;
      }
      case 'draft_quote': { const r = await createQuote(u, quoteInput.parse(x), null); result = { quoteId: r.id, no: r.no, fileId: r.fileId, link: r.link }; break; }
      case 'quote_template': { const r = await saveTemplate(u, templateInput.parse(x), null); result = { templateId: r.id, link: '/quotes' }; break; }
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
  await (await import('../plans')).assertAiRequest(u, { legacy: true });
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
  const PAGE: Record<string, string> = { home: '홈(오늘의 일정)', tasks: '업무 목록', calendar: '캘린더', library: '자료실', revenue: '매출', reports: '주간 보고', messages: '메시지', other: '' };
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

/** V19 견적서 제안 카드 [PDF 미리보기] — 제안 주인만, 저장 없이 그린다 */
export async function proposalQuotePdf(u: SessionUser, id: string) {
  const [p] = await db()<any[]>`select payload, kind from ai_proposals where id = ${id} and user_id = ${u.id}`;
  if (!p || p.kind !== 'draft_quote') throw notFound('견적서 제안이 없습니다');
  const pv = await previewQuote(u, quoteInput.parse(p.payload));
  if (pv.overflow || !pv.pdf) throw badRequest('1페이지 초과 — 품목을 묶어 주세요');
  return pv.pdf;
}
