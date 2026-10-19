import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden } from './errors';
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
  const rows = await db()<{ key: string; idx: number; item: any }[]>`select key, idx, item from ops_import_items where tenant = ${tenant} and key = any(${['mkt:posts:v1', 'mkt:daily:decisions:v1', 'mkt:production:v1', 'mkt:requests:v1', 'mkt:revisions:v1', ...ASSET_KEYS]}) order by key, idx`;
  const list = (k: string) => rows.filter((r) => r.key === k).map((r) => r.item);
  const obj = (k: string) => { const r = rows.find((x) => x.key === k); return r && r.item && typeof r.item === 'object' && !Array.isArray(r.item) ? r.item : null; };
  return { posts: list('mkt:posts:v1'), daily: obj('mkt:daily:decisions:v1'), production: obj('mkt:production:v1'), requests: list('mkt:requests:v1'), revisions: list('mkt:revisions:v1'),
    assetRows: rows.filter((r) => r.key !== 'mkt:requests:v1' && r.key !== 'mkt:revisions:v1') };
}

// ---------------- 운영실 자산 → 워크인 저장소 → 콘텐츠 버전 media (로컬 10/19: 승인 대기 전부 '시안 없음') ----------------
const ASSET_MAP_KEY = 'mkt:asset-map:v1';
const ASSET_KEYS = ['mkt:library:v1', 'mkt:media:v1', 'mkt:media-outputs:v1', ASSET_MAP_KEY];
type Asset = { id: string | null; url: string; name: string | null; type: string | null; cover: boolean; owner: string | null; libRef: string | null };
const URL_KEYS = ['url', 'blobUrl', 'publicUrl', 'downloadUrl', 'fileUrl', 'src', 'href', 'path'];
const MEDIA_EXT = /\.(jpe?g|png|gif|webp|heic|avif|mp4|mov|m4v|webm)(\?|#|$)/i;
const DAILY_ID = /^d\d{8}-[a-z]+-[a-z]+$/i;
function opsOrigin() { try { return process.env.OPS_EXPORT_URL ? new URL(process.env.OPS_EXPORT_URL).origin : null; } catch { return null; } }
/** 받아도 되는 주소: Vercel Blob · 운영실 주소(OPS_EXPORT_URL) · OPS_ASSET_HOSTS. 운영실 상대 경로('/…')는 운영실 주소에 붙임 */
function safeUrl(raw: string): string | null {
  const origin = opsOrigin();
  let u: URL;
  try { u = raw.startsWith('/') && origin ? new URL(raw, origin) : new URL(raw); } catch { return null; }
  if (process.env.OPS_BLOB_TEST === '1') return /^https?:$/.test(u.protocol) ? u.href : null;
  if (u.protocol !== 'https:') return null;
  const hosts = [origin ? new URL(origin).hostname : '', ...String(process.env.OPS_ASSET_HOSTS ?? '').split(',').map((x) => x.trim())].filter(Boolean);
  return u.hostname.endsWith('.blob.vercel-storage.com') || hosts.includes(u.hostname) ? u.href : null;
}
/** 원본 JSON 을 훑어 id·주소가 있는 미디어를 모음(칸 이름이 조금 달라도) — 일일 항목 id(dYYYYMMDD-…) 아래에 있으면 그 항목 것 */
function scanAssets(v: unknown, out: Asset[], owner: string | null, libKey: boolean, depth = 0) {
  if (depth > 8 || v == null) return;
  if (Array.isArray(v)) { for (const x of v) scanAssets(x, out, owner, libKey, depth + 1); return; }
  if (typeof v !== 'object') return;
  const o = v as Raw;
  const own = String(o.itemId ?? o.dailyItemId ?? o.contentItemId ?? o.dailyId ?? '') || owner;
  const rawUrl = URL_KEYS.map((k) => o[k]).find((x) => typeof x === 'string' && (/^https?:\/\//.test(x) || x.startsWith('/')));
  const type = String(o.type ?? o.mimeType ?? o.mime ?? o.contentType ?? '') || null;
  if (rawUrl && (MEDIA_EXT.test(rawUrl) || /^(image|video)\//.test(type ?? '') || /\.blob\.vercel-storage\.com/.test(rawUrl))) {
    const url = safeUrl(rawUrl);
    if (url) out.push({ id: o.id != null ? String(o.id) : o.assetId != null ? String(o.assetId) : null, url, name: String(o.name ?? o.fileName ?? o.filename ?? o.title ?? '') || null, type,
      cover: !!(o.cover || o.isCover || o.role === 'cover' || o.kind === 'cover' || o.slot === 'cover'), owner: own, libRef: libKey && o.id != null ? `ops-library:${o.id}` : null });
  }
  for (const [k, x] of Object.entries(o)) if (x && typeof x === 'object') scanAssets(x, out, DAILY_ID.test(k) ? k : own, libKey, depth + 1);
}
function assetPlan(d: Awaited<ReturnType<typeof load>>, contents: Content[]) {
  const all: Asset[] = [];
  const byId = new Map<string, Asset>();
  // 운영실 마케팅 세션이 준 'id → 주소' 목록(관리자가 올림)이 먼저 — 확장자·형식 검사 없이 주소만 허용 도메인 확인
  for (const r of d.assetRows) if (r.key === ASSET_MAP_KEY) for (const m of normMap(r.item)) {
    const url = safeUrl(m.url); if (url && !byId.has(m.id)) byId.set(m.id, { id: m.id, url, name: m.name, type: m.type, cover: m.cover, owner: null, libRef: null });
  }
  for (const r of d.assetRows) if (r.key !== 'mkt:posts:v1' && r.key !== ASSET_MAP_KEY) scanAssets(r.item, all, null, r.key === 'mkt:library:v1');
  for (const a of all) if (a.id && !byId.has(a.id)) byId.set(a.id, a);
  const postsById = new Map((d.posts as Raw[]).filter((p) => p?.id).map((p) => [String(p.id), p]));
  const plan = new Map<string, Asset[]>(); const missing = new Set<string>();
  for (const c of contents) {
    let list: Asset[] = [];
    if (c.srcKey === SRC_POSTS) {
      const p = postsById.get(c.srcRef.split(':')[0]);
      const inline: Asset[] = []; if (p) scanAssets({ ...p, results: undefined }, inline, null, false);
      const ids: string[] = Array.isArray(p?.assetIds) ? p!.assetIds.map(String) : [];
      const cover = p?.coverAssetId != null ? String(p.coverAssetId) : null;
      for (const id of cover ? [cover, ...ids.filter((x) => x !== cover)] : ids) { const a = byId.get(id) ?? inline.find((x) => x.id === id); if (a) list.push(a); else missing.add(id); }
      for (const a of inline) if (!list.some((x) => x.url === a.url)) list.push(a);
    } else {
      list = all.filter((a) => a.owner === c.srcRef);
      for (const id of (Array.isArray(((d.daily ?? {}) as Raw)[c.srcRef]?.assetIds) ? ((d.daily as Raw)[c.srcRef].assetIds as unknown[]).map(String) : [])) { const a = byId.get(id); if (a) list.push(a); else missing.add(id); }
    }
    const seen = new Set<string>(); list = list.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
    list.sort((a, b) => Number(b.cover) - Number(a.cover)); // 표지 먼저(나머지는 원본 순서)
    if (list.length) plan.set(`${c.srcKey}|${c.srcRef}`, list.slice(0, 20));
  }
  return { plan, missing: [...missing], found: all.length };
}
/** 'id → 주소' 목록 형식: { id: "주소" } · { id: { url, name, type } } · [{ id, url, name?, type? }] · { assets: [...] } */
function normMap(v: unknown): { id: string; url: string; name: string | null; type: string | null; cover: boolean }[] {
  const out: { id: string; url: string; name: string | null; type: string | null; cover: boolean }[] = [];
  const one = (id: unknown, x: any) => {
    const url = typeof x === 'string' ? x : URL_KEYS.map((k) => x?.[k]).find((y) => typeof y === 'string');
    if (id != null && String(id).trim() && typeof url === 'string') out.push({ id: String(id).trim().slice(0, 200), url: url.trim(), name: typeof x === 'object' && x ? String(x.name ?? x.fileName ?? '') || null : null, type: typeof x === 'object' && x ? String(x.type ?? x.mimeType ?? '') || null : null, cover: !!(x && typeof x === 'object' && (x.cover || x.role === 'cover')) });
  };
  const arr = Array.isArray(v) ? v : Array.isArray((v as Raw)?.assets) ? (v as Raw).assets : null;
  if (arr) for (const x of arr) one(x?.id ?? x?.assetId, x);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Raw)) one(k, x);
  return out;
}
export const assetMapInput = z.object({ map: z.unknown() });
/** 운영실 자산 'id → 주소' 목록 올리기(관리자, 바꾸면 통째로 교체) — 다음 [미리보기]·[옮기기]가 이 목록으로 자산을 찾음 */
export async function saveAssetMap(u: SessionUser, i: z.infer<typeof assetMapInput>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('운영실 기록 변환은 관리자가 합니다');
  const list = normMap(i.map);
  if (!list.length) throw badRequest('id → 주소 목록을 찾지 못했습니다. { "자산id": "https://…" } 또는 [{ "id": "…", "url": "…" }] 형식으로 올려 주세요');
  if (list.length > 5000) throw badRequest('한 번에 5,000개까지 올릴 수 있습니다');
  const t = tenantOf(u); const sql = db();
  await sql.begin(async (tx) => {
    await tx`delete from ops_import_items where tenant = ${t} and key = ${ASSET_MAP_KEY}`;
    await tx`insert into ops_import_items (tenant, key, idx, item) values (${t}, ${ASSET_MAP_KEY}, 0, ${tx.json(list as never)})`;
  });
  const bad = list.filter((m) => !safeUrl(m.url));
  const hosts = [...new Set(bad.map((m) => { try { return new URL(m.url).hostname; } catch { return '(주소 형식 아님)'; } }))].slice(0, 5);
  await audit(sql, u.id, 'ops_import.asset_map', 'tenant', null, { count: list.length, rejected: bad.length }).catch(() => {});
  return { count: list.length, usable: list.length - bad.length, rejected: bad.length, rejectedHosts: hosts };
}
const FILE_EACH = 100 * 1024 * 1024;
async function copyAssets(u: SessionUser, t: string, d: Awaited<ReturnType<typeof load>>, contents: Content[]) {
  const sql = db();
  const { plan, missing } = assetPlan(d, contents);
  const { putObject } = await import('./storage');
  const started = Date.now();
  const out = { contents: plan.size, linked: 0, copied: 0, reused: 0, failed: 0, left: 0, missing: missing.slice(0, 30), missingCount: missing.length, errors: [] as string[] };
  const fileOf = new Map<string, string>();
  const rows = plan.size ? await sql<{ id: string; k: string; brand: string | null; version: number; media_ids: string[] }[]>`
    select c.id, c.src_key || '|' || c.src_ref as k, b.name as brand, v.version, v.media_ids from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    left join mkt_brands b on b.id = c.brand_id where c.tenant = ${t} and c.src_ref is not null` : [];
  for (const r of rows) {
    const list = plan.get(r.k); if (!list) continue;
    const ids: string[] = [];
    for (const a of list) {
      const ref = a.libRef ?? `ops-asset:${a.id ?? createHash('sha1').update(a.url).digest('hex').slice(0, 20)}`;
      let fid = fileOf.get(ref);
      if (!fid) {
        const [have] = await sql<{ id: string }[]>`select id from library_files where tenant = ${t} and (ext_ref = ${ref} or ext_ref = ${a.id ? `ops-library:${a.id}` : ref}) and upload_status = 'ready' limit 1`;
        if (have) { fid = have.id; out.reused++; }
        else if (Date.now() - started > 240_000) { out.left++; continue; }
        else {
          try {
            const res = await fetch(a.url, { signal: AbortSignal.timeout(60_000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = Buffer.from(await res.arrayBuffer());
            if (data.length > FILE_EACH) throw new Error('100MB 초과');
            const name = (a.name || decodeURIComponent(new URL(a.url).pathname.split('/').pop() || 'asset')).slice(0, 200);
            const mime = (a.type && /\//.test(a.type) ? a.type : res.headers.get('content-type') ?? 'application/octet-stream').slice(0, 100);
            const folder = r.brand ? `운영실 자료/${r.brand}` : '운영실 자료';
            const [f] = await sql<{ id: string }[]>`insert into library_files (tenant, space, ext_ref, meta, folder, title, file_name, mime_type, size_bytes, tags, source, created_by, upload_status, security, content_hash)
              values (${t}, 'marketing', ${ref}, ${sql.json({ opsId: a.id, opsUrl: a.url, cover: a.cover } as never)}, ${folder}, ${name.replace(/\.[^.]+$/, '')}, ${name}, ${mime}, ${data.length}, ${r.brand ? [r.brand] : []},
                'ops_import', ${u.id}, 'pending', 'internal', ${createHash('sha256').update(data).digest('hex')}) returning id`;
            const key = `lib/${t}/${f.id}/${name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120)}`;
            await putObject(key, data, mime);
            await sql`update library_files set storage_key = ${key}, upload_status = 'ready' where id = ${f.id}`;
            fid = f.id; out.copied++;
          } catch (e: any) { out.failed++; if (out.errors.length < 20) out.errors.push(`${a.id ?? a.url.slice(-40)}: ${String(e?.message ?? e).slice(0, 80)}`); continue; }
        }
        fileOf.set(ref, fid);
      }
      ids.push(fid);
    }
    // 멱등: 이미 붙은 것은 그대로, 빠진 것만 더함(사람이 바꾼 media 는 건드리지 않음 — 기존 것이 모두 운영실 자산일 때만)
    const cur = r.media_ids ?? [];
    if (ids.length && cur.every((x) => ids.includes(x)) && ids.some((x) => !cur.includes(x))) {
      await sql`update mkt_versions set media_ids = ${ids} where content_id = ${r.id} and version = ${r.version}`;
      out.linked++;
    }
  }
  return out;
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
  if (i.mode === 'preview') { const ap = assetPlan(d, contents); return { mode: 'preview', ...summary, assets: { contents: ap.plan.size, files: [...ap.plan.values()].reduce((n, l) => n + l.length, 0), missingCount: ap.missing.length, missing: ap.missing.slice(0, 30) } }; }
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
  const assets = await copyAssets(u, t, d, contents);
  await audit(sql, u.id, 'ops_import.convert', 'tenant', null, { contents: made, requests: reqs, assets: { copied: assets.copied, linked: assets.linked, failed: assets.failed } }).catch(() => {});
  return { mode: 'apply', ...summary, made, requestsMade: reqs, assets };
}

/** 승인 대기 화면 아래 '운영실 이전 요청 기록' */
export async function opsRequests(u: SessionUser) {
  await assertSpace(u, 'marketing');
  return { requests: await db()`select id, text, route, status, status_note, result_summary, created_at, delivered_at from mkt_ops_requests where tenant = ${tenantOf(u)} order by created_at desc nulls last limit 200` };
}
