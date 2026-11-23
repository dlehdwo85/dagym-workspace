'use client';
/**
 * #1125 2단계(대표 위임 11/23 — ② 브라우저 안 변환, 무료·원본 파일이 PC 밖으로 안 나감): 워드(.docx)·엑셀(.xlsx) → PDF.
 * 워드 = docx-preview 로 쪽을 그림(워드가 저장해 둔 쪽 나눔 표시를 따르고, 그래도 긴 쪽은 글줄 사이에서 자름 · 머리글·바닥글은 쪽마다),
 * 엑셀 = xlsxSheet 로 표를 그림(쪽 너비에 맞춤 · 행 경계에서 쪽 나눔). 그린 화면을 그림으로 찍어(html-to-image) pdf-lib 로 PDF 를 만든다.
 * 글자는 그림이라 PDF 에서 고를 수 없음(서명 칸 놓기·서명에는 지장 없음). 한글(.hwp)·옛 워드(.doc)·옛 엑셀(.xls)·파워포인트는 안내만.
 */
import { PDFDocument } from 'pdf-lib';

export const CONVERTIBLE = /\.(docx|xlsx)$/i;
export type Converted = { file: File; pages: number; thumbs: string[]; kind: 'docx' | 'xlsx' };
type Page = { canvas: HTMLCanvasElement; w: number; h: number }; // w·h = CSS px(96dpi)

const FALLBACK = "'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";
const A4 = { w: 794, h: 1123 };

function makeStage() {
  const stage = document.createElement('div');
  stage.setAttribute('data-office-stage', '');
  stage.style.cssText = 'position:fixed;left:-40000px;top:0;z-index:-1;pointer-events:none;background:#fff;color:#000;';
  const st = document.createElement('style'); // 화면 기본 꾸밈(그림 줄바꿈·글꼴)이 문서 모양을 바꾸지 않게
  st.textContent = `[data-office-stage] img,[data-office-stage] svg{display:inline;max-width:none;height:auto}[data-office-stage]{font-family:${FALLBACK};line-height:normal}`;
  stage.appendChild(st); document.body.appendChild(stage);
  return stage;
}
async function settle(root: HTMLElement) {
  await Promise.all([...root.querySelectorAll('img')].map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = () => r(null); }))));
  await (document as any).fonts?.ready?.catch?.(() => null);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}
/** 문서 글꼴이 이 PC 에 없을 때 바탕(명조)체로 떨어지지 않게 — 글꼴 목록 끝에 한글 고딕을 붙임 */
function addFallbackFonts(root: HTMLElement) {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    const f = getComputedStyle(el).fontFamily;
    if (f && !/sans-serif|serif|monospace/.test(f)) el.style.fontFamily = `${f}, ${FALLBACK}`;
  }
}
async function shot(node: HTMLElement, w: number, h: number, ratio: number) {
  const { toCanvas } = await import('html-to-image');
  return toCanvas(node, { width: w, height: h, pixelRatio: ratio, backgroundColor: '#ffffff', skipFonts: true, cacheBust: false });
}
const blank = (w: number, h: number, r: number) => { const c = document.createElement('canvas'); c.width = Math.round(w * r); c.height = Math.round(h * r); const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); return c; };

/** y(CSS px)부터 target 까지 중 자를 줄: target 위 20% 안에서 글자가 가장 적은(되도록 빈) 줄, 가까운 쪽 우선 */
function bestCut(c: HTMLCanvasElement, r: number, y: number, target: number, span: number) {
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const win = Math.max(8, Math.floor(span * 0.2)); const top = Math.max(y + span * 0.5, target - win);
  const y0 = Math.floor(top * r), y1 = Math.floor(target * r); if (y1 <= y0) return target;
  const W = c.width; const img = ctx.getImageData(0, y0, W, y1 - y0).data;
  let best = y1, bestInk = Infinity;
  for (let row = y1 - y0 - 1; row >= 0; row--) {
    let ink = 0; for (let x = 0; x < W; x += 2) { const i = (row * W + x) * 4; if (img[i] < 200 || img[i + 1] < 200 || img[i + 2] < 200) ink++; }
    if (ink < bestInk) { bestInk = ink; best = y0 + row; if (ink === 0) break; }
  }
  return best / r;
}

async function docxPages(file: File, stage: HTMLElement): Promise<Page[]> {
  const { renderAsync } = await import('docx-preview');
  const styles = document.createElement('div'); const body = document.createElement('div'); stage.append(styles, body);
  await renderAsync(await file.arrayBuffer(), body, styles, { className: 'docx', inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false, renderHeaders: true, renderFooters: true,
    renderFootnotes: true, renderEndnotes: true, useBase64URL: true, renderChanges: false, renderComments: false, ignoreWidth: false, ignoreHeight: false, ignoreFonts: false });
  await settle(body); addFallbackFonts(body);
  const out: Page[] = [];
  for (const sec of body.querySelectorAll<HTMLElement>('section.docx')) {
    const cs = getComputedStyle(sec); const W = Math.round(sec.offsetWidth) || A4.w; const H = Math.round(sec.offsetHeight);
    const pageH = Math.round(parseFloat(cs.minHeight)) || Math.round(W * 1.4142);
    const pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    const r = Math.min(2, 30000 / Math.max(H, pageH));
    const c = await shot(sec, W, Math.max(H, pageH), r);
    if (H <= pageH + 4) { const pc = blank(W, pageH, r); pc.getContext('2d')!.drawImage(c, 0, 0, c.width, Math.round(pageH * r), 0, 0, pc.width, pc.height); out.push({ canvas: pc, w: W, h: pageH }); continue; }
    // 워드가 쪽 나눔 표시를 남기지 않은 긴 쪽: 본문만 쪽 높이로 잘라 쪽마다 머리글·바닥글을 다시 붙임
    const span = pageH - pt - pb; let y = pt; const end = H - pb;
    while (y < end - 1) {
      let next = Math.min(end, y + span); if (next < end) next = bestCut(c, r, y, next, span);
      const pc = blank(W, pageH, r); const x = pc.getContext('2d')!;
      x.drawImage(c, 0, 0, c.width, pt * r, 0, 0, pc.width, pt * r);
      x.drawImage(c, 0, y * r, c.width, (next - y) * r, 0, pt * r, pc.width, (next - y) * r);
      x.drawImage(c, 0, (H - pb) * r, c.width, pb * r, 0, (pageH - pb) * r, pc.width, pb * r);
      out.push({ canvas: pc, w: W, h: pageH }); y = next;
      if (out.length > 200) break;
    }
  }
  if (!out.length) throw new Error('워드 문서에서 쪽을 찾지 못했습니다');
  return out;
}

async function xlsxPages(file: File, stage: HTMLElement): Promise<Page[]> {
  const { readXlsx } = await import('@/lib/xlsxSheet');
  const sheets = await readXlsx(await file.arrayBuffer());
  if (!sheets.length) throw new Error('엑셀에 내용이 있는 시트가 없습니다');
  const out: Page[] = [];
  for (const sh of sheets) {
    const colPx = sh.colW.map((w) => (w ? Math.round(w * 7 + 5) : 0)); const tableW = colPx.reduce((a, b) => a + b, 0) || 1;
    const t = document.createElement('table');
    t.style.cssText = `border-collapse:collapse;table-layout:fixed;width:${tableW}px;font-family:${FALLBACK};font-size:11pt;color:#000;background:#fff`;
    const cg = document.createElement('colgroup'); for (const w of colPx) { const c = document.createElement('col'); c.style.width = `${w}px`; cg.appendChild(c); } t.appendChild(cg);
    const tb = document.createElement('tbody'); t.appendChild(tb);
    sh.cells.forEach((row, ri) => {
      const tr = document.createElement('tr'); tr.style.height = `${Math.round(sh.rowH[ri] * 4 / 3)}px`; if (!sh.rowH[ri]) tr.style.display = 'none';
      row.forEach((cell, ci) => {
        if (cell?.covered) return;
        const td = document.createElement('td'); const s = cell?.s;
        if (cell && cell.cs > 1) td.colSpan = cell.cs; if (cell && cell.rs > 1) td.rowSpan = cell.rs;
        const num = cell?.v !== undefined && /^-?[\d,.]+%?$/.test(cell.v) && cell.v !== '';
        td.style.cssText = `padding:1px 3px;overflow:hidden;vertical-align:${s?.va === 'center' ? 'middle' : s?.va === 'top' ? 'top' : 'bottom'};text-align:${s?.ha === 'centerContinuous' ? 'center' : s?.ha && s.ha !== 'general' ? s.ha : num ? 'right' : 'left'};white-space:${s?.wrap ? 'pre-wrap' : 'pre'};word-break:break-all`;
        if (!colPx[ci]) td.style.display = 'none';
        if (s?.b) td.style.fontWeight = '700'; if (s?.i) td.style.fontStyle = 'italic'; if (s?.u) td.style.textDecoration = 'underline';
        if (s?.sz) td.style.fontSize = `${s.sz}pt`; if (s?.color) td.style.color = s.color; if (s?.fill) td.style.background = s.fill;
        if (s?.bt) td.style.borderTop = s.bt; if (s?.bb) td.style.borderBottom = s.bb; if (s?.bl) td.style.borderLeft = s.bl; if (s?.br) td.style.borderRight = s.br;
        // 엑셀처럼 줄바꿈 없는 글은 오른쪽 빈 칸까지 넘쳐 보이게(옆 칸에 글이 있으면 거기서 잘림)
        if (cell?.v && !s?.wrap && (cell.cs ?? 1) === 1 && !['center', 'right', 'centerContinuous'].includes(s?.ha ?? '') && !num) {
          let w = colPx[ci]; for (let k = ci + 1; k < row.length && !(row[k]?.v) && !row[k]?.covered; k++) w += colPx[k];
          const inner = document.createElement('div'); inner.style.cssText = `width:${Math.max(0, w - 6)}px;overflow:hidden`; inner.textContent = cell.v;
          td.style.overflow = 'visible'; td.appendChild(inner); tr.appendChild(td); return;
        }
        td.textContent = cell?.v ?? ''; tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    const holder = document.createElement('div'); holder.style.cssText = 'display:inline-block;background:#fff'; holder.appendChild(t); stage.appendChild(holder);
    await settle(holder);
    const W = holder.offsetWidth, H = holder.offsetHeight;
    const pw = sh.landscape ? A4.h : A4.w, ph = sh.landscape ? A4.w : A4.h;
    const ml = sh.margins.l * 96, mr = sh.margins.r * 96, mt = sh.margins.t * 96, mb = sh.margins.b * 96;
    const scale = Math.min(1, (pw - ml - mr) / W); const room = (ph - mt - mb) / scale; // 표 단위(px)로 한 쪽에 들어가는 높이
    const r = Math.min(2, 30000 / H);
    const c = await shot(holder, W, H, r);
    const trs = [...tb.querySelectorAll('tr')].filter((x) => x.style.display !== 'none');
    let y = 0;
    while (y < H - 1) {
      let next = y + room;
      if (next < H) { const cut = trs.map((x) => x.offsetTop).filter((top) => top > y + 1 && top <= next).pop(); next = cut ?? next; } else next = H; // 행 경계에서
      const pc = blank(pw, ph, r);
      pc.getContext('2d')!.drawImage(c, 0, y * r, c.width, (next - y) * r, ml * r, mt * r, W * scale * r, (next - y) * scale * r);
      out.push({ canvas: pc, w: pw, h: ph }); y = next;
      if (out.length > 200) break;
    }
    holder.remove();
  }
  return out;
}

async function toPdf(pages: Page[]) {
  const pdf = await PDFDocument.create();
  for (const p of pages) {
    const jpg = await new Promise<ArrayBuffer>((ok, no) => p.canvas.toBlob((b) => (b ? b.arrayBuffer().then(ok, no) : no(new Error('쪽 그림을 만들지 못했습니다'))), 'image/jpeg', 0.92));
    const img = await pdf.embedJpg(jpg); const pg = pdf.addPage([p.w * 0.75, p.h * 0.75]);
    pg.drawImage(img, { x: 0, y: 0, width: p.w * 0.75, height: p.h * 0.75 });
  }
  return pdf.save();
}
const thumb = (c: HTMLCanvasElement) => { const w = 160; const t = document.createElement('canvas'); t.width = w; t.height = Math.round(c.height * (w / c.width)); t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', 0.8); };

/** 워드·엑셀 → PDF(이 브라우저 안에서만). 실패하면 알아듣는 오류 */
export async function officeToPdf(file: File): Promise<Converted> {
  const kind = /\.docx$/i.test(file.name) ? 'docx' : /\.xlsx$/i.test(file.name) ? 'xlsx' : null;
  if (!kind) throw new Error('워드(.docx)·엑셀(.xlsx)만 바꿀 수 있습니다');
  const stage = makeStage();
  try {
    const pages = kind === 'docx' ? await docxPages(file, stage) : await xlsxPages(file, stage);
    const bytes = await toPdf(pages);
    const name = file.name.replace(/\.(docx|xlsx)$/i, '.pdf');
    return { file: new File([bytes as BlobPart], name, { type: 'application/pdf' }), pages: pages.length, thumbs: pages.slice(0, 4).map((p) => thumb(p.canvas)), kind };
  } finally { stage.remove(); }
}
