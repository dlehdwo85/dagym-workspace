/**
 * 398차 #1024(대표 11/13 "마케팅 영상 수준이 너무 낮습니다 — 사진이 깨져 있거나 흔들려 있고, 자막은 내용 퀄리티도 떨어지고 일찍 끊어져서 뒤에는 영상만 나오고 …
 * 무조건 실사 사용하지 않아도 된다니까요?"): 사진 영상(생성 비용 0)의 새 기준 — 대본 줄을 영상 전체 길이에, 소재 거름, 그래픽 카드, 렌더 뒤 검사.
 *
 *  · slideScript: 자막 = 영상 대본 줄(컷 줄). 예전엔 게시 글(캡션)을 문장으로 잘라 사진 수만큼만 넣어, 글이 짧으면 뒤 장면은 자막 없이 사진만 나왔음.
 *    첫 줄 = 훅(질문·상황), 가운데 = 우리 이야기·반전·비교, 마지막 = 행동 권유. 제목만 되풀이·같은 줄 반복·전화번호만 있는 첫 줄은 걸러냄.
 *  · gatePhoto: 실사는 품질을 통과한 것만 — 저해상(확대하면 깨짐)·흔들림/초점 나감·하얗게 날아감/너무 어두움은 쓰지 않음(AI 호출 없음, 서버 계산).
 *  · cardPng: 통과한 실사가 없거나 모자란 장면은 브랜드 색 그래픽 카드(도형) + 큰 글자(글자는 합성 단계 자막 엔진이 그림).
 *  · slideChecks: 렌더 뒤 자동 검사 — 자막 덮임 비율·자막 없는 구간·자막 글자 크기·끝 카드 글자 크기·대본 줄 수. 통과해야 승인함에.
 * DB 를 쓰지 않는다(mktSlideshow·mktVideo·시험이 같이 씀).
 */
export const SLIDE_GEN = 3; // 이 기준으로 만든 사진 영상 표시(result.reuse.gen) — 그 전 영상은 '옛 기준'
export const LINES_MIN = 4, LINES_MAX = 7;
export const GAP_MAX = 1.5; // 자막 없는 구간(초) — 넘으면 실패
export const COVER_MIN = 0.72; // 자막이 덮는 시간 비율(장면 겹침 구간은 글자를 두지 않으므로 1 이 되지는 않음)
export const SUB_PCT_MIN = 4.6; // 자막 글자 크기(짧은 변의 %)
export const END_PCT_MIN = 8; // 끝 카드 큰 글자(짧은 변의 %)

const ACTION = /신청|문의|상담|예약|받아|받기|받으세요|전화|방문|확인해\s?보세요|시작하세요|알아보세요|물어보세요|연락|들러/;
const PHONE = /\d{2,4}[-\s]\d{3,4}[-\s]?\d{0,4}/;
const clean = (s: string) => s.replace(/#[^\s#]+/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, '').replace(/\[[^\]]*\]/g, ' ')
  .replace(/[“”"'‘’「」『』]/g, '').replace(/^\s*(?:자막|내레이션|나레이션|대사|화면|컷\s*\d+|장면\s*\d+|#\s?\d+|\d+\s?[.)])\s*[:：.)-]?\s*/i, '').replace(/\s+/g, ' ').trim();
/** 비교용: 글자만(띄어쓰기·부호·숫자 빼고) */
const norm = (s: string) => s.replace(/[^가-힣A-Za-z]/g, '').toLowerCase();
/** 두 줄이 사실상 같은 말인가 — 한쪽이 다른 쪽을 품거나, 두 글자 묶음이 70% 넘게 겹침 */
export function sameLine(a: string, b: string): boolean {
  const x = norm(a), y = norm(b); if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 6 && l.includes(s)) return true;
  const grams = (t: string) => { const g = new Set<string>(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
  const ga = grams(x), gb = grams(y); if (ga.size < 4 || gb.size < 4) return false;
  let hit = 0; for (const g of ga) if (gb.has(g)) hit++;
  return hit / Math.min(ga.size, gb.size) >= 0.7;
}
/** 자막 한 줄 길이(세로 영상 15자 × 2줄 = 30자 안) — 넘으면 띄어쓰기에서 자름 */
const fit = (s: string, max = 30) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);
const sentences = (body: string) => clean(body.replace(/\n+/g, '. ')).split(/(?<=[.!?。…])\s+|\s*\.\s+/).map((x) => x.replace(/[.。]+$/, '').trim()).filter((x) => norm(x).length >= 4);

export type SlideScript = { lines: string[]; notes: string[]; from: 'script' | 'body' };
/**
 * 영상 자막 줄(4~7줄): 대본 줄(2줄 넘으면) 아니면 글 문장 → 훅을 맨 앞에 · 같은 말 줄 빼기 · 전화번호만 있는 줄은 맨 뒤 행동 권유로 · 마지막 = 행동 권유.
 * 줄이 모자라면(3줄 밑) lines 가 짧게 나옴 — 부르는 쪽이 영상을 보류(자막 없는 영상을 만들지 않음)
 */
export function slideScript(o: { title: string; body: string; script?: string[] | null; phone?: string | null; cta?: string | null }): SlideScript {
  const notes: string[] = [];
  const given = (o.script ?? []).map(clean).filter((x) => norm(x).length >= 3);
  const from: 'script' | 'body' = given.length >= 3 ? 'script' : 'body';
  let src = from === 'script' ? given : sentences(o.body);
  const title = clean(o.title.replace(/^\s*\[시험\]\s*/, ''));
  const phone = String(o.phone ?? '').trim();
  // 전화번호·문의뿐인 줄은 자막 가운데 두지 않음(맨 뒤 행동 권유 한 줄로 모음)
  const contactOnly = (l: string) => PHONE.test(l) && norm(l.replace(/문의|전화|상담|연락|대표번호|번호/g, '')).length < 3;
  const hadContact = src.some(contactOnly); src = src.filter((l) => !contactOnly(l));
  // 같은 말 줄 빼기(앞의 것을 남김)
  const uniq: string[] = [];
  for (const l of src) { if (uniq.some((u) => sameLine(u, l))) { notes.push('같은 말 줄을 한 번만 넣음'); continue; } uniq.push(l); }
  // 훅: 첫 줄이 질문·상황이 아니고 제목이 질문이면 제목을 맨 앞에(제목과 같은 말 줄은 그 자리에서 뺌)
  const question = (l: string) => /[?？]\s*$|까요|나요|인가요|습니까|ㄹ까|라면$|다면$/.test(l);
  let lines = uniq;
  if (title && norm(title).length >= 4) {
    const dupIdx = lines.findIndex((l) => sameLine(l, title));
    if (dupIdx > 0) { lines = [lines[dupIdx], ...lines.slice(0, dupIdx), ...lines.slice(dupIdx + 1)]; }
    else if (dupIdx < 0 && (!lines[0] || (!question(lines[0]) && question(title)) || lines.length < LINES_MIN)) lines = [title, ...lines];
    // 제목을 되풀이하는 뒤 줄은 뺌(첫 줄만 남김)
    lines = lines.filter((l, k) => k === 0 || !sameLine(l, title));
  }
  // 마지막 = 행동 권유(없으면 붙임 — 전화가 있으면 번호로)
  const cta = clean(String(o.cta ?? ''));
  // 전화·브랜드 권유 문구가 없으면 지어내지 않고 채널 공통 권유(프로필)로
  const closing = phone ? `지금 문의하세요 ${phone}` : cta && !/^https?:|\.(kr|com|net|io|dev)\b/i.test(cta) && ACTION.test(cta) ? cta : '자세한 내용은 프로필에서 확인해 보세요';
  const last = lines[lines.length - 1] ?? '';
  if (closing && (!ACTION.test(last) || hadContact) && !sameLine(last, closing)) lines = [...lines.filter((l) => !sameLine(l, closing)), closing];
  // 줄 수 맞추기: 많으면 훅·끝을 지키고 가운데를 줄임
  if (lines.length > LINES_MAX) { notes.push(`대본 ${lines.length}줄 → ${LINES_MAX}줄(가운데 줄 줄임)`); lines = [...lines.slice(0, LINES_MAX - 1), lines[lines.length - 1]]; }
  return { lines: lines.map((l) => fit(l)), notes: [...new Set(notes)], from };
}

/** 대본 품질(숏폼 틀: 질문·상황 → 우리 이야기 → 반전·비교 → 권유) — 문제 줄 목록(비어 있으면 통과) */
export function scriptIssues(lines: string[], title: string): string[] {
  const out: string[] = [];
  if (lines.length < LINES_MIN) out.push(`대본이 ${lines.length}줄뿐(${LINES_MIN}줄 넘게 — 훅·우리 이야기·반전/비교·권유)`);
  const t = clean(title);
  const rep = lines.filter((l) => sameLine(l, t)).length;
  if (rep > 1) out.push('제목 문장을 되풀이함');
  if (lines.length && !ACTION.test(lines[lines.length - 1])) out.push('마지막 줄에 행동 권유(문의·상담·신청)가 없음');
  if (lines[0] && PHONE.test(lines[0])) out.push('첫 줄(0~3초)이 전화번호 — 훅 문장이 없음');
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) if (sameLine(lines[i], lines[j])) { out.push(`${i + 1}·${j + 1}번째 줄이 같은 말`); i = lines.length; break; }
  return out;
}

/** 줄 길이에 맞춘 장면 길이(초): 읽는 시간(분당 300음절) + 여유, 2.2~4초 · 첫 줄(훅)은 3초 안 */
export function sceneSeconds(line: string, k: number): number {
  const syl = (line.match(/[가-힣]/g) ?? []).length + (line.match(/\d/g) ?? []).length * 1.2 + (line.match(/[A-Za-z]+/g) ?? []).length * 2;
  const s = Math.round((syl / 5 + 1.1) * 10) / 10;
  return Math.max(2.2, Math.min(k === 0 ? 3 : 4, s));
}

export type PhotoGate = { ok: boolean; why: string | null; mode: 'cover' | 'contain'; w: number; h: number; scale: number; sharp: number | null; mean: number; hi: number };
/**
 * 실사 한 장 품질: ① 확대 배율(화면을 채우려면 늘려야 하는 배수 — 1.3 넘으면 깨져 보임) ② 선명도(가장 또렷한 칸 — 흔들림·초점 나감) ③ 노출(하얗게 날아간 넓이·너무 어두움).
 * 화면보다 많이 넓은 사진(가로 사진을 세로 영상에)은 잘라 채우면 가운데만 크게 확대됨 → 'contain'(사진 전체를 보이고 뒤는 흐린 같은 사진).
 */
export async function gatePhoto(buf: Buffer, d: { w: number; h: number }, o: { sharpMin?: number } = {}): Promise<PhotoGate> {
  const sharp = (await import('sharp')).default;
  const bad = (why: string, x: Partial<PhotoGate> = {}): PhotoGate => ({ ok: false, why, mode: 'cover', w: 0, h: 0, scale: 0, sharp: null, mean: 0, hi: 0, ...x });
  let meta; try { meta = await sharp(buf, { failOn: 'none', limitInputPixels: 80e6 }).metadata(); } catch { return bad('사진을 읽지 못함'); }
  const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height ?? 0, meta.width ?? 0] : [meta.width ?? 0, meta.height ?? 0];
  if (!w || !h) return bad('사진을 읽지 못함');
  const ar = w / h, far = d.w / d.h;
  // 잘라 채우면 사진의 55% 밑만 남거나(가로 사진 → 세로 영상 등) 화면을 채우려고 1.35배 넘게 늘려야 하면(작은 사진) 전체를 보이게(contain — 가로 94%·세로 60% 안)
  const kept = ar > far ? far / ar : ar / far;
  const PAN = 1.1; // video/compose 의 사진 움직임 여유와 같은 값
  const coverScale = Math.max((d.w * PAN) / w, (d.h * PAN) / h), containScale = Math.min((d.w * 0.94) / w, (d.h * 0.6) / h);
  const mode: 'cover' | 'contain' = kept < 0.55 || coverScale > 1.35 ? 'contain' : 'cover';
  const scale = mode === 'cover' ? coverScale : containScale; // 늘려야 하는 배수
  const { data, info } = await sharp(buf, { failOn: 'none', limitInputPixels: 80e6 }).rotate().greyscale().resize(256, 256, { fit: 'inside', withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
  let sum = 0, hiN = 0; const n = info.width * info.height;
  for (let i = 0; i < n; i++) { const v = data[i * info.channels]; sum += v; if (v >= 247) hiN++; }
  const mean = Math.round(sum / n); const hi = Math.round((hiN / n) * 100);
  const st = await import('../mktPhotos').then((m) => m.sharpnessStats(buf)).catch(() => null);
  const g = { mode, w, h, scale: Math.round(scale * 100) / 100, sharp: st ? Math.round(st.max) : null, mean, hi };
  if (scale > 1.25) return bad(`저해상(${w}×${h} — ${g.scale}배 늘려야 해 깨져 보임)`, g);
  if (st && st.max < (o.sharpMin ?? 40)) return bad('흔들림·초점 나감', g);
  if (hi >= 28) return bad(`하얗게 날아간 부분이 넓음(${hi}%)`, g);
  if (mean < 38) return bad('너무 어두움', g);
  return { ok: true, why: null, ...g };
}

const hex = (c: string) => /^#?([0-9a-f]{6})$/i.exec(c)?.[1] ?? '0F766E';
const mix = (c: string, t: number, to: number) => { const h = hex(c); const p = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return `#${p.map((v) => Math.round(v + (to - v) * t).toString(16).padStart(2, '0')).join('')}`; };
/** 브랜드 색 그래픽 카드(글자 없음 — 글자는 자막 엔진이): 위에서 아래로 짙어지는 바탕 + 큰 원·띠 도형. k 로 장면마다 배치를 바꿈. 화면 캡처 장면의 배경으로도 씀 */
export async function cardPng(d: { w: number; h: number }, color: string, k = 0): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const c0 = mix(color, 0.12, 255), c1 = mix(color, 0.45, 0), soft = mix(color, 0.55, 255), deep = mix(color, 0.62, 0);
  const W = d.w, H = d.h, m = Math.min(W, H); const v = k % 4;
  const shapes = [
    `<circle cx="${W * 0.86}" cy="${H * 0.14}" r="${m * 0.34}" fill="${soft}" opacity="0.22"/><circle cx="${W * 0.1}" cy="${H * 0.9}" r="${m * 0.42}" fill="${deep}" opacity="0.5"/><rect x="${W * 0.08}" y="${H * 0.3}" width="${m * 0.14}" height="${m * 0.018}" rx="${m * 0.009}" fill="#ffffff" opacity="0.9"/>`,
    `<circle cx="${W * 0.12}" cy="${H * 0.12}" r="${m * 0.3}" fill="${deep}" opacity="0.45"/><circle cx="${W * 0.92}" cy="${H * 0.82}" r="${m * 0.38}" fill="${soft}" opacity="0.2"/><rect x="${W * 0.78}" y="${H * 0.68}" width="${m * 0.14}" height="${m * 0.018}" rx="${m * 0.009}" fill="#ffffff" opacity="0.9"/>`,
    `<rect x="${-W * 0.2}" y="${H * 0.7}" width="${W * 1.4}" height="${H * 0.5}" transform="rotate(-8 ${W / 2} ${H * 0.8})" fill="${deep}" opacity="0.5"/><circle cx="${W * 0.8}" cy="${H * 0.2}" r="${m * 0.22}" fill="${soft}" opacity="0.2"/>`,
    `<rect x="${-W * 0.2}" y="${-H * 0.2}" width="${W * 1.4}" height="${H * 0.42}" transform="rotate(7 ${W / 2} ${H * 0.1})" fill="${deep}" opacity="0.45"/><circle cx="${W * 0.18}" cy="${H * 0.8}" r="${m * 0.26}" fill="${soft}" opacity="0.2"/>`,
  ][v];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>${shapes}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export type SlideChecks = { lines: number; cover: number | null; maxGap: number | null; subPct: number | null; endPct: number | null; photos: number; cards: number; screens: number; fails: string[] };
/** 렌더 뒤 자동 검사 — fails 가 비어야 승인함에 올림 */
export function slideChecks(o: { lines: string[]; title: string; cover: number | null; maxGap: number | null; subPct: number | null; endPct: number | null; photos: number; cards: number; screens: number }): SlideChecks {
  const fails = [...scriptIssues(o.lines, o.title)];
  if (o.maxGap !== null && o.maxGap > GAP_MAX) fails.push(`자막 없는 구간 ${o.maxGap}초(${GAP_MAX}초 넘음)`);
  if (o.cover !== null && o.cover < COVER_MIN) fails.push(`자막이 영상의 ${Math.round(o.cover * 100)}%만 덮음(${Math.round(COVER_MIN * 100)}% 넘게)`);
  if (o.subPct !== null && o.subPct < SUB_PCT_MIN) fails.push(`자막 글자가 작음(짧은 변의 ${o.subPct}%)`);
  if (o.endPct !== null && o.endPct < END_PCT_MIN) fails.push(`끝 카드 글자가 작음(짧은 변의 ${o.endPct}%)`);
  return { lines: o.lines.length, cover: o.cover, maxGap: o.maxGap, subPct: o.subPct, endPct: o.endPct, photos: o.photos, cards: o.cards, screens: o.screens, fails };
}
