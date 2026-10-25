// 웹 푸시 수신 + 알림 클릭 시 해당 업무로 이동
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: '알림', body: event.data && event.data.text() }; }
  // 로컬 10/20 알림에서 바로 처리: 서버가 준 버튼(최대 2개). 글 입력이 필요한 버튼은 지원하는 브라우저에서 바로 입력(type: text), 아니면 앱을 연다
  const actions = (Array.isArray(d.actions) ? d.actions : []).slice(0, 2).map((a) => (a.input === 'text' ? { action: a.id, title: a.label, type: 'text', placeholder: a.label } : { action: a.id, title: a.label, ...(a.open ? { open: true } : {}) }));
  // 메신저 3차 C12: 서버가 준 앱 아이콘 배지 숫자(안 읽은 알림 + 안 읽은 메시지) — 설치한 웹 앱 아이콘에(지원하는 브라우저만)
  if (typeof d.badge === 'number' && self.navigator && self.navigator.setAppBadge) (d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {});
  // 로컬 10/20(대표): 알람처럼 울리는 알림은 닫을 때까지 남고 진동 — [해제][10분 뒤] 버튼. 소리·띠는 열린 창(AlarmBar)이 맡는다
  event.waitUntil(self.registration.showNotification(d.title || '업무 알림', {
    body: d.body || '', tag: d.tag || d.notificationId, renotify: true, data: { link: d.link || '/', notificationId: d.notificationId, actions, alarm: !!d.alarm }, icon: '/icon-192.png', badge: '/badge-96.png', actions,
    ...(d.alarm ? { requireInteraction: true, vibrate: [300, 150, 300, 150, 600] } : {}),
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = new URL(data.link || '/', self.location.origin).href;
  // 버튼을 눌렀으면 서버에서 바로 처리(로그인 쿠키 사용). 글이 필요한데 입력이 없으면 앱을 연다. 처리되면 "승인함 ✓" 알림으로 바꾼다
  // #618(대표 10/25): [확인] = 읽음 + 지움(처리 알림을 다시 띄우지 않음) · [승인함 열기]/[열기](open) = 서버 호출 없이 읽음 표시만 하고 그 화면을 연다
  if (event.action && data.notificationId) {
    const def = (data.actions || []).find((a) => a.action === event.action);
    const text = event.reply || '';
    if (def && def.type === 'text' && !text) { /* 입력 없음 → 앱 열기 */ } else if (def && def.open) {
      event.waitUntil(fetch('/api/notifications/read', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [data.notificationId] }) }).catch(() => {}));
    } else {
      event.waitUntil((async () => {
        try {
          const r = await fetch(`/api/notifications/${data.notificationId}/action`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: event.action, text: text || undefined }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || event.action !== 'ack') await self.registration.showNotification(r.ok ? `${j.label || '처리함'} ✓` : '처리하지 못했습니다', { body: r.ok ? event.notification.title : ((j.error && j.error.message) || '앱에서 확인해 주세요'), tag: event.notification.tag, data: { link: data.link || '/' }, icon: '/icon-192.png' });
          const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          for (const c of all) c.postMessage({ type: 'wos-refresh' });
        } catch {
          await self.registration.showNotification('처리하지 못했습니다', { body: '연결을 확인하고 앱에서 처리해 주세요', tag: event.notification.tag, data: { link: data.link || '/' }, icon: '/icon-192.png' });
        }
      })());
      return;
    }
  }
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin)) { await c.focus(); return c.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
