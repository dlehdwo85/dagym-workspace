// 앱 1.1.3 알림창 버튼(#130·#478) — iOS 는 버튼 묶음(카테고리)을 앱이 미리 등록해 두고 푸시의 aps.category 로 고른다.
// 서버(push.ts)와 앱(native.ts registerActionTypes)이 이 표 하나를 같이 쓴다. 버튼은 notifActions.actionsFor 와 같아야 함(알람 [해제][10분 뒤]는 'alarm' 카테고리)
export type WnAction = { id: string; label: string; input?: 'text' };
export const wnCategory = (actions: { id: string }[]) => `wn.${actions.map((a) => a.id).join('.')}`;
export const WN_SETS: WnAction[][] = [
  [{ id: 'approve', label: '승인' }, { id: 'changes', label: '수정 요청', input: 'text' }],
  [{ id: 'approve_ext', label: '승인' }, { id: 'reject_ext', label: '거절' }],
  [{ id: 'reply', label: '답글', input: 'text' }, { id: 'ack', label: '확인' }],
  [{ id: 'ack', label: '확인' }, { id: 'today', label: '오늘 할 일에 넣기' }],
  [{ id: 'snooze', label: '10분 뒤 다시' }],
];
export const WN_CATEGORY_IDS = new Set(WN_SETS.map(wnCategory));
export const WN_ACTION_IDS = new Set(WN_SETS.flat().map((a) => a.id));
