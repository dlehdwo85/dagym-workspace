// 282차 #823(대표 10/31 "마케팅 관련 알람 너무 많이 옴 필요한 알림만 올 수 있도록"): 마케팅 알림을 항목으로 나눠 기본값을 다르게 —
// 휴대폰 알림 = 주 1회 묶음 승인 요청 · 마감 임박 묶음 · 게시 실패 · 돈(광고 예산·충전·상한) / 알림함만 = 시안별 승인 요청·AI 마케터 제안·게시 완료·보고서 /
// 안 받음 = '시안 제작 중'(진행 상황일 뿐). 사람마다 설정 › 알림 › 마케팅 알림에서 항목별로 바꿈(notification_prefs 의 'mkt:항목' 줄).
// 알림은 모두 'review_requested' 같은 종류로 나가서 종류별 설정으로는 나눌 수 없었음 → 제목 머리로 항목을 정함(새 알림이 생기면 여기에 한 줄).
export type MktKind = 'weekly' | 'deadline' | 'publish_fail' | 'money' | 'each' | 'ai' | 'result' | 'drafting';
export type MktMode = 'push' | 'inbox' | 'off';
export const MKT_MODES: MktMode[] = ['push', 'inbox', 'off'];
export const MKT_MODE_LABEL: Record<MktMode, string> = { push: '휴대폰 알림', inbox: '알림함만', off: '안 받음' };
export const MKT_KINDS: { kind: MktKind; label: string; desc: string; def: MktMode }[] = [
  { kind: 'weekly', label: '주간 묶음 승인 요청', desc: '한 주 게시 글을 한 번에 올렸을 때 1건', def: 'push' },
  { kind: 'deadline', label: '승인 마감 임박(묶음)', desc: '게시 3일 안 남았는데 승인 안 된 글 n건', def: 'push' },
  { kind: 'publish_fail', label: '게시 실패·삭제', desc: '자동 게시가 실패했거나 게시물이 지워졌을 때', def: 'push' },
  { kind: 'money', label: '돈 관련', desc: '광고 예산 승인·충전 필요·월 광고비 상한·AI 한도로 제작 멈춤', def: 'push' },
  { kind: 'each', label: '시안별 승인 요청', desc: '시안 1건마다 승인 요청·수정본·마감 n시간 전·미룸·품질 검사·사진 필요', def: 'inbox' },
  { kind: 'ai', label: 'AI 마케터 제안·신호', desc: '고친 안·운영 신호·주간 제안·광고 컨셉·오늘 주제·경쟁 광고 분석·운영 목표', def: 'inbox' },
  { kind: 'result', label: '게시 완료·보고서', desc: '게시 완료·월간 보고·광고 성과 분석', def: 'inbox' },
  { kind: 'drafting', label: '시안 제작 중', desc: '시안을 만드는 중이라는 진행 알림', def: 'off' },
];
const RULES: [RegExp, MktKind][] = [
  [/^시안 제작 중:/, 'drafting'],
  [/게시 \d+건을 한 번에 올렸습니다/, 'weekly'],
  [/^게시 3일 안 남았는데 승인 안 된 글/, 'deadline'],
  [/^(게시 실패|게시물 삭제됨)/, 'publish_fail'],
  [/^(충전 필요|월 광고비 상한|마케팅 자동 제작 멈춤)|광고 예산 계획/, 'money'],
  [/^(AI 마케터|기획 담당|경쟁 광고|광고 컨셉)|운영 목표/, 'ai'],
  [/^게시 완료|월간 보고|광고 성과 분석/, 'result'],
  [/^(승인 요청|승인 대기|수정본 승인 요청|시안을 (붙여|다시)|품질 검사 미통과|사진 필요|주제 필요|제작 전 승인 필요|제작 요청 카드|승인 마감|옮길 날짜가 없어)/, 'each'],
];
/** 제목 → 항목(모르는 제목은 null = 예전처럼 종류별 설정) */
export function mktKindOf(title: string): MktKind | null {
  const t = title.trim();
  for (const [re, k] of RULES) if (re.test(t)) return k;
  return null;
}
export const mktDefault = (k: MktKind): MktMode => MKT_KINDS.find((x) => x.kind === k)?.def ?? 'inbox';
export const mktPrefKey = (k: MktKind) => `mkt:${k}`;
