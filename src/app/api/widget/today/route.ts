import { handler } from '@/lib/api';
import { widgetToday } from '@/lib/widget';

/** 로컬 10/20 바탕화면 위젯: 오늘·지난 업무 5·남은 일정 3·수·다음 일정 — 앱 세션 토큰(Bearer)·쿠키 모두. 15분 캐시 허용(개인 응답이라 private) */
export const GET = handler(async ({ user }) => {
  const body = await widgetToday(user);
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=900' } });
});
