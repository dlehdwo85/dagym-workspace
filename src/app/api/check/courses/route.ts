import { handler, body } from '@/lib/api';
import { courseInput, listCourses, saveCourse } from '@/lib/check/rounds';

/** 점검 코스(공간 유형을 도는 순서): 목록 = 점검하기 권한(?all=1 이면 안 쓰는 것도) · 만들기 = 가이드 편집 권한 */
export const GET = handler(async ({ req, user }) => listCourses(user, { all: req.nextUrl.searchParams.get('all') === '1' }));
export const POST = handler(async ({ req, user }) => saveCourse(user, null, await body(req, courseInput)));
