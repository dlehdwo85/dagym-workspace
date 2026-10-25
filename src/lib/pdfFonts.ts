// 147차(로컬 10/25 14:40 긴급): PDF(pdf-lib) 한글 글꼴 = NotoSansKR 를 TrueType 으로 바꾼 자산(.ttf).
// 원본 .otf(CFF·CID 방식)를 subset: true 로 넣으면 fontkit 이 만든 부분 글꼴이 깨져 크롬(PDFium)에선 한글이 안 보이고 pdf.js 는 자모만 그렸음.
// .ttf 는 글리프마다 4바이트로 맞춰 둠 — fontkit 부분 글꼴이 짧은 loca(오프셋 ÷2)를 쓸 때 홀수 길이 글리프가 어긋나지 않게(scripts/fonts/otf2ttf.py).
// .otf 는 마케팅 그림(mktCarouselDraw·mktVideo)에서 그대로 쓴다.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let cache: { regular: Uint8Array; bold: Uint8Array } | null = null;
export async function pdfFonts() {
  if (!cache) {
    const dir = path.join(process.cwd(), 'assets', 'fonts');
    cache = { regular: new Uint8Array(await readFile(path.join(dir, 'NotoSansKR-Regular.ttf'))), bold: new Uint8Array(await readFile(path.join(dir, 'NotoSansKR-Bold.ttf'))) };
  }
  return cache;
}
