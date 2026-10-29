import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { audit } from '@/lib/log';
import { refitNotices } from '@/lib/sales/collectors/store';
import { lookupNotices } from '@/lib/sales/noticeDiag';

export const maxDuration = 60;
/** 185차(로컬 10/26 19:20 A4): 플랫폼 운영자 — 공고 번호·제목으로 영업 DB 줄 찾기(사라진·합쳐진 줄 포함, 원천·판정·목록에서 빠지는 이유) */
export const GET = handler(async ({ req, user }) => {
  if (!user.platformAdmin) throw notFound();
  const u = new URL(req.url);
  const no = String(u.searchParams.get('no') ?? '').trim();
  // 245차(로컬 20:55): g2b=1 이면 나라장터 참가 제한 조회를 지금 다시 물어 응답만(저장 안 함) — 번호가 없으면 이미 물었는데 값이 없는 최근 3건
  if (u.searchParams.get('g2b') === '1' && (!no || /^[A-Za-z0-9]{6,24}(?:-\d{1,3})?$/.test(no))) return { g2b: await (await import('@/lib/sales/collectors/g2b')).probeG2bLimits(no || null) };
  // 258차(로컬 10/29 09:20): g2b=dates 면 그 공고의 날짜 칸·계약 방식을 지금 물어 응답만(저장 안 함) — 마감일이 빈 이유 확인용
  if (u.searchParams.get('g2b') === 'nodl') return { g2bNoDeadline: await (await import('@/lib/sales/collectors/g2b')).g2bNoDeadline() }; // 259차: 입찰 마감이 API 에 없는 나라장터 공고 수
  if (u.searchParams.get('g2b') === 'dates' && /^[A-Za-z0-9]{6,24}(?:-\d{1,3})?$/.test(no)) return { g2bDates: await (await import('@/lib/sales/collectors/g2b')).probeG2bDates(no) };
  const out = await lookupNotices({ no: u.searchParams.get('no'), q: u.searchParams.get('q') }, user);
  // 241차(로컬 10/28 19:20): probe=1 이면 K-apt 상세를 지금 받아 응답 코드·길이·취소 여부만(저장 안 함) — 수집이 그 번호 상세를 받는지 확인용
  if (u.searchParams.get('probe') === '1' && /^(?:A?\d{10,20}|kg2b_\d{1,12}|[A-Za-z]{1,6}\d{4,20})$/.test(no)) return { ...out, probe: await (await import('@/lib/sales/collectors/kapt')).probeKaptDetail(no) };
  return out;
});
/** 지금 규칙으로 다시 판정 — 수집기 실행 때도 자동으로 돎. days = 처음 본 때 기준 최근 n일(기본 120).
 *  185차 '관련 아님' 줄 올리기 + 191차(대표 10/27 정정) 지금 규칙이 뺀 사업 내리기·다시 판정이 올린 줄 되돌리기 */
const input = z.object({ refit: z.literal(true), days: z.number().int().min(1).max(1100).optional() });
export const POST = handler(async ({ req, user }) => {
  if (!user.platformAdmin) throw notFound();
  const i = await body(req, input);
  const r = await refitNotices({ days: i.days });
  await audit(db(), user.id, 'platform.sales_notices.refit', 'sales_src_rows', null, { days: i.days ?? 120, checked: r.checked, raised: r.raised, reopened: r.reopened, lowered: r.lowered, changed: r.changed, linked: r.linked, loweredIds: r.loweredIds.slice(0, 50) }).catch(() => {});
  return { checked: r.checked, raised: r.raised, reopened: r.reopened, lowered: r.lowered, changed: r.changed, linked: r.linked, loweredIds: r.loweredIds.slice(0, 50), changedIds: r.changedIds.slice(0, 50) };
});
