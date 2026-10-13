'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public detail?: any) { super(message); }
}

const OUTBOX = 'wos_outbox_v1';
type Outboxed = { url: string; method: string; body: unknown; key: string; label: string; at: number };

function readOutbox(): Outboxed[] {
  try { return JSON.parse(localStorage.getItem(OUTBOX) ?? '[]'); } catch { return []; }
}
function writeOutbox(v: Outboxed[]) {
  try { localStorage.setItem(OUTBOX, JSON.stringify(v)); } catch {}
  window.dispatchEvent(new Event('wos-outbox'));
}

export function newKey() {
  return (crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
}

async function raw(url: string, method: string, body?: unknown, key?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const data = body !== undefined ? JSON.stringify(body) : undefined;
  // 쓰기 요청은 keepalive: 입력 직후 화면을 떠나거나 앱을 닫아도 자동 저장 요청이 끊기지 않게 (브라우저 한도 64KB 미만만)
  const keepalive = method !== 'GET' && (data?.length ?? 0) < 60000;
  const res = await fetch(url, { method, headers, body: data, credentials: 'same-origin', keepalive });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
    }
    throw new ApiError(res.status, j?.error?.code ?? 'error', j?.error?.message ?? (res.status >= 500 ? `서버가 잠시 응답하지 않습니다 (${res.status}). 잠시 후 다시 시도하세요.` : `요청을 처리하지 못했습니다 (${res.status})`), j?.error?.detail);
  }
  return j;
}

/**
 * API 호출. POST 는 Idempotency-Key 를 붙여 재시도해도 중복 생성되지 않는다.
 * queueOffline=true 이면 네트워크 끊김 시 기기에 보관했다가 재연결 시 같은 키로 다시 보낸다.
 */
export async function api<T = any>(url: string, opts: { method?: string; body?: unknown; queueOffline?: string } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const key = method === 'POST' ? newKey() : undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await raw(url, method, opts.body, key);
    } catch (e) {
      lastErr = e;
      // 서버가 응답한 오류는 재시도하지 않는다 (게이트웨이 오류만 재시도)
      if (e instanceof ApiError && !(e.status >= 502 && e.status <= 504)) throw e;
      if (typeof navigator !== 'undefined' && !navigator.onLine) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  if (opts.queueOffline && key && !(lastErr instanceof ApiError)) {
    writeOutbox([...readOutbox(), { url, method, body: opts.body, key, label: opts.queueOffline, at: Date.now() }]);
    throw new ApiError(0, 'queued', '오프라인 상태입니다. 연결되면 자동으로 전송합니다.');
  }
  if (lastErr instanceof ApiError) throw lastErr;
  throw new ApiError(0, 'network', '서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도하세요.');
}

export async function flushOutbox(): Promise<number> {
  const items = readOutbox();
  if (!items.length) return 0;
  let sent = 0;
  const remain: Outboxed[] = [];
  for (const it of items) {
    try {
      await raw(it.url, it.method, it.body, it.key);
      sent++;
    } catch (e) {
      // 서버가 거절한 요청(권한·검증 오류)은 버리고, 네트워크 오류만 다시 보관
      if (!(e instanceof ApiError) || e.status >= 500 || e.code === 'in_progress') remain.push(it);
    }
  }
  writeOutbox(remain);
  return sent;
}

export function useOutboxCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const upd = () => setN(readOutbox().length);
    upd();
    window.addEventListener('wos-outbox', upd);
    return () => window.removeEventListener('wos-outbox', upd);
  }, []);
  return n;
}

export function useApi<T = any>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);
  const hasData = useRef(false);
  const loadedUrl = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(url);
      if (my === seq.current) { setData(d); setError(null); hasData.current = true; loadedUrl.current = url; }
    } catch (e) {
      // 같은 화면을 다시 불러오다 실패(오프라인·일시 장애)하면 이미 보이는 내용과 입력 중인 내용을 지우지 않는다.
      // 권한이 사라진 경우(403/404)와 처음 불러오기 실패만 오류 화면으로 바꾼다.
      const err = e as ApiError;
      const keep = hasData.current && loadedUrl.current === url && !(err.status === 403 || err.status === 404);
      if (my === seq.current && !keep) setError(err);
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener('wos-refresh', h);
    return () => window.removeEventListener('wos-refresh', h);
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** 다른 화면(목록·보드·캘린더)에도 변경을 즉시 반영 */
export function broadcastRefresh() {
  window.dispatchEvent(new Event('wos-refresh'));
  try { new BroadcastChannel('wos').postMessage('refresh'); } catch {}
}
