// 화상회의 자료 공유(사진·PDF) — 휴대폰 브라우저·앱의 웹 화면은 '화면 전체 공유'를 못 하므로(운영체제 제약), 고른 사진·PDF 를 그림판에 그려 화면 공유 길로 보낸다.
// 컴퓨터에서도 "이 파일만" 보여 주고 싶을 때 쓴다(다른 창이 비칠 걱정 없음). 파일은 서버에 올라가지 않는다 — 이 기기에서 그려 영상으로만 나간다.
export type DocHandle = { canvas: HTMLCanvasElement; name: string; pages: number; page: number; go(n: number): Promise<void>; close(): void };
const MAX_BYTES = 30 * 1024 * 1024, MAX_SIDE = 1600;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export async function openDoc(file: File): Promise<DocHandle> {
  if (file.size > MAX_BYTES) throw new Error('30MB 까지 보여 줄 수 있습니다');
  const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!pdf && !/^image\//.test(file.type)) throw new Error('사진이나 PDF 파일을 골라 주세요');
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.captureStream !== 'function') throw new Error('이 브라우저에서는 자료 공유를 쓸 수 없습니다');
  let src: CanvasImageSource | null = null; let sw = 0, sh = 0;
  const paint = () => { if (!src) return; if (canvas.width !== sw || canvas.height !== sh) { canvas.width = sw; canvas.height = sh; } ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, sw, sh); ctx.drawImage(src, 0, 0, sw, sh); };
  // 멈춘 그림은 영상 프레임이 나가지 않는다 → 늦게 들어온 사람도 보이도록 조금씩 다시 그린다
  const keep = setInterval(paint, 700);
  const h: DocHandle = { canvas, name: file.name, pages: 1, page: 1, go: async () => {}, close: () => clearInterval(keep) };
  try {
    if (!pdf) {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('사진을 열지 못했습니다')); i.src = url; });
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      sw = even(img.naturalWidth * k); sh = even(img.naturalHeight * k); src = img; paint();
      const close0 = h.close; h.close = () => { close0(); URL.revokeObjectURL(url); };
      return h;
    }
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const g = globalThis as any; if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    h.pages = doc.numPages;
    let busy = false;
    h.go = async (n: number) => {
      const to = Math.min(doc.numPages, Math.max(1, n)); if (busy) return; busy = true;
      try {
        const page = await doc.getPage(to); const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(2.5, MAX_SIDE / Math.max(base.width, base.height)) });
        const off = document.createElement('canvas'); off.width = even(vp.width); off.height = even(vp.height);
        await page.render({ canvas: off, canvasContext: off.getContext('2d'), viewport: vp }).promise;
        src = off; sw = off.width; sh = off.height; h.page = to; paint();
      } finally { busy = false; }
    };
    await h.go(1);
    return h;
  } catch (e) { clearInterval(keep); throw e instanceof Error && /보여 줄|골라|열지|쓸 수 없/.test(e.message) ? e : new Error('파일을 열지 못했습니다 — 암호가 걸렸거나 손상된 파일일 수 있습니다'); }
}
