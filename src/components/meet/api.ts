// 회의 화면 공용 호출 — 로그인 없는 손님도 쓰므로 앱의 api() (로그인 만료 처리 포함)를 쓰지 않는다
export async function call<T = any>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; keepalive?: boolean } = {}): Promise<T> {
  const r = await fetch(path, { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined, credentials: 'same-origin', keepalive: init.keepalive });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? '오류가 났습니다'), { status: r.status });
  return j as T;
}
