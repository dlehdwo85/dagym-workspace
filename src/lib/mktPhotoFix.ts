/**
 * 188차(대표 #685 '실사 보정·참고 제작 시도 없음' · #621 '자료실 사진을 그냥 쓰지 말고 품질 검수 → 보정'): 시안(표지·카드뉴스 장)에 깔 실사를
 * 그리기 전에 서버(sharp)가 손본다 — 외부 생성 없음·크레딧 0.
 *  · 자르기: 칸 크기에 맞춰 '중요 부분'(사람·물건이 몰린 곳 — sharp attention) 기준으로. 예전엔 가운데만 잘랐음(늘 하는 일이라 기록에는 안 남김)
 *  · 확대: 칸보다 1.5배 넘게 작은 사진은 고급 보간(lanczos3)으로 늘리고 선명하게
 *  · 대비: 뿌옇게 흐린 사진(밝기 폭이 좁음 — 표준편차 42 미만)은 대비를 폄(어두우면 밝기도 함께 좋아짐)
 *  · 밝기: 어두운 실내 사진(평균 밝기 88 미만)은 밝게(최대 1.45배)
 * 판단은 사진을 256px 흑백으로 줄여 평균·표준편차로. 한 색으로 거의 칠해진 그림(표준편차 3 미만)은 밝기·대비를 건드리지 않음.
 * 한 것만 fixes 로 돌려줌 → 시안 기록(quality.pages[].fix · visual.fix)과 노트 '보정 n장'. 아주 어두운 사진(AI 판정 dark)은 보정 전에 후보에서 이미 빠짐(171차).
 */
export type PhotoFix = { data: Buffer; fixes: string[] };
export const FIX_DARK = 88, FIX_FLAT = 42, FIX_UPSCALE = 1.5;
/** target = 칸 크기(그 크기로 잘라 돌려줌) · 없으면 색만 손보고 크기는 그대로(손볼 것이 없으면 원본 그대로) */
export async function enhancePhoto(buf: Buffer, target?: { w: number; h: number }): Promise<PhotoFix> {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buf, { failOn: 'none' }).metadata();
    const [iw, ih] = (meta.orientation ?? 1) >= 5 ? [meta.height ?? 0, meta.width ?? 0] : [meta.width ?? 0, meta.height ?? 0];
    if (!iw || !ih) return { data: buf, fixes: [] };
    const st = await sharp(buf, { failOn: 'none' }).rotate().resize(256, 256, { fit: 'inside' }).greyscale().stats();
    const mean = st.channels[0]?.mean ?? 128; const sd = st.channels[0]?.stdev ?? 64;
    const fixes: string[] = [];
    let p = sharp(buf, { failOn: 'none', limitInputPixels: 80e6 }).rotate();
    const up = target ? Math.max(target.w / iw, target.h / ih) >= FIX_UPSCALE : false;
    if (target) p = p.resize(target.w, target.h, { fit: 'cover', position: sharp.strategy.attention, kernel: 'lanczos3' });
    if (up) fixes.push('확대');
    if (sd >= 3) {
      if (sd < FIX_FLAT) { p = p.normalise({ lower: 1, upper: 99 }); fixes.push(...(mean < FIX_DARK ? ['밝기', '대비'] : ['대비'])); }
      else if (mean < FIX_DARK) { p = p.modulate({ brightness: Math.min(1.45, Math.max(1.08, 112 / Math.max(mean, 20))) }); fixes.push('밝기'); }
    }
    if (up) { p = p.sharpen({ sigma: 0.8 }); fixes.push('선명'); }
    if (!target && !fixes.length) return { data: buf, fixes };
    return { data: await p.jpeg({ quality: 92, mozjpeg: true }).toBuffer(), fixes };
  } catch { return { data: buf, fixes: [] }; }
}
/** 기록 한 줄: ['밝기','대비'] → '밝기·대비' */
export const fixText = (f?: string[] | null) => (f?.length ? f.join('·') : '');
