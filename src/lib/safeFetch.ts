/**
 * #1181 상업화 마감 3번(설계 A — 회사가 넣은 주소를 서버가 받으러 감): 내부 주소로 가는 요청(SSRF)을 막는 받기.
 * - http·https 만, 포트는 기본(80·443)만
 * - 주소를 IP 로 바꿔 사설·내부·예약 주소(127/8 · 10/8 · 172.16/12 · 192.168/16 · 169.254/16(메타데이터) · 100.64/10 · 0/8 · ::1 · fc00::/7 · fe80::/10 …)면 막음
 * - 리다이렉트는 직접 따라가며(최대 3번) 단계마다 다시 검사 · 크기 상한(기본 1MB) · 시간 상한(기본 10초)
 * 남은 위험: 검사와 실제 연결 사이 DNS 가 바뀌는 경우(리바인딩) — 회사당 하루 요청 상한·결과는 글 목록만 저장으로 피해를 줄임.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { badRequest } from './errors';

const V4_BLOCK: [number[], number][] = [[[0, 0, 0, 0], 8], [[10, 0, 0, 0], 8], [[100, 64, 0, 0], 10], [[127, 0, 0, 0], 8], [[169, 254, 0, 0], 16], [[172, 16, 0, 0], 12], [[192, 0, 0, 0], 24], [[192, 168, 0, 0], 16], [[198, 18, 0, 0], 15], [[224, 0, 0, 0], 4], [[240, 0, 0, 0], 4]];
const v4num = (p: number[]) => ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
export function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = v4num(ip.split('.').map(Number));
    return V4_BLOCK.some(([base, bits]) => (n >>> (32 - bits)) === (v4num(base) >>> (32 - bits)));
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (mapped) return privateIp(mapped[1]);
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x);
  }
  return true; // IP 가 아니면 막음(검사 실수 방지)
}

/** 시험 서버: 가짜 원천(SALES_COLLECT_TEST_BASE)의 주소만 예외 — 운영에는 이 값이 없다 */
const testBase = () => process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, '') || null;

export async function assertPublicUrl(raw: string | URL): Promise<URL> {
  let u: URL; try { u = new URL(String(raw)); } catch { throw badRequest('주소가 올바르지 않습니다'); }
  if (!/^https?:$/.test(u.protocol)) throw badRequest('http 또는 https 주소만 등록할 수 있습니다');
  if (u.username || u.password) throw badRequest('아이디·비밀번호가 든 주소는 등록할 수 없습니다');
  const tb = testBase(); if (tb && u.toString().startsWith(`${tb}/`)) return u;
  if (u.port && !['80', '443'].includes(u.port)) throw badRequest('기본 포트(80·443) 주소만 등록할 수 있습니다');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || /\.(local|internal|localhost|lan|home|corp)$/.test(host)) throw badRequest('내부 주소는 등록할 수 없습니다');
  const ips = net.isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => { throw badRequest('주소를 찾을 수 없습니다'); })).map((a) => a.address);
  if (!ips.length || ips.some(privateIp)) throw badRequest('내부 주소는 등록할 수 없습니다');
  return u;
}

export type SafeResponse = { status: number; text: string; contentType: string; url: string };
export async function safeFetch(raw: string, opt: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; fetchImpl?: typeof fetch } = {}): Promise<SafeResponse> {
  const timeoutMs = opt.timeoutMs ?? 10_000, maxBytes = opt.maxBytes ?? 1_000_000, maxRedirects = opt.maxRedirects ?? 3; const f = opt.fetchImpl ?? fetch;
  let url = await assertPublicUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await f(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'WorkinBot/1.0 (+https://www.work-in.dev)', accept: 'text/html,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.5' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (hop >= maxRedirects) throw badRequest('주소가 너무 여러 번 다른 곳으로 넘어갑니다');
      url = await assertPublicUrl(new URL(res.headers.get('location')!, url)); continue;
    }
    const reader = res.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel().catch(() => {}); throw badRequest('페이지가 너무 큽니다(1MB 넘음)'); } chunks.push(value); }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return { status: res.status, text: buf.toString('utf8'), contentType: res.headers.get('content-type') ?? '', url: url.toString() };
  }
}

/** 사이트의 수집 금지(robots.txt) — User-agent: * 또는 WorkinBot 묶음의 Disallow 가 이 경로를 막으면 true. robots.txt 가 없거나 못 읽으면 허용 */
export async function robotsBlocked(raw: string, fetchImpl?: typeof fetch): Promise<boolean> {
  const u = new URL(raw);
  const r = await safeFetch(`${u.origin}/robots.txt`, { timeoutMs: 5000, maxBytes: 200_000, fetchImpl }).catch(() => null);
  if (!r || r.status >= 400) return false;
  let applies = false; let grouped = false; const dis: string[] = []; const allow: string[] = [];
  for (const line of r.text.split(/\r?\n/)) {
    const m = line.replace(/#.*/, '').trim().match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (grouped) { applies = false; grouped = false; } if (v === '*' || /workinbot/i.test(v)) applies = true; continue; }
    grouped = true;
    if (!applies) continue;
    if (k === 'disallow' && v) dis.push(v); if (k === 'allow' && v) allow.push(v);
  }
  const path = u.pathname + u.search;
  const hit = (xs: string[]) => xs.filter((p) => path.startsWith(p.replace(/\*.*$/, ''))).reduce((a, p) => Math.max(a, p.length), -1);
  return hit(dis) > hit(allow);
}
