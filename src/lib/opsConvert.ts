import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { forbidden } from './errors';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';

/**
 * 운영실 이관 원본(ops_import_items) → 워크인 마케팅 표(docs/research/OPS_DATA_MAPPING.md, 칸 구조는 로컬 10/19 전달).
 * - mkt:posts:v1(28) → 콘텐츠(채널·캡션·results 의 게시 주소·상태)
 * - mkt:daily:decisions:v1(42 항목 'dYYYYMMDD-{브랜드}-{종류}') + mkt:production:v1(history·decisions, itemId 로 묶음) → 콘텐츠 + 결정 기록
 * - mkt:requests:v1(43) → 운영실 요청 기록(mkt_ops_requests) — 승인 대기 화면 아래
 * - mkt:revisions:v1 은 원본 화면(운영실 기록)에서만 봄(전후 값 구조가 콘텐츠 버전과 1:1 이 아님)
 * [미리보기]는 쓰지 않고 건수·상태 매핑표만, [적용]은 같은 원본을 한 번만 만듦(src_key·src_ref 고유). 알림은 보내지 않음.
 */
type Raw = Record<string, any>;
const SRC_POSTS = 'mkt:posts:v1', SRC_DAILY = 'mkt:daily:decisions:v1';
// 로컬 10/19: 운영실 브랜드 표기(코드·영문 대문자) → 워크인 브랜드 이름. 그 밖의 값은 원문 그대로
const BRAND_CODE: Record<string, string> = { hl: '하이링크', hilink: '하이링크', dg: '다짐', dagym: '다짐', bl: '바디랩', bodylab: '바디랩' };
export const brandName = (raw: unknown) => { const v = String(raw ?? '').trim(); return v ? BRAND_CODE[v.toLowerCase().replace(/[\s_-]/g, '')] ?? v : null; };
const KIND_LABEL: Record<string, string> = { feed: '피드', blog: '블로그', reels: '릴스', shorts: '쇼츠', photo: '사진', collage: '콜라주' };

export function statusOf(raw: unknown): string {
  const s = String(raw ?? '').toLowerCase();
  if (/fail|error|실패/.test(s)) return 'draft'; // 로컬 10/19: 오래된 게시 실패 건을 승인함에 다시 올리지 않음(메모 '운영실 게시 실패')
  if (/publish|posted|live|done|complete|게시/.test(s)) return 'published';
  if (/cancel|delet|archiv|skip|drop|취소|삭제/.test(s)) return 'canceled';
  if (/hold|pause|보류/.test(s)) return 'hold';
  if (/change|revis|reject|수정|반려/.test(s)) return 'changes';
  if (/approv|confirm|\bok\b|schedul|ready|승인|확정|예약/.test(s)) return 'approved';
  if (/draft|초안/.test(s)) return 'draft';
  return 'pending';
}
const decisionOf = (st: string) => (st === 'approved' || st === 'published' ? 'approve' : st === 'changes' ? 'changes' : st === 'hold' ? 'hold' : null);
export function channelOf(raw: unknown): string {
  const s = String(raw ?? '').toLowerCase();
  if (/insta|^ig$|reels|feed|photo|collage/.test(s)) return 'instagram';
  if (/face|^fb$/.test(s)) return 'facebook';
  if (/thread/.test(s)) return 'threads';
  if (/youtube|shorts|^yt$/.test(s)) return 'youtube';
  if (/place|플레이스/.test(s)) return 'naver_place';
  if (/blog|블로그/.test(s)) return 'blog';
  return 'other';
}
function firstUrl(v: unknown, depth = 0): string | null {
  if (depth > 4 || v == null) return null;
  if (typeof v === 'string') return /^https?:\/\/\S+$/.test(v.trim()) ? v.trim().slice(0, 500) : null;
  if (Array.isArray(v)) { for (const x of v) { const u = firstUrl(x, depth + 1); if (u) return u; } return null; }
  if (typeof v === 'object') {
    for (const k of ['permalink', 'url', 'link', 'postUrl', 'publishedUrl']) { const u = firstUrl((v as Raw)[k], depth + 1); if (u) return u; }
    for (const x of Object.values(v)) { const u = firstUrl(x, depth + 1); if (u) return u; }
  }
  return null;
}
function timeOf(v: unknown): string | null {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const short = (v: unknown, n = 300) => { if (v == null) return null; const s = typeof v === 'string' ? v : JSON.stringify(v); return s.slice(0, n); };

type Dec = { decision: 'approve' | 'changes' | 'hold'; at: string | null; comment: string | null; version: number };
type Content = { srcKey: string; srcRef: string; title: string; brand: string | null; channel: string; kind: string | null; status: string; rawStatus: string; url: string | null; publishedAt: string | null; createdAt: string | null; body: string; note: string; decisions: Dec[] };

async function load(tenant: string) {
  const rows = await db()<{ key: string; idx: number; item: any }[]>`select key, idx, item from ops_import_items where tenant = ${tenant} and key = any(${['mkt:posts:v1', 'mkt:daily:decisions:v1', 'mkt:production:v1', 'mkt:requests:v1', 'mkt:revisions:v1']}) order by key, idx`;
  const list = (k: string) => rows.filter((r) => r.key === k).map((r) => r.item);
  const obj = (k: string) => { const r = rows.find((x) => x.key === k); return r && r.item && typeof r.item === 'object' && !Array.isArray(r.item) ? r.item : null; };
  return { posts: list('mkt:posts:v1'), daily: obj('mkt:daily:decisions:v1'), production: obj('mkt:production:v1'), requests: list('mkt:requests:v1'), revisions: list('mkt:revisions:v1') };
}

function build(d: Awaited<ReturnType<typeof load>>) {
  const contents: Content[] = [];
  const HOST: Record<string, RegExp> = { instagram: /instagram\.com|instagram/i, facebook: /facebook\.com|fb\.com|fb\.me|facebook/i, threads: /threads\.(net|com)|threads/i, youtube: /youtube\.com|youtu\.be|youtube/i, blog: /blog\.naver|blog/i, naver_place: /place|smartplace/i };
  for (const p of d.posts as Raw[]) {
    if (!p?.id) continue;
    const raw: string[] = (Array.isArray(p.channels) ? p.channels : [p.channels]).filter(Boolean).map(String);
    // 로컬 10/19: 채널마다 콘텐츠 1건(같은 원본 id + 채널로 중복 방지), 인스타그램을 맨 앞
    const chans = [...new Set((raw.length ? raw : [p.category]).map(channelOf))].sort((x, y) => (x === 'instagram' ? -1 : y === 'instagram' ? 1 : 0));
    const results: unknown[] = Array.isArray(p.results) ? p.results : p.results ? [p.results] : [];
    const st = statusOf(p.status);
    const tags = Array.isArray(p.hashtags) && p.hashtags.length ? `\n\n${p.hashtags.map((h: string) => (String(h).startsWith('#') ? h : `#${h}`)).join(' ')}` : '';
    for (const channel of chans) {
      // 그 채널 결과(채널 이름·주소 도메인이 맞는 것) → 게시 주소. 채널이 하나뿐이면 첫 주소
      const mine = results.find((r) => HOST[channel]?.test(JSON.stringify(r ?? '')));
      const url = firstUrl(mine) ?? (chans.length === 1 ? firstUrl(results) : null);
      const caption = String((channel === 'facebook' ? p.facebookText ?? p.instagramCaption : p.instagramCaption ?? p.facebookText) ?? '');
      contents.push({ srcKey: SRC_POSTS, srcRef: chans.length > 1 ? `${p.id}:${channel}` : String(p.id), title: String(p.title ?? p.id).slice(0, 200), brand: brandName(p.brand), channel, kind: null, status: st, rawStatus: String(p.status ?? ''),
        url, publishedAt: st === 'published' ? timeOf(p.updatedAt) : null, createdAt: timeOf(p.createdAt), body: caption + tags,
        note: [`운영실 게시물 ${p.id}`, /fail|error|실패/i.test(String(p.status ?? '')) ? '운영실 게시 실패' : null, chans.length > 1 ? `같은 게시물의 채널: ${chans.join(', ')}` : null, p.category ? `분류: ${p.category}` : null, p.assetHint ? `소재: ${short(p.assetHint, 120)}` : null,
          Array.isArray(p.assetIds) && p.assetIds.length ? `운영실 자산 ${p.assetIds.length}개(원본 화면)` : null].filter(Boolean).join(' · '), decisions: [] });
    }
  }
  const prodHist: Raw[] = Array.isArray(d.production?.history) ? d.production!.history : [];
  const prodDec: Raw = d.production?.decisions && typeof d.production.decisions === 'object' ? d.production.decisions : {};
  for (const [key, v] of Object.entries((d.daily ?? {}) as Raw)) {
    const m = /^d(\d{4})(\d{2})(\d{2})-([a-z]+)-([a-z]+)$/i.exec(key);
    const item = (v ?? {}) as Raw;
    const [y, mo, da, bc, kd] = m ? [m[1], m[2], m[3], m[4].toLowerCase(), m[5].toLowerCase()] : ['', '', '', '', ''];
    const brand = bc ? brandName(bc) : null;
    const st = statusOf(item.status);
    const ver = Number(item.version) || 1;
    const decs: Dec[] = [];
    const push = (h: Raw) => { const dd = decisionOf(statusOf(h?.status)); if (dd) decs.push({ decision: dd, at: timeOf(h?.at), comment: short(h?.note, 300), version: Number(h?.version) || ver }); };
    (Array.isArray(item.history) ? item.history : []).forEach(push);
    prodHist.filter((h) => String(h?.itemId) === key).forEach(push);
    if (prodDec[key]) push(prodDec[key]);
    contents.push({ srcKey: SRC_DAILY, srcRef: key, title: m ? `${Number(mo)}/${Number(da)} ${brand} ${KIND_LABEL[kd] ?? kd}` : key, brand, channel: channelOf(kd), kind: kd === 'blog' ? 'blog' : kd === 'reels' ? 'reels' : kd === 'shorts' ? 'video' : 'feed',
      status: st, rawStatus: String(item.status ?? ''), url: firstUrl(item.url) ?? null, publishedAt: st === 'published' ? timeOf(item.at) : null, createdAt: m ? `${y}-${mo}-${da}T01:00:00.000Z` : timeOf(item.at),
      body: '', note: [`운영실 일일 항목 ${key}`, item.note ? short(item.note, 200) : null, Array.isArray(item.evidence) && item.evidence.length ? `근거 ${item.evidence.length}건(원본 화면)` : null].filter(Boolean).join(' · '),
      decisions: decs.sort((a, b) => String(a.at).localeCompare(String(b.at))) });
  }
  const requests = (d.requests as Raw[]).filter((r) => r?.id).map((r) => ({ srcId: String(r.id), text: String(r.text ?? '').slice(0, 4000), route: r.route ? String(r.route).slice(0, 100) : null, status: String(r.status ?? ''),
    statusNote: short(r.statusNote, 1000), result: short(r.result?.summary ?? r.result?.message ?? r.result, 1000), createdAt: timeOf(r.createdAt), deliveredAt: timeOf(r.deliveredAt) }));
  return { contents, requests };
}

export const convertInput = z.object({ mode: z.enum(['preview', 'apply']) });
export async function convertOps(u: SessionUser, i: z.infer<typeof convertInput>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('운영실 기록 변환은 관리자가 합니다');
  const t = tenantOf(u); const sql = db();
  const d = await load(t);
  const { contents, requests } = build(d);
  const mapping: Record<string, number> = {};
  for (const c of contents) { const k = `${c.srcKey === SRC_POSTS ? '게시물' : '일일'} '${c.rawStatus}' → ${c.status}`; mapping[k] = (mapping[k] ?? 0) + 1; }
  const channels: Record<string, number> = {};
  for (const c of contents) channels[c.channel] = (channels[c.channel] ?? 0) + 1;
  const already = new Set((await sql<{ k: string }[]>`select src_key || '|' || src_ref as k from mkt_contents where tenant = ${t} and src_ref is not null`).map((r) => r.k));
  const fresh = contents.filter((c) => !already.has(`${c.srcKey}|${c.srcRef}`));
  const summary = { posts: d.posts.length, daily: Object.keys(d.daily ?? {}).length, requests: requests.length, revisions: d.revisions.length, newContents: fresh.length, existing: contents.length - fresh.length,
    decisions: fresh.reduce((n, c) => n + c.decisions.length, 0), withUrl: contents.filter((c) => c.url).length, mapping, channels,
    brands: Object.fromEntries([...new Set(contents.map((c) => c.brand ?? '(없음)'))].map((b) => [b, contents.filter((c) => (c.brand ?? '(없음)') === b).length])),
    unknownBrands: [...new Set(contents.map((c) => c.brand).filter((b) => b && !Object.values(BRAND_CODE).includes(b)))], sample: contents.slice(0, 8).map((c) => ({ title: c.title, brand: c.brand, channel: c.channel, status: c.status, url: !!c.url })) };
  if (i.mode === 'preview') return { mode: 'preview', ...summary };
  let made = 0, reqs = 0;
  await sql.begin(async (tx) => {
    const brandIds = new Map<string, string>();
    for (const b of [...new Set(fresh.map((c) => c.brand).filter(Boolean) as string[])]) {
      // 기존 브랜드(대소문자·공백 무시)에 붙이고, 없을 때만 새로 만듦
      const [ex] = await tx<{ id: string }[]>`select id from mkt_brands where tenant = ${t} and lower(replace(name, ' ', '')) = lower(replace(${b}, ' ', '')) limit 1`;
      const [r] = ex ? [ex] : await tx<{ id: string }[]>`insert into mkt_brands (tenant, name) values (${t}, ${b.slice(0, 60)}) on conflict (tenant, name) do update set name = excluded.name returning id`;
      brandIds.set(b, r.id);
    }
    for (const c of fresh) {
      const approvedV = c.status === 'approved' || c.status === 'published' ? 1 : null;
      const [row] = await tx<{ id: string }[]>`insert into mkt_contents (tenant, brand_id, title, channel, kind, status, current_version, approved_version, published_url, published_at, scheduled_at, created_at, updated_at, src_key, src_ref)
        values (${t}, ${c.brand ? brandIds.get(c.brand) ?? null : null}, ${c.title}, ${c.channel}, ${c.kind}, ${c.status}, 1, ${approvedV}, ${c.url}, ${c.publishedAt}, ${c.publishedAt ?? c.createdAt}, ${c.createdAt ?? new Date().toISOString()}, now(), ${c.srcKey}, ${c.srcRef})
        on conflict (tenant, src_key, src_ref) where src_ref is not null do nothing returning id`;
      if (!row) continue;
      made++;
      await tx`insert into mkt_versions (content_id, version, body, note, created_at) values (${row.id}, 1, ${c.body}, ${`[운영실 이관] ${c.note}`.slice(0, 1000)}, ${c.createdAt ?? new Date().toISOString()})`;
      for (const dd of c.decisions) await tx`insert into mkt_decisions (content_id, version, decision, comment, decided_at) values (${row.id}, 1, ${dd.decision}, ${`[운영실] ${dd.comment ?? ''}`.trim()}, ${dd.at ?? new Date().toISOString()})`;
    }
    for (const r of requests) {
      const x = await tx`insert into mkt_ops_requests (tenant, src_id, text, route, status, status_note, result_summary, created_at, delivered_at)
        values (${t}, ${r.srcId}, ${r.text}, ${r.route}, ${r.status}, ${r.statusNote}, ${r.result}, ${r.createdAt}, ${r.deliveredAt}) on conflict (tenant, src_id) do nothing returning id`;
      reqs += x.length;
    }
  });
  await audit(sql, u.id, 'ops_import.convert', 'tenant', null, { contents: made, requests: reqs }).catch(() => {});
  return { mode: 'apply', ...summary, made, requestsMade: reqs };
}

/** 승인 대기 화면 아래 '운영실 이전 요청 기록' */
export async function opsRequests(u: SessionUser) {
  await assertSpace(u, 'marketing');
  return { requests: await db()`select id, text, route, status, status_note, result_summary, created_at, delivered_at from mkt_ops_requests where tenant = ${tenantOf(u)} order by created_at desc nulls last limit 200` };
}
