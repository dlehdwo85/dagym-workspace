'use client';
import { useEffect, useState } from 'react';

/** 전자계약 2차: PDF 쪽을 그림으로(pdf.js, 워커 없이 같은 스레드 — 계약서 몇 쪽이면 충분). 편집기·서명 화면 공용, 칸 좌표는 쪽 크기 기준 비율 */
export type PdfPage = { url: string; w: number; h: number };
export const SIGNER_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];
/** maxPages 넘는 쪽은 그리지 않음(total = 전체 쪽 수) */
export function usePdfPages(src: string | null, maxPages = 200) {
  const [pages, setPages] = useState<PdfPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!src) return;
    let dead = false; setPages(null); setError(null);
    (async () => {
      const r = await fetch(src);
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message ?? 'PDF 를 불러오지 못했습니다');
      const data = new Uint8Array(await r.arrayBuffer());
      const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs'); // legacy = 옛 브라우저용 보충 코드 포함(기본 빌드는 Map.getOrInsertComputed 등 최신 기능이 없는 브라우저에서 멈춤)
      const g = globalThis as any;
      if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
      const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
      const out: PdfPage[] = [];
      if (!dead) setTotal(doc.numPages);
      for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(2, 1400 / base.width) });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        out.push({ url: canvas.toDataURL('image/jpeg', 0.85), w: base.width, h: base.height });
      }
      if (!dead) setPages(out);
    })().catch((e) => { if (!dead) setError(e?.message || 'PDF 를 그리지 못했습니다'); });
    return () => { dead = true; };
  }, [src, maxPages]);
  return { pages, error, total };
}
