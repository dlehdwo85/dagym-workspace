/** AI 사용 기록(ai_usage.purpose) → 화면 이름. 사용량·요금제와 사람별 AI 한도 화면이 같이 씀. 표에 없는 것은 '기타 AI 기능' 한 줄로 */
export const AI_PURPOSE: Record<string, string> = { assistant: 'AI 비서', library_organize: '자료실 자동 정리', revenue: '매출 AI 분석', revenue_extract: '매출 자료로 입력', classify: '질문 분류(업무 여부)', summary: '긴 대화 요약', chat_to_task: '메시지 → 업무', fill: '자료로 채우기', doc_engine: '문서 작업(파일 만들기·분석)', doc_job: '문서 작업(파일 만들기·분석)',
  task_assist: '업무 AI 도우미', inquiry_summary: '문의 요약', voice: '말로 등록 정리', mail_draft: '메일·문자 초안', briefing: '아침 브리핑', weekly_report: '주간 보고 초안', meeting: '회의 메모 정리',
  marketing_produce: '마케팅 자동 원고', marketing_caption: '마케팅 캡션 초안' };
export const OTHER_AI = '기타 AI 기능';
export const aiPurposeLabel = (p: string) => AI_PURPOSE[p] ?? OTHER_AI;
/** 기능별 행: 이름이 같은 것(문서 작업 두 종류·기타)은 한 줄로 합침 */
export function byPurposeRows(rows: { purpose: string; cost: number; requests: number }[]) {
  const m = new Map<string, { k: string; label: string; cost: number; n: number }>();
  for (const x of rows) { const label = aiPurposeLabel(x.purpose); const cur = m.get(label) ?? { k: label, label, cost: 0, n: 0 }; cur.cost += x.cost; cur.n += x.requests; m.set(label, cur); }
  return [...m.values()].sort((a, b) => b.cost - a.cost);
}
