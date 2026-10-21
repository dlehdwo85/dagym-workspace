// 대표 10/20 20:00 ④ (#116) 전자계약서 완료 PDF — 본문(자리표시자 채운 글) + 서명란(이름·시각·서명 이미지) + 감사 추적(참여자·시각·IP·기기) 한 장.
// pdf-lib + NotoSansKR(자산 폰트). 견적서 PDF 와 같은 방식, 여러 쪽.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;
async function fonts() {
  if (!fontCache) {
    const dir = path.join(process.cwd(), 'assets', 'fonts');
    fontCache = { regular: new Uint8Array(await readFile(path.join(dir, 'NotoSansKR-Regular.otf'))), bold: new Uint8Array(await readFile(path.join(dir, 'NotoSansKR-Bold.otf'))) };
  }
  return fontCache;
}
const fmtAt = (d: Date | string | null | undefined) => (d ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(d)) : '');
export const ROLE_LABEL: Record<string, string> = { employee: '근로자(을)', company: '회사(갑)', witness: '입회인' };
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
