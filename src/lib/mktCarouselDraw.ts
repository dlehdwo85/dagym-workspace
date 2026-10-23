import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * #499-5 카드뉴스 그리기(우리 서버, 외부 유료 생성 없음) — next/og(satori) + 동봉 글꼴(Noto Sans KR 굵게·보통) → PNG → JPEG(인스타 게시는 JPEG 만).
 * '디자이너 템플릿' 3종(서체·굵기·위치·여백 고정, 글만 바뀜 — 테크트리 L5 'HTML 을 그대로 찍은 티' 대응):
 *  box   = 사진 전체 + 아래 그늘 + 제목 밑 검정 20% 상자(대표 레퍼런스 EP.11)
 *  clean = 흰 바탕 + 브랜드 색 막대 + 위쪽 사진 틀
 *  bold  = 브랜드 색 바탕 + 큰 제목
 * 공통: 1080×1350(4:5), 가운데 로고(없으면 브랜드 이름)·오른쪽 위 쪽수, 제목 굵게 + 본문 보통(굵기 대비), 한국어 낱말 단위 줄바꿈(keep-all),
 * 마지막 장 = 검정 100% 바탕 CTA('댓글에 ○○'). 글꼴에 없는 글자(그림 문자 등)는 빼서 외부 글꼴을 내려받지 않게 함.
 */
export const W = 1080, H = 1350;
const PAD = 88;
export type SlideKind = 'cover' | 'body' | 'table' | 'cta';
export type Slide = { kind: SlideKind; title: string; body: string; rows: string[][]; imagePlan: string; imageId: string | null };
/** height: #516 자동 시안 스토리 = 1920(9:16, 위·아래 안전 영역) — 없으면 1350(4:5) */
export type DrawOpts = { template: 'box' | 'clean' | 'bold'; color: string | null; brand: string; keyword: string; logo: Buffer | null; font: Buffer | null; height?: number };

type El = { type: string; key: null; props: Record<string, unknown> };
const h = (style: Record<string, unknown>, children: unknown): El => ({ type: 'div', key: null, props: { style: { display: 'flex', ...style }, children } });
const img = (src: string, w: number, hh: number, style: Record<string, unknown>): El => ({ type: 'img', key: null, props: { src, width: w, height: hh, style: { width: w, height: hh, objectFit: 'cover', ...style } } });

let base: Promise<{ bold: Buffer; reg: Buffer; has: (cp: number) => boolean }> | null = null;
function fonts() {
  base ??= (async () => {
    const dir = join(process.cwd(), 'assets', 'fonts');
    const [bold, reg] = await Promise.all([readFile(join(dir, 'NotoSansKR-Bold.otf')), readFile(join(dir, 'NotoSansKR-Regular.otf'))]);
    const fk: any = (await import('@pdf-lib/fontkit')).default;
    const f = fk.create(reg);
    return { bold, reg, has: (cp: number) => f.hasGlyphForCodePoint(cp) };
  })().catch((e) => { base = null; throw e; });
  return base;
}
/** 글꼴에 있는 글자만(체크 표시는 ✓ 로) — 없는 글자가 있으면 next/og 가 외부 글꼴을 받으러 감 */
function clean(s: string, has: (cp: number) => boolean) {
  return [...String(s ?? '').replace(/[✔✅☑]/g, '✓')].filter((ch) => ch === '\n' || has(ch.codePointAt(0)!)).join('').replace(/[ \t]+\n/g, '\n').trim();
}
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
export const okColor = (c: string | null | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
const len = (s: string) => Math.max(0, ...s.split('\n').map((l) => [...l].length));
const titleSize = (t: string, cover: boolean) => { const n = len(t); return cover ? (n <= 10 ? 112 : n <= 16 ? 96 : n <= 24 ? 80 : 66) : (n <= 12 ? 84 : n <= 18 ? 72 : n <= 26 ? 62 : 54); };
const bodySize = (b: string) => { const n = [...b.replace(/\n/g, '')].length; return n <= 50 ? 46 : n <= 100 ? 40 : n <= 160 ? 35 : 31; };
const lines = (s: string, style: Record<string, unknown> = {}) => s.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => h(style, l));

/** 사진 자리: clean = 위쪽 둥근 틀, box·bold = 장 전체 */
const frameOf = (t: DrawOpts['template'], hh = H) => (t === 'clean' ? { x: PAD, y: hh > H ? 330 : 190, w: W - PAD * 2, h: hh > H ? 760 : 560, r: 28 } : { x: 0, y: 0, w: W, h: hh, r: 0 });
/** 스토리(9:16)는 위(진행 막대·프로필)·아래(메시지 칸)를 비워 둠 */
const safeOf = (hh: number) => (hh > H ? { top: 210, bottom: 420 } : { top: 52, bottom: 0 });
/** 사진 위 그늘(위 살짝·아래 진하게) — 글자가 사진 위에서도 읽히게 */
const shadeOf = (hh: number) => Buffer.from(`<svg width="${W}" height="${hh}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.28"/><stop offset="0.26" stop-color="#000" stop-opacity="0"/><stop offset="0.52" stop-color="#000" stop-opacity="0.12"/><stop offset="1" stop-color="#000" stop-opacity="0.74"/></linearGradient></defs><rect width="${W}" height="${hh}" fill="url(#g)"/></svg>`);
/** 사진·그늘은 satori 밖에서 sharp 로 깔고 그 위에 글자 층(투명 바탕)을 얹는다 — 큰 사진·그라데이션을 satori 안에서 그리면 장당 1~2초 더 걸림 */
async function photoLayer(buf: Buffer, f: ReturnType<typeof frameOf>) {
  const sharp = (await import('sharp')).default;
  const fit = sharp(buf).rotate().resize(f.w, f.h, { fit: 'cover' });
  if (!f.r) return fit.png().toBuffer();
  const mask = Buffer.from(`<svg width="${f.w}" height="${f.h}"><rect width="${f.w}" height="${f.h}" rx="${f.r}" ry="${f.r}"/></svg>`);
  return sharp(await fit.ensureAlpha().png().toBuffer()).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}
async function logoUri(buf: Buffer) {
  const sharp = (await import('sharp')).default;
  const out = await sharp(buf, { density: 300 }).resize(320, 64, { fit: 'inside', withoutEnlargement: false }).png().toBuffer();
  const m = await sharp(out).metadata();
  return { src: `data:image/png;base64,${out.toString('base64')}`, w: m.width ?? 64, h: m.height ?? 64 };
}

const bgOf = (s: Slide, o: DrawOpts) => (s.kind === 'cta' ? '#000000' : o.template === 'clean' ? '#FFFFFF' : o.template === 'bold' ? (okColor(o.color) ?? '#1E293B') : '#1F2937');
function tree(s: Slide, i: number, n: number, o: DrawOpts & { photo: boolean; logoEl: { src: string; w: number; h: number } | null; titleFamily: string }) {
  const brandColor = okColor(o.color);
  const cta = s.kind === 'cta';
  const T = o.template;
  const HH = o.height ?? H; const safe = safeOf(HH); const fr = frameOf(T, HH);
  const bg = bgOf(s, o);
  const onPhoto = o.photo && T !== 'clean'; // 사진 위 글자는 늘 흰색(아래 그늘)
  const dark = cta || T === 'box' || onPhoto || lum(bg) < 0.45;
  const fg = dark ? '#FFFFFF' : '#111827'; const sub = dark ? 'rgba(255,255,255,0.88)' : '#374151'; const line = dark ? 'rgba(255,255,255,0.35)' : '#D1D5DB';
  const accent = T === 'bold' ? fg : (brandColor ?? (dark ? '#FFFFFF' : '#111827'));
  const head = h({ position: 'absolute', top: safe.top, left: PAD, right: PAD, height: 72, justifyContent: 'space-between', alignItems: 'center', color: dark ? 'rgba(255,255,255,0.9)' : '#6B7280', fontSize: 28 }, [
    h({ width: 140 }, ''),
    o.logoEl ? img(o.logoEl.src, o.logoEl.w, o.logoEl.h, { objectFit: 'contain' }) : h({ fontWeight: 700, fontSize: 30, letterSpacing: 1 }, o.brand || ''),
    h({ width: 140, justifyContent: 'flex-end' }, n > 1 ? `${i + 1}/${n}` : '')]); // 한 장짜리(#516 자동 시안)는 쪽수 없음
  // bold + 사진: 제목 상자를 브랜드 색으로(밝은 색이면 글자는 검정)
  const brandBox = T === 'bold' && onPhoto && !!brandColor;
  const titleColor = brandBox ? (lum(brandColor!) < 0.45 ? '#FFFFFF' : '#111827') : fg;
  const title = (center = false) => h({ flexDirection: 'column', alignItems: center ? 'center' : 'flex-start', fontFamily: o.titleFamily, fontWeight: 700, fontSize: titleSize(s.title, s.kind === 'cover'), lineHeight: 1.24, letterSpacing: -1.5, color: titleColor, wordBreak: 'keep-all', textAlign: center ? 'center' : 'left' }, lines(s.title));
  const body = (center = false) => (s.body ? h({ flexDirection: 'column', alignItems: center ? 'center' : 'flex-start', marginTop: 30, fontWeight: 400, fontSize: cta ? 38 : bodySize(s.body), lineHeight: 1.55, color: sub, wordBreak: 'keep-all', textAlign: center ? 'center' : 'left' }, lines(s.body)) : null);
  const table = s.rows.length ? h({ flexDirection: 'column', marginTop: 36, borderTop: `3px solid ${fg}` }, s.rows.map((r, ri) => h({ borderBottom: `1px solid ${line}`, padding: s.rows.length > 5 ? '16px 0' : '22px 0', fontSize: s.rows.length > 5 ? 31 : 35, color: ri === 0 ? fg : sub, fontWeight: ri === 0 ? 700 : 400 },
    r.map((c, ci) => h({ flex: ci === 0 ? 1.15 : 1, paddingRight: 18, wordBreak: 'keep-all' }, c))))) : null;
  const kids: unknown[] = [];
  if (cta) {
    kids.push(head, h({ position: 'absolute', left: PAD, right: PAD, top: 0, bottom: 0, flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }, [title(true), body(true),
      o.keyword ? h({ marginTop: 64, padding: '18px 48px', borderRadius: 999, border: '3px solid #FFFFFF', color: '#FFFFFF', fontSize: 36, fontWeight: 700 }, `댓글에 '${o.keyword}'`) : null].filter(Boolean)));
  } else if (T === 'clean') {
    kids.push(head, h({ position: 'absolute', left: PAD, top: fr.y - 40, width: 72, height: 10, background: accent }, '')); // 사진(둥근 틀)은 sharp 로 아래에 깔림
    kids.push(h({ position: 'absolute', left: PAD, right: PAD, top: o.photo ? fr.y + fr.h + 60 : fr.y, bottom: 96 + safe.bottom, flexDirection: 'column', justifyContent: o.photo ? 'flex-start' : 'center' }, [title(), body(), table].filter(Boolean)));
  } else {
    kids.push(head);
    const box = T === 'box';
    const block = [h({ flexDirection: 'column', background: box ? 'rgba(0,0,0,0.2)' : brandBox ? brandColor! : 'transparent', padding: box || brandBox ? '34px 32px 38px' : '0 32px', borderRadius: 6 }, [title()]),
      s.body || table ? h({ flexDirection: 'column', padding: '0 32px' }, [body(), table].filter(Boolean)) : null].filter(Boolean);
    // 사진이 있으면 아래쪽 정렬(레퍼런스), 글만 있으면 가운데 + 색 막대
    kids.push(o.photo ? h({ position: 'absolute', left: PAD - 32, right: PAD - 32, bottom: (s.kind === 'cover' ? 140 : 104) + safe.bottom, flexDirection: 'column' }, block)
      : h({ position: 'absolute', left: PAD - 32, right: PAD - 32, top: 118 + safe.top, bottom: 96 + safe.bottom, flexDirection: 'column', justifyContent: 'center' }, [h({ marginLeft: 32, marginBottom: 28, width: 72, height: 10, background: accent }, ''), ...block]));
  }
  return h({ position: 'relative', width: W, height: HH, fontFamily: 'Noto Sans KR', overflow: 'hidden' }, kids); // 바탕은 투명 — 바탕색·사진은 drawSlide 가 깔아 줌
}

/** 한 장 → PNG. photo = 자료실 사진 원본(있으면), 표·CTA 장에는 사진을 쓰지 않음 */
export async function drawSlide(s: Slide, i: number, n: number, o: DrawOpts, photo: Buffer | null): Promise<Buffer> {
  const f = await fonts();
  const t: Slide = { ...s, title: clean(s.title, f.has), body: clean(s.body, f.has), rows: s.rows.map((r) => r.map((c) => clean(c, f.has))) };
  const HH = o.height ?? H;
  const frame = frameOf(o.template, HH);
  const under = photo && (s.kind === 'cover' || s.kind === 'body') ? await photoLayer(photo, frame).catch(() => null) : null;
  const logoEl = o.logo ? await logoUri(o.logo).catch(() => null) : null;
  const { ImageResponse } = await import('next/og');
  const fontList: any[] = [{ name: 'Noto Sans KR', data: f.bold, weight: 700, style: 'normal' }, { name: 'Noto Sans KR', data: f.reg, weight: 400, style: 'normal' }];
  const render = async (brandFont: boolean) => {
    const el = tree(t, i, n, { ...o, keyword: clean(o.keyword, f.has), brand: clean(o.brand, f.has), photo: !!under, logoEl, titleFamily: brandFont ? 'Brand' : 'Noto Sans KR' });
    const res = new ImageResponse(el as any, { width: W, height: HH, fonts: brandFont ? [{ name: 'Brand', data: o.font!, weight: 700, style: 'normal' }, ...fontList] : fontList });
    return Buffer.from(await res.arrayBuffer());
  };
  let layer: Buffer | null = null;
  if (o.font) { try { layer = await render(true); } catch { /* 브랜드 글꼴을 못 읽으면 기본 글꼴로 */ } }
  layer ??= await render(false);
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: W, height: HH, channels: 4, background: bgOf(s, o) } })
    .composite([...(under ? [{ input: under, left: frame.x, top: frame.y }, ...(frame.r ? [] : [{ input: shadeOf(HH), left: 0, top: 0 }])] : []), { input: layer, left: 0, top: 0 }]).png().toBuffer();
}
export async function toJpeg(png: Buffer) {
  const sharp = (await import('sharp')).default;
  return sharp(png).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
