/**
 * #194 앱 딥링크 → 앱 안 주소(native.ts appUrlOpen). 세 가지 모양을 모두 받는다:
 * - workos://tasks/{id} · workos://tasks?new=1 · workos://calendar?view=timeGridDay · workos://assistant — 서버 위젯 links(src/lib/widget.ts), 첫 칸이 주소 첫 마디
 * - workos://app/tasks/{id} — 앱 위젯 줄·[+]·전체화면 알람 [열기] · workos://open/auth/app?… — 앱 소셜 로그인 돌아오기
 * - https://www.work-in.dev/tasks/{id} — 앱 링크(인증된 주소만 앱으로 옴, 호스트는 버리고 경로만 씀)
 * 전에는 앞의 'workos://tasks' 까지 지워 workos://tasks/{id} 가 '/{id}' 로 열렸다. 다른 앱이 보낸 링크로 /api 를 부르지 않게 화면 주소만 연다.
 */
export function deepPath(raw: string): string {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i.exec(String(raw ?? '').trim());
  if (!m) return '/';
  const [, scheme, host, rest] = m;
  const p = /^https?$/i.test(scheme) || !host || host === 'app' || host === 'open' ? rest : `/${host}${rest}`;
  const path = `/${p.replace(/^\/+/, '')}`;
  return /^\/api(\/|$|\?|#)/i.test(path) ? '/' : path;
}
