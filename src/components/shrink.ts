'use client';

/** V8 5번: 사진은 올리기 전에 긴 변 1600px·JPEG 85% 로 줄인다(휴대폰 원본 5~10MB → 수백 KB). GIF·작은 사진·실패 시 원본 */
export async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size < 400 * 1024 || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    // 대표 10/27(휴대폰 사진 150장 안 올라감): 풀어 놓은 사진·그림판을 바로 비움 — 안 비우면 장수가 많을 때 휴대폰 메모리가 모자라 화면이 멈춤
    const c = document.createElement('canvas');
    try {
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    } finally { bmp.close(); }
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    c.width = 0; c.height = 0;
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
  } catch { return file; }
}
