import { db } from './db';

/** #77 처음 사용 안내(코치마크 투어) — 사람별·화면별 1번. 화면 쪽 단계 정의는 components/Tour.tsx */
export const TOUR_IDS = ['home', 'tasks', 'calendar', 'messages', 'library', 'assistant', 'task'] as const;
export type TourId = (typeof TOUR_IDS)[number];

/** 자동으로 띄울지: 기본 켬. TOURS_AUTO=0 이면 끔(시험 서버 — 모든 화면 시험을 가리지 않게), 지원 모드(대신 보기)는 끔 */
export const toursAuto = (u: { support?: unknown }) => process.env.TOURS_AUTO !== '0' && !u.support;

export async function seenTours(userId: string): Promise<string[]> {
  return (await db()<{ tour_id: string }[]>`select tour_id from user_tours where user_id = ${userId}`).map((r) => r.tour_id);
}
export async function markTourSeen(userId: string, tourId: TourId) {
  await db()`insert into user_tours (user_id, tour_id) values (${userId}, ${tourId}) on conflict (user_id, tour_id) do update set seen_at = now()`;
}
/** [사용 안내 다시 보기] — 이 사람의 기록을 지워 화면마다 처음처럼 */
export async function resetTours(userId: string) {
  await db()`delete from user_tours where user_id = ${userId}`;
}
