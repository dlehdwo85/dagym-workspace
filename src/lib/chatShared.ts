// 메신저 2차(대표 10/20 카톡 수준 B10·B11) — 서버(chat.ts 검사·미리보기 글)와 화면(Messenger.tsx)이 같이 쓰는 값. 서버 전용 모듈을 들이지 않는다.

/** 회사용 기본 스티커 1묶음 — 그림 파일 없이 이모지 + 짧은 말(남의 캐릭터·브랜드 없음). body 에는 text 가 들어가 목록 미리보기·검색에 쓰인다 */
export const STICKERS = [
  { code: 'ok', emoji: '👌', text: '확인했습니다', tone: 'teal' },
  { code: 'yes', emoji: '🙆', text: '넵!', tone: 'teal' },
  { code: 'thanks', emoji: '🙏', text: '감사합니다', tone: 'amber' },
  { code: 'goodjob', emoji: '👏', text: '수고하셨습니다', tone: 'violet' },
  { code: 'like', emoji: '👍', text: '좋아요', tone: 'sky' },
  { code: 'wait', emoji: '⏳', text: '잠시만요', tone: 'slate' },
  { code: 'meeting', emoji: '🗓️', text: '회의 중입니다', tone: 'slate' },
  { code: 'go', emoji: '🚗', text: '출발합니다', tone: 'sky' },
  { code: 'arrived', emoji: '📍', text: '도착했습니다', tone: 'rose' },
  { code: 'fighting', emoji: '💪', text: '화이팅!', tone: 'amber' },
  { code: 'congrats', emoji: '🎉', text: '축하합니다', tone: 'violet' },
  { code: 'sorry', emoji: '🙇', text: '죄송합니다', tone: 'rose' },
] as const;
export type Sticker = (typeof STICKERS)[number];
export const stickerOf = (code: string | null | undefined): Sticker | null => STICKERS.find((s) => s.code === code) ?? null;

/** 메시지 반응으로 쓸 수 있는 이모지(앞 6개 = 처음 쓰는 사람의 '자주 쓰는 반응') */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '🙏', '✅', '👏', '🎉', '🔥', '😢', '💯', '👀', '😊', '🤔', '🙌', '💪'] as const;
export const QUICK_DEFAULT = REACTIONS.slice(0, 6) as readonly string[];

/** @전체 — 멘션 표기 @[전체](ALL_ID). 사람 id 와 같은 모양이라 기존 멘션 표시·글자 변환이 그대로 동작 */
export const ALL_ID = '00000000-0000-0000-0000-000000000000';

/** 투표 보기 수 */
export const POLL_MIN = 2;
export const POLL_MAX = 10;

/** 일정 카드 시각 글: '10월 25일 (토) 오후 2:00~오후 3:00' · 종일 '10월 25일 (토) 종일'(끝은 다음 날 0시 = 그날까지) — 서울 기준 */
const kday = (d: Date) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(d);
const ktime = (d: Date) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(d);
const ymdK = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
export function whenText(start: Date, end: Date, allDay: boolean) {
  if (allDay) { const last = new Date(end.getTime() - 1); return ymdK(last) > ymdK(start) ? `${kday(start)} ~ ${kday(last)} 종일` : `${kday(start)} 종일`; }
  return ymdK(start) === ymdK(end) ? `${kday(start)} ${ktime(start)}~${ktime(end)}` : `${kday(start)} ${ktime(start)} ~ ${kday(end)} ${ktime(end)}`;
}
