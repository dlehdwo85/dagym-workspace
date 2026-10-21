/**
 * 대표 10/21 12:20 — 피드 일관성 신호. 브랜드별 최근 9장(인스타 3×3)의 게시 이미지 톤을 **숫자로만** 비교(AI 비용 0):
 * sharp(next 가 함께 설치)로 32×32 로 줄여 밝기·채도·색온도(R−B)·중앙/가장자리 밝기·대비를 재고, 파일마다 한 번만 계산해 library_files.image_stats 에 둔다.
 * 편차가 크거나 튀는 장이 있으면 운영 검토(opsReview)가 '운영 신호' 카드(승인 뒤 담당 업무)를 올리고, 운영실에는 3×3 미리보기 블록을 보여 준다.
 * sharp 를 못 불러오는 환경에서는 분석을 건너뛴다(신호 없음·화면 '분석 불가').
 */
import { db, type Sql } from './db';
import { getObject } from './storage';

export type ImageStats = { v: 1; r: number; g: number; b: number; brightness: number; saturation: number; warmth: number; center: number; contrast: number } | { v: 1; error: string };
export type FeedItem = { id: string; title: string; media: string; publishedAt: string | null; url: string | null; stats: ImageStats | null; dist: number | null; outlier: boolean };
export type FeedBrand = { brandId: string | null; name: string; color: string; n: number; score: number | null; mean: { brightness: number; saturation: number; warmth: number } | null; sd: { brightness: number; saturation: number; warmth: number } | null; items: FeedItem[]; note: string };

const N = 32; const r0 = (x: number) => Math.round(x); const r3 = (x: number) => Math.round(x * 1000) / 1000;
async function loadSharp(): Promise<any | null> { try { return (await import('sharp')).default; } catch { return null; } }

/** 한 장의 톤 통계 — 32×32 RGB 로 줄여 평균색·밝기·채도·색온도·중앙−가장자리 밝기·대비(밝기 표준편차) */
export async function imageStats(buf: Buffer): Promise<ImageStats | null> {
  const sharp = await loadSharp(); if (!sharp) return null;
  const { data, info } = await sharp(buf, { failOn: 'none', limitInputPixels: 80e6 }).rotate().resize(N, N, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const ch = Number(info.channels) || 3; const lum: number[] = [];
  let sr = 0, sg = 0, sb = 0, ss = 0, sc = 0, se = 0, nc = 0, ne = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * ch; const r = data[i], g = data[i + 1] ?? r, b = data[i + 2] ?? r;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const l = 0.299 * r + 0.587 * g + 0.114 * b;
    sr += r; sg += g; sb += b; ss += mx ? (mx - mn) / mx : 0; lum.push(l);
    if (x >= N / 4 && x < (N * 3) / 4 && y >= N / 4 && y < (N * 3) / 4) { sc += l; nc++; } else { se += l; ne++; }
  }
  const n = N * N; const mean = lum.reduce((a, b) => a + b, 0) / n; const sd = Math.sqrt(lum.reduce((a, l) => a + (l - mean) ** 2, 0) / n);
  return { v: 1, r: r0(sr / n), g: r0(sg / n), b: r0(sb / n), brightness: r0(mean), saturation: r3(ss / n), warmth: r0((sr - sb) / n), center: r0(sc / nc - se / ne), contrast: r0(sd) };
}

/** 파일별 통계(캐시) — 없는 것만 계산(한 번에 최대 maxCompute 장), 실패는 {error} 로 남겨 다시 시도하지 않음 */
async function statsFor(sql: Sql, ids: string[], maxCompute = 12): Promise<Map<string, ImageStats | null>> {
  const out = new Map<string, ImageStats | null>(); if (!ids.length) return out;
  const rows = await sql<{ id: string; storage_key: string | null; mime_type: string; image_stats: ImageStats | null; upload_status: string }[]>`select id, storage_key, mime_type, image_stats, upload_status from library_files where id = any(${ids}::uuid[]) and deleted_at is null`;
  let computed = 0;
  for (const f of rows) {
    if (f.image_stats) { out.set(f.id, f.image_stats); continue; }
    if (!f.storage_key || f.upload_status !== 'ready' || !f.mime_type.startsWith('image/') || computed >= maxCompute) { out.set(f.id, null); continue; }
    computed++;
    let st: ImageStats | null = null;
    try { st = await imageStats(await getObject(f.storage_key)); } catch (e: any) { st = { v: 1, error: String(e?.message ?? e).slice(0, 200) }; }
    if (st) await sql`update library_files set image_stats = ${sql.json(st as never)} where id = ${f.id}`.catch(() => {});
    out.set(f.id, st);
  }
  return out;
}

const ok = (s: ImageStats | null): s is Exclude<ImageStats, { error: string }> => !!s && !('error' in s);
const sdOf = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length); };
/** 편차 기준(한 단위 = 이 정도면 눈에 띈다): 밝기 40 · 채도 0.15 · 색온도 40 */
const UNIT = { brightness: 40, saturation: 0.15, warmth: 40 };

/** 브랜드별 최근 n장 게시 이미지 톤 비교 — 일관성 점수(100 = 고름)·튀는 장 */
export async function feedConsistency(tenant: string, limit = 9): Promise<{ analyzable: boolean; brands: FeedBrand[] }> {
  const sql = db();
  const analyzable = !!(await loadSharp());
  const rows = await sql<{ id: string; title: string; brand_id: string | null; brand: string; color: string; published_at: Date | null; published_url: string | null; media: string | null }[]>`
    select c.id, c.title, c.brand_id, coalesce(b.name, '브랜드 없음') as brand, coalesce(b.color, '#94A3B8') as color, c.published_at, c.published_url,
      (select f.id from mkt_versions v join library_files f on f.id = any(v.media_ids) where v.content_id = c.id and v.version = coalesce(c.approved_version, c.current_version) and f.mime_type like 'image/%' and f.deleted_at is null order by array_position(v.media_ids, f.id) limit 1) as media
    from mkt_contents c left join mkt_brands b on b.id = c.brand_id
    where c.tenant = ${tenant} and c.status = 'published' and not c.is_test and c.channel in ('instagram', 'facebook') and coalesce(c.kind, 'feed') in ('feed', 'photo', 'collage')
    order by c.published_at desc nulls last, c.created_at desc limit 300`;
  type Row = (typeof rows)[number];
  const byBrand = new Map<string, Row[]>();
  for (const r of rows) { if (!r.media) continue; const k = r.brand_id ?? ''; const arr = byBrand.get(k) ?? []; if (arr.length < limit) { arr.push(r); byBrand.set(k, arr); } }
  const stats = analyzable ? await statsFor(sql, [...byBrand.values()].flat().map((r) => r.media!)) : new Map<string, ImageStats | null>();
  const brands: FeedBrand[] = [];
  for (const [k, list] of byBrand) {
    const items: FeedItem[] = list.map((r) => ({ id: r.id, title: r.title, media: r.media!, publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null, url: r.published_url, stats: stats.get(r.media!) ?? null, dist: null, outlier: false }));
    const good = items.filter((it) => ok(it.stats)).map((it) => it.stats as Exclude<ImageStats, { error: string }>);
    let score: number | null = null, mean: FeedBrand['mean'] = null, sd: FeedBrand['sd'] = null, note = analyzable ? '' : '이미지 분석 모듈이 없어 비교하지 못했습니다';
    if (good.length >= 3) {
      const m = { brightness: good.reduce((a, s) => a + s.brightness, 0) / good.length, saturation: good.reduce((a, s) => a + s.saturation, 0) / good.length, warmth: good.reduce((a, s) => a + s.warmth, 0) / good.length };
      const d = { brightness: sdOf(good.map((s) => s.brightness)), saturation: sdOf(good.map((s) => s.saturation)), warmth: sdOf(good.map((s) => s.warmth)) };
      for (const it of items) {
        if (!ok(it.stats)) continue;
        it.dist = r3(Math.sqrt(((it.stats.brightness - m.brightness) / UNIT.brightness) ** 2 + ((it.stats.saturation - m.saturation) / UNIT.saturation) ** 2 + ((it.stats.warmth - m.warmth) / UNIT.warmth) ** 2));
        it.outlier = it.dist >= 1.6;
      }
      score = Math.max(0, 100 - Math.round((d.brightness / UNIT.brightness) * 35 + (d.saturation / UNIT.saturation) * 35 + (d.warmth / UNIT.warmth) * 30));
      mean = { brightness: r0(m.brightness), saturation: r3(m.saturation), warmth: r0(m.warmth) }; sd = { brightness: r0(d.brightness), saturation: r3(d.saturation), warmth: r0(d.warmth) };
      const outs = items.filter((it) => it.outlier);
      note = outs.length ? `튀는 장 ${outs.length}: ${outs.map((o) => o.title).join(', ').slice(0, 120)}` : score >= 70 ? '톤이 고릅니다' : '전체적으로 편차가 큽니다(밝기·채도·색온도)';
    } else if (analyzable) note = good.length ? `비교하려면 이미지 3장 이상 필요(지금 ${good.length}장)` : '분석할 이미지가 없습니다';
    brands.push({ brandId: k || null, name: list[0].brand, color: list[0].color, n: items.length, score, mean, sd, items, note });
  }
  brands.sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  return { analyzable, brands };
}

/** 운영 검토 신호: 튀는 장이 있거나 일관성 60점 미만(4장 이상) → 브랜드마다 한 신호 */
export async function feedSignals(tenant: string): Promise<{ key: string; level: 'warn'; title: string; detail: string; action: string; link: string }[]> {
  const { brands } = await feedConsistency(tenant);
  const out: { key: string; level: 'warn'; title: string; detail: string; action: string; link: string }[] = [];
  for (const b of brands) {
    if (b.score === null || !b.mean || !b.sd) continue;
    const outs = b.items.filter((it) => it.outlier);
    const bad = outs.length > 0 || (b.n >= 4 && b.score < 60);
    if (!bad) continue;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    out.push({ key: `feed_tone:${b.brandId ?? 'none'}`, level: 'warn', title: `피드 톤 불일치 — ${b.name} 최근 ${b.n}장 (일관성 ${b.score}점)`,
      detail: `밝기 ±${b.sd.brightness} · 채도 ±${pct(b.sd.saturation)} · 색온도 ±${b.sd.warmth}${outs.length ? ` · 튀는 장: ${outs.map((o) => o.title).join(', ').slice(0, 150)}` : ''}`,
      action: `${outs.length ? '튀는 시안을' : '최근 시안을'} 브랜드 톤(밝기 ${b.mean.brightness}·채도 ${pct(b.mean.saturation)})에 맞춰 다시 만들거나 색 보정한 뒤 재게시 검토 — 다음 제작 의뢰에 '톤 유지' 지시`, link: '/s/marketing/ops#feed' });
  }
  return out;
}
