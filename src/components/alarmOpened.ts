// 378차(대표 11/06 "알람 울릴 때 열기 눌렀으면 알람 사라져야 하지 않는가"): 앱 밖(휴대폰 전체 화면 알람 [워크인에서 열기]·알림창 [열기]·딥링크)에서
// 어떤 화면을 열고 들어왔는지 잠깐(2분) 기억 — 앱 안 알람 띠(AlarmBar)가 같은 업무·일정의 알람을 해제한다.
// 안드로이드 전체 화면 알람은 [열기]를 서버에 알리지 않으므로(네이티브 WorkinAlarms.act 'open') 여기서 맞춘다.
const KEEP_MS = 120_000;
type Opened = { path: string; at: number };
let last: Opened | null = null;

export function markOpenedFromOutside(path: string | null | undefined) {
  if (!path) return;
  last = { path, at: Date.now() };
  try { window.dispatchEvent(new Event('wos-opened')); } catch { /* 창 없음 */ }
}
export function openedFromOutside(): Opened | null {
  return last && Date.now() - last.at < KEEP_MS ? last : null;
}
/** 열고 들어온 화면이 그 알람의 화면인가 — 주소가 같거나, 주소에 그 업무·일정 id 가 들어 있으면 */
export function opensAlarm(path: string, a: { link: string; entityId?: string | null }) {
  const p = path.split('#')[0];
  return p === a.link.split('#')[0] || (!!a.entityId && p.includes(a.entityId));
}
