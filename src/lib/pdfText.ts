// V14 32: PDF 본문 글자 추출 — pdfjs-dist(오픈소스, Node 전용 legacy 빌드, 워커·캔버스 없음). 스캔 PDF(글자 없음)는 null → 정리 때 AI 비전으로.
const MAX_PAGES = 80;

export async function pdfText(buf: Buffer): Promise<string | null> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let s = '';
      for (const it of tc.items as { str?: string; hasEOL?: boolean }[]) { if (it.str) s += it.str; if (it.hasEOL) s += '\n'; }
      if (s.trim()) pages.push(s.trim());
      page.cleanup();
    }
    const text = pages.join('\n\n').replace(/[ \t]+\n/g, '\n').trim();
    return text || null;
  } finally { await task.destroy().catch(() => {}); }
}
