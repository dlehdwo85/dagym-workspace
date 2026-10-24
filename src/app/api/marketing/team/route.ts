import { handler, body } from '@/lib/api';
import { teamAct, teamAction, teamView } from '@/lib/mktTeam';

export const maxDuration = 120; // 대표 10/24 ①: 만드는 일은 글 모델(최상 모델 30~60초)
/** #499-7 AI 마케팅팀: 역할 7개(일정·켜짐·마지막 실행·기록·기억) + 기획 담당 오늘 주제 */
export const GET = handler(async ({ user }) => teamView(user));
/** 관리자: 역할 켜기·끄기 · [지금 일하기](기획·광고 리서처·보고) · 기획 담당 브랜드 · 기억 더하기·지우기 */
export const POST = handler(async ({ req, user }) => teamAct(user, await body(req, teamAction)));
