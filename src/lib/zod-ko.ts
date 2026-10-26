import { z, type ZodError } from 'zod';

/** U-0b 검증 오류를 "항목: 이유" 한국어 문장으로 */
export const FIELD_LABEL: Record<string, string> = {
  title: '제목', name: '이름', email: '이메일', password: '비밀번호', newPassword: '새 비밀번호', currentPassword: '현재 비밀번호',
  description: '설명', status: '상태', priority: '우선순위', assigneeId: '담당자', orgUnitId: '소속 조직', orgUnitIds: '소속 조직',
  projectId: '프로젝트', brandId: '브랜드', startDate: '시작일', dueDate: '마감일', dueTime: '마감 시각', start: '시작', end: '종료',
  allDay: '종일', location: '장소', calendarId: '캘린더', attendeeIds: '참석자', recurrence: '반복', recurrenceRule: '반복 규칙', rrule: '반복 규칙',
  reminderMinutes: '미리 알림', checklist: '체크리스트', subtasks: '하위 업무', collaboratorIds: '협업자', dependsOn: '선행 업무',
  role: '역할', phone: '연락처', content: '내용', body: '내용', url: '주소', fileName: '파일 이름', size: '파일 크기', mimeType: '파일 형식',
  taskType: '업무 유형', photoRequired: '필요한 사진 수', approvalLineId: '결재선', steps: '결재 단계', label: '이름', type: '형식',
  options: '선택지', aggregate: '집계 방식', trigger: '실행 조건', conditions: '조건', actions: '동작', kind: '종류', agree: '개인정보 동의',
  photo: '사진', view: '보기', from: '시작일', to: '종료일', q: '검색어', limit: '개수', color: '색', tags: '태그', version: '버전',
  sectionId: '섹션', parentId: '상위 업무', intoId: '통합 대상 업무', comment: '의견', decision: '결재 결과', value: '값',
  hoursBefore: '알림 시점', dueInDays: '마감까지 일수', scope: '적용 범위', occurrenceStart: '반복 회차', meetingUrl: '화상 회의 링크',
};

const kind = (t: unknown) => (t === 'string' ? '글자' : t === 'number' ? '숫자' : t === 'boolean' ? '예/아니오' : t === 'array' ? '목록' : '값');

export const koErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.received === 'undefined' || issue.received === 'null') return { message: '필수 항목입니다' };
      return { message: `${kind(issue.expected)} 형식이어야 합니다` };
    case 'too_small':
      if (issue.type === 'string') return { message: Number(issue.minimum) <= 1 ? '비어 있을 수 없습니다' : `${issue.minimum}자 이상 입력하세요` };
      if (issue.type === 'array') return { message: `${issue.minimum}개 이상 필요합니다` };
      return { message: `${issue.minimum} 이상이어야 합니다` };
    case 'too_big':
      if (issue.type === 'string') return { message: `${issue.maximum}자 이하로 입력하세요` };
      if (issue.type === 'array') return { message: `${issue.maximum}개 이하만 가능합니다` };
      return { message: `${issue.maximum} 이하여야 합니다` };
    case 'invalid_string':
      if (issue.validation === 'email') return { message: '이메일 형식이 아닙니다' };
      if (issue.validation === 'url') return { message: '주소(URL) 형식이 아닙니다' };
      if (issue.validation === 'uuid') return { message: '잘못된 식별자입니다' };
      if (issue.validation === 'regex') return { message: '형식이 올바르지 않습니다' };
      return { message: '형식이 올바르지 않습니다' };
    case 'invalid_enum_value':
      return { message: `허용되지 않는 값입니다 (${issue.options.slice(0, 6).join(', ')} 중 하나)` };
    case 'invalid_date':
      return { message: '날짜 형식이 아닙니다' };
    case 'unrecognized_keys':
      return { message: '알 수 없는 항목이 있습니다' };
    default:
      return { message: ctx.defaultError };
  }
};
z.setErrorMap(koErrorMap);

/** 사람이 읽는 문장 + 항목별 오류 */
export function describeZod(e: ZodError) {
  const fields: { path: string; label: string; message: string }[] = [];
  for (const i of e.issues) {
    const key = [...i.path].reverse().find((p) => typeof p === 'string') as string | undefined;
    const label = key ? FIELD_LABEL[key] ?? key : '입력';
    const idx = i.path.find((p) => typeof p === 'number');
    fields.push({ path: i.path.join('.'), label: idx !== undefined ? `${label} ${Number(idx) + 1}번째` : label, message: i.message });
  }
  const uniq = [...new Map(fields.map((f) => [f.label + f.message, f])).values()];
  const text = uniq.slice(0, 3).map((f) => `${f.label}: ${f.message}`).join(' · ') + (uniq.length > 3 ? ` 외 ${uniq.length - 3}건` : '');
  return { message: `입력값을 확인해 주세요 — ${text}`, fields: uniq };
}
