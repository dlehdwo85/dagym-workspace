// 168차(CI 10/26 월요일 아침 실패): 달력에 매인 정기 작업 — 월요일 분석·방향 카드·주간 운영 제안·경쟁 광고 주간 분석(mktOps), 25일 이후 다음 달 초안·월요일 주간 리뷰·1~3일 결산(mktGoals),
// 25일 이후 다음 달 예산 초안(mktOps), 금요일 16시 주간 보고 초안(briefing) — 은 시험 서버(tests/helpers.mjs CALENDAR_JOBS=off)에서 돌지 않는다.
// 시험이 월요일 아침·25일 뒤에 돌면 이 작업들이 tick 안에서 AI 를 불러 가짜 AI 응답 순서가 흔들리고 기록이 늘어 다른 시험이 깨졌다. 그 작업들의 시험은 API 로 직접 부른다.
// 'any' = 달력과 무관하게 늘 돎(그 가지를 tick 으로 시험할 때), 없으면 실제 달력.
export const calendar = (real: boolean): boolean => (process.env.CALENDAR_JOBS === 'off' ? false : process.env.CALENDAR_JOBS === 'any' ? true : real);
