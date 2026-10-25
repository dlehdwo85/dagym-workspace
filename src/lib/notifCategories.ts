// 앱 1.1.3 알림창 버튼(#130·#478) — iOS 는 버튼 묶음(카테고리)을 앱이 미리 등록해 두고 푸시의 aps.category 로 고른다.
// 서버(push.ts)와 앱(native.ts registerActionTypes)이 이 표 하나를 같이 쓴다. 버튼은 notifActions.actionsFor 와 같아야 함(알람 [해제][10분 뒤]는 'alarm' 카테고리)
// #618(대표 10/25): 모든 알림 [확인] + 종류별 1개 — 일정 [10분 뒤]·마감 [완료]·승인 대기 [승인함 열기](승인함이 아니면 [열기]). open 버튼은 앱이 그 화면을 연다(서버 호출 없음)
export type WnAction = { id: string; label: string; input?: 'text'; open?: true };
export const wnCategory = (actions: { id: string }[]) => `wn.${actions.map((a) => a.id).join('.')}`;
export const WN_SETS: WnAction[][] = [
  [{ id: 'approve', label: '승인' }, { id: 'changes', label: '수정 요청', input: 'text' }],
  [{ id: 'approve_ext', label: '승인' }, { id: 'reject_ext', label: '거절' }],
  [{ id: 'reply', label: '답글', input: 'text' }, { id: 'ack', label: '확인' }],
  [{ id: 'ack', label: '확인' }, { id: 'today', label: '오늘 할 일에 넣기' }],
  [{ id: 'ack', label: '확인' }],
  [{ id: 'ack', label: '확인' }, { id: 'snooze', label: '10분 뒤' }],
  // 대표 10/25 22:20(15-13): 마감 [확인][완료] 묶음은 뺌 — 마감 알림은 [확인]만(알람형은 [해제][10분 뒤])
  [{ id: 'ack', label: '확인' }, { id: 'open', label: '승인함 열기', open: true }],
  [{ id: 'ack', label: '확인' }, { id: 'view', label: '열기', open: true }],
];
export const WN_CATEGORY_IDS = new Set(WN_SETS.map(wnCategory));
export const WN_ACTION_IDS = new Set(WN_SETS.flat().map((a) => a.id));
/** 서버 처리 없이 그 화면을 여는 버튼 */
export const WN_OPEN_IDS = new Set(WN_SETS.flat().filter((a) => a.open).map((a) => a.id));
