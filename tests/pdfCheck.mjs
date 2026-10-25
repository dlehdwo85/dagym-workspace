// 147차(로컬 10/25 14:40 긴급): PDF 에 찍힌 글자를 다시 읽어 확인한다.
// ① 글자: pdf.js getTextContent 로 다시 읽은 글이 원문과 같은지(시험 쪽에서 비교)
// ② 모양: pdf.js 로 쪽을 실제로 그린 그림에서 한글이 든 줄마다 잉크 양을 재고, 같은 글을 원본 글꼴(NotoSansKR .otf)로 그린 양과 견준다.
//    글자 추출은 PDF 안 글꼴 모양이 깨져도(크롬에서 한글이 안 보이고 pdf.js 가 자모만 그려도) 통과하므로, 이번 같은 깨짐은 ②로만 잡힌다.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const HANGUL = /[가-힣]/;
let refs = null;
async function refFonts() {
  if (!refs) {
    const m = await import('@pdf-lib/fontkit'); const fk = m.default ?? m;
    refs = await Promise.all(['Regular', 'Bold'].map(async (w) => fk.create(await readFile(new URL(`../assets/fonts/NotoSansKR-${w}.otf`, import.meta.url)))));
  }
  return refs;
}

/**
 * 칸 안 잉크 양: 바탕 = 칸 픽셀 밝기의 가운데값, 글자색 = 바탕에서 가장 먼 밝기 → 픽셀마다 (바탕과의 차이 ÷ 글자색과 바탕 차이)를 더함.
 * 회색 글자·색 바탕 위 흰 글자(견적서 표 머리)도 검은 글자와 같은 값이 된다.
 */
function ink(ctx, x0, y0, x1, y1) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const l = Math.max(0, Math.floor(Math.min(x0, x1))), t = Math.max(0, Math.floor(Math.min(y0, y1)));
  const r = Math.min(W, Math.ceil(Math.max(x0, x1))), b = Math.min(H, Math.ceil(Math.max(y0, y1)));
  if (r <= l || b <= t) return 0;
  const d = ctx.getImageData(l, t, r - l, b - t).data, n = d.length / 4, lum = new Float32Array(n), hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) { lum[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000; hist[Math.round(lum[i])]++; }
  let bg = 0; for (let c = 0, k = 0; k < 256; k++) { c += hist[k]; if (c >= n / 2) { bg = k; break; } }
  let fg = bg; for (const v of lum) if (Math.abs(v - bg) > Math.abs(fg - bg)) fg = v;
  const span = fg - bg; if (Math.abs(span) < 25) return 0;
  let sum = 0; for (const v of lum) sum += Math.min(1, Math.max(0, (v - bg) / span));
  return sum;
}

/** 같은 글을 원본 글꼴 윤곽으로 따로 그린 잉크 양(px = 글자 크기 픽셀) */
function refInk(factory, font, str, px) {
  const run = font.layout(str), k = px / font.unitsPerEm;
  const adv = run.positions.reduce((n, p) => n + p.xAdvance, 0);
  const W = Math.ceil(adv * k + px), H = Math.ceil(px * 1.8);
  const { context: ctx } = factory.create(W, H);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#000';
  let pen = 0;
  run.glyphs.forEach((g, i) => {
    const d = g.path.toSVG();
    if (d) { ctx.save(); ctx.translate(px * 0.5 + (pen + run.positions[i].xOffset) * k, px * 1.3); ctx.scale(k, -k); ctx.fill(new Path2D(d)); ctx.restore(); }
    pen += run.positions[i].xAdvance;
  });
  return ink(ctx, 0, 0, W, H);
}

/**
 * 쪽마다 { text: 다시 읽은 글 줄들, ink: 한글 줄마다 { str, ratio } } — ratio = pdf.js 로 그린 잉크 ÷ 원본 글꼴로 그린 잉크(보통·굵게 중 가까운 쪽).
 * 정상 글꼴은 0.98~1.01, 깨진 글꼴(146차까지의 .otf 부분 글꼴)은 0~0.9·1.15 처럼 벗어난다. 시험은 assertPdfGlyphs 로.
 */
export async function pdfCheck(bytes, { scale = 2 } = {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const [reg, bold] = await refFonts();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n), vp = page.getViewport({ scale });
      const { context: ctx } = doc.canvasFactory.create(Math.ceil(vp.width), Math.ceil(vp.height));
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      await page.render({ canvasContext: ctx, canvas: ctx.canvas, viewport: vp }).promise;
      const items = (await page.getTextContent()).items.filter((i) => i.str?.trim());
      const res = [];
      for (const it of items.filter((i) => HANGUL.test(i.str))) {
        const size = Math.hypot(it.transform[0], it.transform[1]), [x, y] = [it.transform[4], it.transform[5]];
        // 글자 줄 칸: 글자 크기 기준 위 0.95·아래 0.25(줄 간격 1.25 보다 좁게 — 옆 줄을 세지 않게)
        const [x0, y0] = vp.convertToViewportPoint(x - size * 0.1, y + size * 0.95);
        const [x1, y1] = vp.convertToViewportPoint(x + it.width + size * 0.1, y - size * 0.25);
        const got = ink(ctx, x0, y0, x1, y1);
        const rs = [reg, bold].map((f) => { const w = refInk(doc.canvasFactory, f, it.str, size * scale); return w ? got / w : 0; });
        const ratio = rs.reduce((a, r) => (Math.abs(Math.log(r || 1e-9)) < Math.abs(Math.log(a || 1e-9)) ? r : a));
        res.push({ str: it.str, size: Math.round(size * 10) / 10, ratio: Math.round(ratio * 1000) / 1000 });
      }
      pages.push({ text: items.map((i) => i.str), ink: res });
      page.cleanup();
    }
  } finally { await task.destroy(); }
  return pages;
}

/**
 * 한글 줄이 하나 이상 있고, 모두 원본 글꼴로 그린 것과 잉크 양이 비슷한지(0.9~1.25, 정상은 0.98~1.01). 실패 메시지에 줄·비율.
 * 위쪽을 넉넉히 둔 건 글자를 지나가는 선(견적서 '공급자' 이름표가 상자 테두리 위에 놓임)이 잉크를 보태기 때문 — 글꼴 깨짐은 주로 아래로 떨어진다.
 */
export async function assertPdfGlyphs(assert, bytes, label = 'PDF') {
  if (process.env.PDF_CHECK_DUMP) { await mkdir(process.env.PDF_CHECK_DUMP, { recursive: true }); await writeFile(`${process.env.PDF_CHECK_DUMP}/${label.replace(/[^\p{L}\p{N}]+/gu, '_')}.pdf`, bytes); } // 눈으로 볼 때(크롬 등)
  const pages = await pdfCheck(bytes);
  const all = pages.flatMap((p, i) => p.ink.map((x) => ({ ...x, page: i + 1 })));
  assert.ok(all.length > 0, `${label}: 한글 줄이 없음`);
  if (process.env.PDF_CHECK_LOG) console.log(label, all.map((x) => `${x.ratio} ${x.str.slice(0, 20)}`).join(' | '));
  const bad = all.filter((x) => !(x.ratio >= 0.9 && x.ratio <= 1.25));
  assert.deepEqual(bad, [], `${label}: 한글이 제대로 그려지지 않은 줄(ratio = 그려진 잉크 ÷ 원본 글꼴 잉크)`);
  return pages;
}
