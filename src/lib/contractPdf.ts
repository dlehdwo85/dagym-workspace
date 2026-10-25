// 대표 10/20 20:00 ④ (#116) 전자계약서 완료 PDF — 본문(자리표시자 채운 글) + 서명란(이름·시각·서명 이미지) + 감사 추적(참여자·시각·IP·기기) 한 장.
// pdf-lib + NotoSansKR(자산 폰트). 견적서 PDF 와 같은 방식, 여러 쪽.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { FIT_LINE, fitText } from './textFit';

let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;
async function fonts() {
  if (!fontCache) {
    const dir = path.join(process.cwd(), 'assets', 'fonts');
    fontCache = { regular: new Uint8Array(await readFile(path.join(dir, 'NotoSansKR-Regular.otf'))), bold: new Uint8Array(await readFile(path.join(dir, 'NotoSansKR-Bold.otf'))) };
  }
  return fontCache;
}
const fmtAt = (d: Date | string | null | undefined) => (d ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(d)) : '');
export const ROLE_LABEL: Record<string, string> = { employee: '근로자(을)', company: '회사(갑)', witness: '입회인', party: '상대방' };
export const EVENT_LABEL: Record<string, string> = { created: '작성', sent: '발송', resent: '재발송', opened: '링크 열람', code_ok: '접속 코드 확인', code_fail: '접속 코드 오류', locked: '코드 5회 오류로 잠김', signed: '서명', declined: '서명 거절', completed: '완료(PDF 생성)', cancelled: '취소', pdf_viewed: '완료본 열람' };

export type PdfSigner = { role: string; name: string; email: string | null; signed_at: Date | string | null; sign_method: string | null; signature_png: Buffer | Uint8Array | null; status: string };
export type PdfEvent = { type: string; at: Date | string; ip: string | null; user_agent: string | null; who: string | null; detail?: any };

/** 본문·서명·감사 추적을 A4 여러 쪽으로. 반환 Buffer */
export async function renderContractPdf(p: { title: string; docNo: string | null; company: string; body: string; signers: PdfSigner[]; events: PdfEvent[]; completedAt: Date | string | null }): Promise<Buffer> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const f = await fonts();
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(f.regular, { subset: true }), bold = await doc.embedFont(f.bold, { subset: true });
  const W = 595.28, H = 841.89, M = 50, FS = 10.2, LH = FS * 1.6;
  const ink = rgb(0.1, 0.1, 0.12), grey = rgb(0.42, 0.44, 0.47), lineC = rgb(0.78, 0.8, 0.83);
  let page = doc.addPage([W, H]); let y = H - M; let pageNo = 1;
  const footer = () => { page.drawText(`${p.docNo ?? ''}  ·  ${p.company}  ·  ${pageNo} 쪽`, { x: M, y: 28, size: 8, font: reg, color: grey }); };
  const newPage = () => { footer(); page = doc.addPage([W, H]); y = H - M; pageNo++; };
  const need = (h: number) => { if (y - h < M + 20) newPage(); };
  const wrap = (s: string, font: typeof reg, size: number, maxW: number) => {
    const out: string[] = [];
    for (const para of s.split('\n')) {
      let cur = '';
      for (const ch of para) {
        const t = cur + ch;
        if (font.widthOfTextAtSize(t, size) > maxW && cur) { out.push(cur); cur = ch === ' ' ? '' : ch; } else cur = t;
      }
      out.push(cur);
    }
    return out;
  };
  const text = (s: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; maxW?: number; gap?: number } = {}) => {
    const size = o.size ?? FS, font = o.bold ? bold : reg, lh = size * 1.6, x = o.x ?? M;
    for (const ln of wrap(s, font, size, o.maxW ?? W - x - M)) { need(lh); page.drawText(ln, { x, y: y - size, size, font, color: o.color ?? ink }); y -= lh; }
    y -= o.gap ?? 0;
  };
  // 제목
  text(p.title, { size: 18, bold: true, gap: 2 });
  text(`${p.docNo ? `문서번호 ${p.docNo} · ` : ''}${p.company}${p.completedAt ? ` · 완료 ${fmtAt(p.completedAt)}` : ''}`, { size: 9, color: grey, gap: 6 });
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: lineC }); y -= 14;
  // 본문: '# ' 줄은 소제목, 빈 줄은 간격
  for (const raw of p.body.split('\n')) {
    if (!raw.trim()) { y -= LH * 0.5; continue; }
    if (raw.startsWith('# ')) { y -= 4; text(raw.slice(2), { size: 12, bold: true, gap: 2 }); continue; }
    text(raw);
  }
  // 서명란
  y -= 10; need(40);
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: lineC }); y -= 12;
  text('서명', { size: 12, bold: true, gap: 4 });
  for (const s of p.signers) {
    need(78);
    const top = y;
    page.drawRectangle({ x: M, y: top - 70, width: W - 2 * M, height: 70, borderColor: lineC, borderWidth: 0.6 });
    page.drawText(ROLE_LABEL[s.role] ?? s.role, { x: M + 10, y: top - 18, size: 9, font: bold, color: grey });
    page.drawText(s.name, { x: M + 10, y: top - 34, size: 11, font: bold, color: ink });
    page.drawText(s.status === 'signed' ? `${fmtAt(s.signed_at)} 서명(${s.sign_method === 'stamp' ? '도장' : '직접 그림'})` : s.status === 'declined' ? '서명 거절' : '서명 전', { x: M + 10, y: top - 50, size: 8.5, font: reg, color: grey });
    if (s.email) page.drawText(s.email, { x: M + 10, y: top - 62, size: 8, font: reg, color: grey });
    if (s.signature_png && s.status === 'signed') {
      try {
        const img = await doc.embedPng(s.signature_png);
        const maxW = 150, maxH = 54; const sc = Math.min(maxW / img.width, maxH / img.height, 1);
        page.drawImage(img, { x: W - M - 10 - img.width * sc, y: top - 8 - img.height * sc, width: img.width * sc, height: img.height * sc });
      } catch { /* 깨진 이미지는 비워 둠 */ }
    }
    y = top - 78;
  }
  // 감사 추적
  newPage();
  text('서명 감사 추적', { size: 14, bold: true, gap: 2 });
  text('이 문서는 워크인 전자계약으로 작성·서명되었습니다. 아래는 참여자의 행위 기록(시각은 한국 시간)입니다.', { size: 9, color: grey, gap: 8 });
  const cols = [M, M + 118, M + 200, M + 290, M + 385];
  const head = ['시각', '참여자', '행위', 'IP', '기기'];
  head.forEach((h, i) => page.drawText(h, { x: cols[i], y: y - 9, size: 8.5, font: bold, color: grey })); y -= 16;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: lineC }); y -= 6;
  const cut = (s: string, font: typeof reg, size: number, maxW: number) => { let t = s; while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2) + '…'; return t; };
  for (const e of p.events) {
    need(14);
    const row = [fmtAt(e.at), e.who ?? '-', EVENT_LABEL[e.type] ?? e.type, e.ip ?? '-', (e.user_agent ?? '-').replace(/^Mozilla\/5\.0 \(/, '(')];
    const widths = [112, 78, 86, 92, W - M - cols[4]];
    row.forEach((c, i) => page.drawText(cut(c, reg, 8, widths[i]), { x: cols[i], y: y - 8, size: 8, font: reg, color: ink }));
    y -= 13;
  }
  footer();
  return Buffer.from(await doc.save());
}

/**
 * 전자계약 2차(글로싸인 레퍼런스): 올린 계약서 원본 쪽은 그대로 두고 칸 값을 같은 좌표에 찍는다 — 서명·도장 = 서명자 이미지(칸 안에 비율 유지),
 * 텍스트·날짜 = 글자(칸에 맞게 줄임). 칸 좌표는 쪽 크기 기준 비율(왼쪽 위 0,0). 맨 뒤에 감사 추적 쪽(원본 해시·참여자·행위 기록)
 */
export async function renderFieldsPdf(p: { source: Buffer | Uint8Array; title: string; docNo: string | null; company: string; originalSha256: string | null;
  signers: (PdfSigner & { id: string; ord: number; ip: string | null })[]; fields: { signer_id: string; type: string; page: number; x: number; y: number; w: number; h: number; value: string | null }[];
  events: PdfEvent[]; completedAt: Date | string | null }): Promise<Buffer> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const f = await fonts();
  const doc = await PDFDocument.load(p.source, { updateMetadata: false }); doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(f.regular, { subset: true }), bold = await doc.embedFont(f.bold, { subset: true });
  const ink = rgb(0.08, 0.08, 0.1), grey = rgb(0.42, 0.44, 0.47), lineC = rgb(0.78, 0.8, 0.83);
  const imgs = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>();
  for (const s of p.signers) if (s.signature_png && s.status === 'signed') { try { imgs.set(s.id, await doc.embedPng(s.signature_png)); } catch { /* 깨진 이미지는 비워 둠 */ } }
  const pages = doc.getPages();
  for (const fd of p.fields) {
    const page = pages[fd.page - 1]; if (!page) continue;
    const { width: PW, height: PH } = page.getSize();
    const bx = fd.x * PW, bw = fd.w * PW, bh = fd.h * PH, by = PH - fd.y * PH - bh;
    if (fd.type === 'sign' || fd.type === 'stamp') {
      const img = imgs.get(fd.signer_id); if (!img) continue;
      const sc = Math.min(bw / img.width, bh / img.height), w = img.width * sc, h = img.height * sc;
      page.drawImage(img, { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, width: w, height: h });
    } else if (fd.value) {
      // #258 칸보다 긴 값은 줄을 바꾸고 글자를 줄임(예전엔 뒤를 잘랐음) — 한 줄에 들어가는 값은 예전과 같은 크기·자리
      const { size, lines } = fitText(fd.value, bw, bh, (t) => reg.widthOfTextAtSize(t, 1), { fill: 0.7 });
      const lh = size * FIT_LINE, top = lines.length === 1 ? by + (bh - size) / 2 + size * 0.18 : by + bh - size * 0.95;
      lines.forEach((l, n) => { if (l) page.drawText(l, { x: bx + 1, y: top - n * lh, size, font: reg, color: ink }); });
    }
  }
  // 감사 추적 쪽
  const W = 595.28, H = 841.89, M = 50;
  let page = doc.addPage([W, H]); let y = H - M;
  const line = (t: string, o: { size?: number; b?: boolean; c?: ReturnType<typeof rgb>; x?: number } = {}) => {
    const size = o.size ?? 9; if (y - size * 1.6 < M) { page = doc.addPage([W, H]); y = H - M; }
    let s = t; const font = o.b ? bold : reg, maxW = W - M - (o.x ?? M); while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxW) s = s.slice(0, -2) + '…';
    page.drawText(s, { x: o.x ?? M, y: y - size, size, font, color: o.c ?? ink }); y -= size * 1.6;
  };
  line('서명 감사 추적', { size: 14, b: true });
  line(`${p.title}${p.docNo ? ` · 문서번호 ${p.docNo}` : ''} · ${p.company}`, { c: grey });
  line(`원본 문서 SHA-256: ${p.originalSha256 ?? '-'}`, { size: 8, c: grey });
  if (p.completedAt) line(`완료 ${fmtAt(p.completedAt)} (한국 시간) · 이 쪽 앞까지가 서명된 원본 쪽입니다`, { size: 8, c: grey });
  y -= 6; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: lineC }); y -= 10;
  line('서명자', { size: 11, b: true });
  for (const s of p.signers) line(`${s.ord}. ${ROLE_LABEL[s.role] ?? s.role} ${s.name}${s.email ? ` (${s.email})` : ''} — ${s.status === 'signed' ? `${fmtAt(s.signed_at)} 서명(${s.sign_method === 'stamp' ? '도장' : '직접 그림'}) · IP ${s.ip ?? '-'}` : s.status === 'declined' ? '서명 거절' : '서명 전'}`);
  y -= 6; line('행위 기록', { size: 11, b: true });
  for (const e of p.events) line(`${fmtAt(e.at)}  ${e.who ?? '-'}  ${EVENT_LABEL[e.type] ?? e.type}  IP ${e.ip ?? '-'}  ${(e.user_agent ?? '').replace(/^Mozilla\/5\.0 \(/, '(').slice(0, 60)}`, { size: 8 });
  return Buffer.from(await doc.save());
}

/** 회전(/Rotate)이 걸린 쪽은 보이는 방향 그대로 새 쪽에 옮겨 담는다 — 화면(pdf.js)의 칸 좌표와 완료본 좌표가 같게. 회전 없으면 null */
export async function unrotatePdf(buf: Buffer | Uint8Array): Promise<Buffer | null> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const src = await PDFDocument.load(buf, { updateMetadata: false });
  const angle = (pg: { getRotation(): { angle: number } }) => ((pg.getRotation().angle % 360) + 360) % 360;
  if (!src.getPages().some((pg) => angle(pg) !== 0)) return null;
  const out = await PDFDocument.create();
  for (const pg of src.getPages()) {
    const a = angle(pg), { width: w, height: h } = pg.getSize(), e = await out.embedPage(pg);
    const [nw, nh] = a === 90 || a === 270 ? [h, w] : [w, h];
    const np = out.addPage([nw, nh]);
    if (a === 0) np.drawPage(e, { x: 0, y: 0 });
    else if (a === 90) np.drawPage(e, { x: 0, y: nh, rotate: degrees(-90) });
    else if (a === 180) np.drawPage(e, { x: nw, y: nh, rotate: degrees(180) });
    else np.drawPage(e, { x: nw, y: 0, rotate: degrees(90) });
  }
  return Buffer.from(await out.save());
}

/** #533 업무 첨부 PDF [고치기]: 쪽 비율 좌표(0..1, 왼쪽 위 기준)에 가리기(흰 상자)·글자(여러 줄)·체크·서명 그림을 찍은 새 PDF. 없는 쪽이면 Error('NO_PAGE'), 칸에 안 들어가는 글이면 Error('TEXT_OVER') */
export type StampItem = { type: 'text' | 'check' | 'sign' | 'cover'; page: number; x: number; y: number; w: number; h: number; value?: string; png?: Buffer };
export async function stampPdf(source: Buffer | Uint8Array, items: StampItem[]): Promise<Buffer> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const f = await fonts();
  const doc = await PDFDocument.load(source, { updateMetadata: false }); doc.registerFontkit(fontkit);
  const reg = await doc.embedFont(f.regular, { subset: true });
  const ink = rgb(0.08, 0.08, 0.1);
  const pages = doc.getPages();
  if (items.some((it) => !pages[it.page - 1])) throw new Error('NO_PAGE');
  // 가리기를 먼저 — 같은 자리에 놓은 글자가 흰 상자 위에 오게
  for (const it of [...items].sort((a, b) => Number(b.type === 'cover') - Number(a.type === 'cover'))) {
    const page = pages[it.page - 1];
    const { width: PW, height: PH } = page.getSize();
    const bx = it.x * PW, bw = it.w * PW, bh = it.h * PH, by = PH - it.y * PH - bh;
    if (it.type === 'cover') page.drawRectangle({ x: bx, y: by, width: bw, height: bh, color: rgb(1, 1, 1) });
    else if (it.type === 'check') {
      const s = Math.min(bw, bh), ox = bx + (bw - s) / 2, oy = by + (bh - s) / 2, th = Math.max(1, s * 0.12);
      page.drawLine({ start: { x: ox + s * 0.12, y: oy + s * 0.52 }, end: { x: ox + s * 0.4, y: oy + s * 0.2 }, thickness: th, color: ink });
      page.drawLine({ start: { x: ox + s * 0.4, y: oy + s * 0.2 }, end: { x: ox + s * 0.9, y: oy + s * 0.85 }, thickness: th, color: ink });
    } else if (it.type === 'sign' && it.png) {
      const img = await doc.embedPng(it.png);
      const sc = Math.min(bw / img.width, bh / img.height), w = img.width * sc, h = img.height * sc;
      page.drawImage(img, { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, width: w, height: h });
    } else if (it.type === 'text' && it.value) {
      // #258 칸 폭에서 줄을 바꾸고 칸 높이에 맞게 글자를 줄임 — 글은 자르지 않고, 가장 작은 글자로도 넘치면 Error('TEXT_OVER')(칸을 키우라고 안내)
      const { size, lines, over } = fitText(it.value, bw, bh, (t) => reg.widthOfTextAtSize(t, 1));
      if (over) throw new Error('TEXT_OVER');
      const lh = size * FIT_LINE, top = lines.length === 1 ? by + (bh - size) / 2 + size * 0.18 : by + bh - size * 0.95; // 한 줄은 칸 가운데(전자계약 칸과 같은 식), 여러 줄은 위에서부터
      lines.forEach((l, n) => { if (l) page.drawText(l, { x: bx + 1, y: top - n * lh, size, font: reg, color: ink }); });
    }
  }
  return Buffer.from(await doc.save());
}
