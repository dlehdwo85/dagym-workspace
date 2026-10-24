'use client';
import { useEffect, useState } from 'react';

/** 전자계약 2차: PDF 쪽을 그림으로(pdf.js, 워커 없이 같은 스레드 — 계약서 몇 쪽이면 충분). 편집기·서명 화면 공용, 칸 좌표는 쪽 크기 기준 비율 */
export type PdfPage = { url: string; w: number; h: number };
export const SIGNER_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];
export function usePdfPages(src: string | null) {
  const [pages, setPages] = useState<PdfPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!src) return;
    let dead = false; setPages(null); setError(null);
    (async () => {
      const r = await fetch(src);
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message ?? '계약서를 불러오지 못했습니다');
      const data = new Uint8Array(await r.arrayBuffer());
      const pdfjs: any = await import('pdfjs-dist/build/pdf.mjs');
      const g = globalThis as any;
      if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
      const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
      const out: PdfPage[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(2, 1400 / base.width) });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        out.push({ url: canvas.toDataURL('image/jpeg', 0.85), w: base.width, h: base.height });
      }
      if (!dead) setPages(out);
    })().catch((e) => { if (!dead) setError(e?.message || '계약서를 그리지 못했습니다'); });
    return () => { dead = true; };
  }, [src]);
  return { pages, error };
}
