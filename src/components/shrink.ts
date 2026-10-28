'use client';

/** V8 5번: 사진은 올리기 전에 긴 변 1600px·JPEG 85% 로 줄인다(휴대폰 원본 5~10MB → 수백 KB). GIF·작은 사진·실패 시 원본
 *  248차 #780: 아이폰 사진(HEIC)은 고르기 칸이 변환하지 않고 넘기므로(PHOTO_ACCEPT) 크기와 상관없이 JPEG 로 바꿈 — createImageBitmap 이 못 읽으면 <img> 로 한 번 더(iOS 17+ 는 HEIC 를 읽음),
 *  그래도 못 읽으면 원본 HEIC 를 그대로 올림(첨부 줄에 '아이폰 사진(HEIC) — 내려받아 보기') */
const isHeicFile = (f: File) => /^image\/hei[cf]$/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
async function decode(file: File): Promise<{ w: number; h: number; draw: (c: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try { const b = await createImageBitmap(file); return { w: b.width, h: b.height, draw: (c, w, h) => c.drawImage(b, 0, 0, w, h), close: () => b.close() }; } catch { /* 아래 <img> 로 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight, draw: (c, w, h) => c.drawImage(img, 0, 0, w, h), close: () => { img.src = ''; URL.revokeObjectURL(url); } };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}
export async function shrinkImage(file: File): Promise<File> {
  const heic = isHeicFile(file);
  if (!heic && (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size < 400 * 1024)) return file;
  try {
    const bmp = await decode(file);
    // 대표 10/27(휴대폰 사진 150장 안 올라감): 풀어 놓은 사진·그림판을 바로 비움 — 안 비우면 장수가 많을 때 휴대폰 메모리가 모자라 화면이 멈춤
    const c = document.createElement('canvas');
    try {
      const scale = Math.min(1, 1600 / Math.max(bmp.w, bmp.h));
      if (!heic && scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
      c.width = Math.round(bmp.w * scale); c.height = Math.round(bmp.h * scale);
      bmp.draw(c.getContext('2d')!, c.width, c.height);
    } finally { bmp.close(); }
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    c.width = 0; c.height = 0;
    if (!blob || (!heic && blob.size >= file.size)) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } catch { return file; }
}
