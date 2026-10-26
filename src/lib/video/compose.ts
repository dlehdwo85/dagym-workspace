import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ffmpegOk, mediaInfo } from './ffmpeg';

/**
 * #454 장면 클립 → 한 편의 광고 영상(서버 ffmpeg).
 * 장면마다 화면 규격으로 맞춤(잘라 채움·30fps) → 실제 화면 장면은 배경을 흐리게 하고 휴대폰·노트북 틀에 캡처를 얹음 → 장면 사이 0.4초 겹쳐 넘김 →
 * 끝 화면(브랜드 색·로고·한 줄·CTA) → 한국어 자막(브랜드 글꼴, 인스타·쇼츠 버튼에 안 가리는 안전 영역, 장면 시각) →
 * 소리: 장면별 내레이션 + 배경음(내레이션 있으면 작게) → 음량 정규화(-14 LUFS) → H.264/AAC mp4(faststart).
 */
export type Dim = { w: number; h: number };
export const DIMS: Record<string, Dim> = { '9:16': { w: 1080, h: 1920 }, '16:9': { w: 1920, h: 1080 }, '1:1': { w: 1080, h: 1080 }, '4:5': { w: 1080, h: 1350 } };
export const dimOf = (aspect: string) => DIMS[aspect] ?? DIMS['9:16'];
export const XFADE = 0.4; // 장면 사이
export const END_XFADE = 0.5; // 끝 화면 들어갈 때

/** 화면 비율별 자막 틀: 글자 크기·한 줄 글자 수·아래 여백(세로 영상은 아래 24% = 인스타·쇼츠 설명·버튼 자리 피함) */
function subBox(d: Dim) {
  if (d.h > d.w) return { size: Math.round(d.w * 0.056), perLine: 15, marginV: Math.round(d.h * 0.24), marginH: Math.round(d.w * 0.08) };
  if (d.w > d.h) return { size: Math.round(d.h * 0.052), perLine: 26, marginV: Math.round(d.h * 0.08), marginH: Math.round(d.w * 0.1) };
  return { size: Math.round(d.w * 0.054), perLine: 16, marginV: Math.round(d.h * 0.1), marginH: Math.round(d.w * 0.09) };
}
const PUNCT = /[?!.,…·~:;)\]}」』>%？！。，、]/;
/** 한국어 줄바꿈: 두 줄에 들어가면 두 줄 길이가 비슷한 띄어쓰기에서 나누고, 아니면 띄어쓰기 단위로 채운다(한 단어가 줄보다 길면 자름) */
export function wrapKo(text: string, max: number): string[] {
  const t = text.replace(/\s+/g, ' ').trim(); const words = t.split(' ').filter(Boolean);
  if (t.length <= max) return t ? [t] : [];
  let best: { lines: string[]; score: number } | null = null;
  for (let i = 1; i < words.length; i++) { // 한 글자 낱말('할 일')에서 끊지 않게 — 그 대신 한 글자 넘치는 줄은 허용
    const a = words.slice(0, i).join(' '); const b = words.slice(i).join(' '); const long = Math.max(a.length, b.length);
    const score = long + Math.max(0, long - max) + (words[i - 1].length === 1 ? 4 : 0);
    if (long <= max + 1 && (!best || score < best.score)) best = { lines: [a, b], score }; }
  if (best) return best.lines;
  const lines: string[] = []; let cur = '';
  for (let w of words) {
    while (w.length > max) { // 줄보다 긴 낱말은 자르되 문장부호('?'·'!'…)는 앞 글자에 붙인다(로컬 10/24 08:40 — 부호만 혼자 다음 줄로 가지 않게)
      if (cur) { lines.push(cur); cur = ''; }
      let cut = max; while (cut < w.length && PUNCT.test(w[cut])) cut++;
      lines.push(w.slice(0, cut)); w = w.slice(cut);
    }
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
/** 두 줄이 넘으면 글자를 줄여 세 줄까지(그 이상은 장면 대사를 줄여야 함 — notes 에 남김) */
function fitLines(text: string, perLine: number, size: number): { lines: string[]; size: number; over: boolean } {
  let lines = wrapKo(text, perLine);
  if (lines.length <= 2) return { lines, size, over: false };
  lines = wrapKo(text, Math.round(perLine * 1.18));
  return { lines: lines.slice(0, 3), size: Math.round(size * 0.85), over: lines.length > 3 };
}
const assTime = (s: number) => { const t = Math.max(0, s); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const sec = t % 60; return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`; };
const assText = (s: string) => s.replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ');
/** #RRGGBB → ASS &HAABBGGRR */
const assColor = (hex: string, alpha = 0) => { const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? 'FFFFFF'; return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase(); };
export const isLight = (hex: string) => { const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1]; if (!h) return false; const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62; };

export function buildAss(o: { dim: Dim; font: string; subs: { start: number; end: number; text: string }[]; end?: { start: number; end: number; headline: string; cta: string; logo: boolean; color: string } }) {
  const b = subBox(o.dim); const notes: string[] = [];
  const ink = o.end && isLight(o.end.color) ? '#161616' : '#FFFFFF';
  const head = Math.round(Math.min(o.dim.w, o.dim.h) * 0.068); const cta = Math.round(Math.min(o.dim.w, o.dim.h) * 0.044);
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${o.dim.w}`, `PlayResY: ${o.dim.h}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Sub,${o.font},${b.size},&H00FFFFFF,&H00FFFFFF,&H00141414,&H8C000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(b.size / 18))},${Math.max(1, Math.round(b.size / 30))},2,${b.marginH},${b.marginH},${b.marginV},1`,
    `Style: Head,${o.font},${head},${assColor(ink)},${assColor(ink)},&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,${b.marginH},${b.marginH},0,1`,
    `Style: Cta,${o.font},${cta},${assColor(ink)},${assColor(ink)},&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,${b.marginH},${b.marginH},0,1`, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  o.subs.forEach((s, k) => {
    if (!s.text.trim() || s.end - s.start < 0.4) return;
    const f = fitLines(assText(s.text), b.perLine, b.size);
    if (f.over) notes.push(`장면 ${k + 1} 자막이 길어 세 줄까지만 넣었습니다`);
    lines.push(`Dialogue: 0,${assTime(s.start)},${assTime(s.end)},Sub,,0,0,0,,{\\fad(120,120)${f.size !== b.size ? `\\fs${f.size}` : ''}}${f.lines.join('\\N')}`);
  });
  if (o.end) {
    const cx = Math.round(o.dim.w / 2); const y0 = Math.round(o.dim.h * (o.end.logo ? 0.6 : 0.47));
    const hl = wrapKo(assText(o.end.headline), o.dim.h > o.dim.w ? 12 : 22).slice(0, 2);
    if (hl.length) lines.push(`Dialogue: 1,${assTime(o.end.start + 0.25)},${assTime(o.end.end)},Head,,0,0,0,,{\\pos(${cx},${y0})\\fad(250,0)}${hl.join('\\N')}`);
    if (o.end.cta.trim()) lines.push(`Dialogue: 1,${assTime(o.end.start + 0.45)},${assTime(o.end.end)},Cta,,0,0,0,,{\\pos(${cx},${y0 + Math.round(head * (hl.length > 1 ? 1.9 : 1.25) + cta)})\\fad(250,0)}${assText(o.end.cta)}`);
  }
  return { ass: lines.join('\n') + '\n', notes };
}

let sharpMod: any;
async function sharp() { sharpMod ??= (await import('sharp')).default; return sharpMod; }
const roundRect = (w: number, h: number, r: number, fill: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"/></svg>`);
/** 실제 화면 캡처를 휴대폰·노트북 틀에 넣은 투명 PNG(그림자 포함) — 생성 영상 위에 얹는다(AI 가 화면 글자를 그리지 않게) */
export async function deviceMock(capture: Buffer, device: 'phone' | 'laptop', d: Dim): Promise<Buffer> {
  const S = await sharp(); const vertical = d.h > d.w;
  if (device === 'phone') {
    const w = Math.round(d.w * (vertical ? 0.46 : 0.26)); const h = Math.round(w * 2.04); const bz = Math.round(w * 0.035); const r = Math.round(w * 0.13);
    const sw = w - bz * 2; const sh = h - bz * 2; const sr = r - bz;
    const screen = await S(await S(capture).resize(sw, sh, { fit: 'cover', position: 'top' }).png().toBuffer()).composite([{ input: roundRect(sw, sh, sr, '#fff'), blend: 'dest-in' }]).png().toBuffer();
    const pad = Math.round(w * 0.12);
    const shadow = await S(roundRect(w, h, r, 'rgba(0,0,0,0.45)')).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).blur(Math.max(1, pad / 3)).png().toBuffer();
    return S(shadow).composite([{ input: roundRect(w, h, r, '#0d0d0f'), top: pad - Math.round(pad * 0.25), left: pad }, { input: screen, top: pad - Math.round(pad * 0.25) + bz, left: pad + bz }]).png().toBuffer();
  }
  const w = Math.round(d.w * (vertical ? 0.88 : 0.62)); const lidH = Math.round(w * 0.64); const bz = Math.round(w * 0.022); const r = Math.round(w * 0.025);
  const sw = w - bz * 2; const sh = lidH - bz * 2 - Math.round(w * 0.012);
  const screen = await S(await S(capture).resize(sw, sh, { fit: 'cover', position: 'top' }).png().toBuffer()).composite([{ input: roundRect(sw, sh, Math.round(r * 0.4), '#fff'), blend: 'dest-in' }]).png().toBuffer();
  const baseW = Math.round(w * 1.12); const baseH = Math.round(w * 0.04); const pad = Math.round(w * 0.06);
  const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${baseW}" height="${baseH}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9dce1"/><stop offset="1" stop-color="#9ea3ab"/></linearGradient></defs>
    <path d="M0 0 H${baseW} V${baseH * 0.55} Q${baseW} ${baseH} ${baseW - baseH} ${baseH} H${baseH} Q0 ${baseH} 0 ${baseH * 0.55} Z" fill="url(#g)"/><rect x="${baseW / 2 - baseW * 0.08}" y="0" width="${baseW * 0.16}" height="${baseH * 0.35}" rx="${baseH * 0.2}" fill="#8d9199"/></svg>`);
  const cw = baseW + pad * 2; const ch = lidH + baseH + pad * 2; const left = pad + Math.round((baseW - w) / 2);
  const shadow = await S(roundRect(baseW, lidH + baseH, r, 'rgba(0,0,0,0.4)')).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } }).blur(Math.max(1, pad / 3)).png().toBuffer();
  return S({ create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shadow, top: Math.round(pad * 0.2), left: 0 }, { input: roundRect(w, lidH, r, '#1c1c1f'), top: pad, left }, { input: screen, top: pad + bz, left: left + bz }, { input: base, top: pad + lidH, left: pad }]).png().toBuffer();
}
/** 끝 화면 로고: 가로 38% 안에 맞춘 PNG */
export async function logoPng(logo: Buffer, d: Dim): Promise<Buffer> {
  const S = await sharp(); const box = Math.round(Math.min(d.w, d.h) * 0.42);
  return S(logo).resize(box, Math.round(box * 0.6), { fit: 'inside', withoutEnlargement: false }).png().toBuffer();
}

/** start = 원본 파일에서 이 장면이 시작하는 초(187차 ⑦ 한 편짜리 영상을 장면으로 나눠 다시 합성) */
export type ComposeScene = { file: string; seconds: number; line: string; screenPng?: string | null; start?: number };
export type ComposeInput = { dir: string; aspect: string; scenes: ComposeScene[]; end: { seconds: number; color: string; headline: string; cta: string; logoPng?: string | null };
  narration: ({ file: string; duration: number } | null)[]; bgm?: { file: string } | null; font: { dir: string; family: string }; out: string };

/** 한 편 합성 → { 파일, 길이, 알림 } */
export async function composeVideo(o: ComposeInput): Promise<{ file: string; duration: number; notes: string[] }> {
  const d = dimOf(o.aspect); const notes: string[] = []; const args: string[] = []; const f: string[] = []; let idx = 0;
  const durs: number[] = [];
  const infos = new Map<string, Awaited<ReturnType<typeof mediaInfo>>>(); // 같은 원본을 여러 장면이 나눠 쓰면 한 번만 읽음
  for (const s of o.scenes) {
    let info = infos.get(s.file); if (!info) { info = await mediaInfo(join(o.dir, s.file)); infos.set(s.file, info); }
    const st = Math.max(0, s.start ?? 0);
    durs.push(Math.max(1.2, Math.min(s.seconds, (info.duration ?? st + s.seconds) - st)));
  }
  // 장면 입력(원본 중간부터 쓰는 장면은 그 초로 건너뛰어 읽음)
  const sceneIn = o.scenes.map((s) => { if (s.start && s.start > 0) args.push('-ss', s.start.toFixed(3)); args.push('-i', s.file); return idx++; });
  const devIn = o.scenes.map((s, k) => { if (!s.screenPng) return -1; args.push('-loop', '1', '-framerate', '30', '-t', String(durs[k] + 0.5), '-i', s.screenPng); return idx++; });
  const E = o.end.seconds; const endIn = idx++; args.push('-f', 'lavfi', '-i', `color=c=0x${(/^#?([0-9a-f]{6})$/i.exec(o.end.color)?.[1] ?? '111111')}:s=${d.w}x${d.h}:r=30:d=${E + 0.5}`);
  const logoIn = o.end.logoPng ? (args.push('-loop', '1', '-framerate', '30', '-t', String(E + 0.5), '-i', o.end.logoPng), idx++) : -1;
  const fit = `scale=${d.w}:${d.h}:force_original_aspect_ratio=increase,crop=${d.w}:${d.h},fps=30,setsar=1`;
  o.scenes.forEach((s, k) => {
    const base = `[${sceneIn[k]}:v]${fit},tpad=stop_mode=clone:stop_duration=3,trim=duration=${durs[k].toFixed(3)},setpts=PTS-STARTPTS`;
    if (devIn[k] < 0) { f.push(`${base},format=yuv420p,fps=30[s${k}]`); return; }
    f.push(`${base},gblur=sigma=26,eq=brightness=-0.07:saturation=0.85,format=yuv420p[bg${k}]`);
    f.push(`[${devIn[k]}:v]format=rgba,fade=t=in:st=0:d=0.35:alpha=1[dv${k}]`);
    f.push(`[bg${k}][dv${k}]overlay=x=(W-w)/2:y=(H-h)/2-${d.h > d.w ? Math.round(d.h * 0.07) : 0}+${Math.round(d.h * 0.025)}*(1-min(t/0.55\\,1)):shortest=1,format=yuv420p,fps=30[s${k}]`);
  });
  f.push(logoIn >= 0 ? `[${endIn}:v]format=yuv420p,setsar=1[eb];[eb][${logoIn}:v]overlay=x=(W-w)/2:y=H*0.4-h/2:shortest=1,format=yuv420p,fps=30,trim=duration=${(E + 0.2).toFixed(2)}[end]`
    : `[${endIn}:v]format=yuv420p,setsar=1,fps=30,trim=duration=${(E + 0.2).toFixed(2)}[end]`);
  // 장면 이어 붙이기(겹쳐 넘김) → 끝 화면
  const starts: number[] = [0]; let acc = durs[0]; let cur = 's0';
  for (let k = 1; k < durs.length; k++) { const off = acc - XFADE; starts.push(off); f.push(`[${cur}][s${k}]xfade=transition=fade:duration=${XFADE}:offset=${off.toFixed(3)}[x${k}]`); cur = `x${k}`; acc = off + durs[k]; }
  const endStart = acc - END_XFADE; const total = endStart + E;
  f.push(`[${cur}][end]xfade=transition=fade:duration=${END_XFADE}:offset=${endStart.toFixed(3)},trim=duration=${total.toFixed(3)}[xv]`);
  // 자막 + 끝 화면 글자(ASS)
  const subs = o.scenes.map((s, k) => ({ start: starts[k] + (k ? XFADE / 2 : 0.15), end: starts[k] + durs[k] - (k === durs.length - 1 ? END_XFADE : XFADE) / 2 - 0.05, text: s.line }));
  const a = buildAss({ dim: d, font: o.font.family, subs, end: { start: endStart, end: total, headline: o.end.headline, cta: o.end.cta, logo: logoIn >= 0, color: o.end.color } });
  notes.push(...a.notes);
  await writeFile(join(o.dir, 'subs.ass'), a.ass);
  f.push(`[xv]ass=subs.ass:fontsdir=${o.font.dir}[vout]`);
  // 소리: 장면별 내레이션(장면 시작 + 0.2초) + 배경음 → 음량 정규화
  const mix: string[] = [];
  o.narration.forEach((n, k) => {
    if (!n) return; const i = idx++; args.push('-i', n.file);
    const room = Math.max(0.8, durs[k] - 0.35); let tempo = 1;
    if (n.duration > room) { tempo = Math.min(1.25, n.duration / room); if (n.duration / tempo > room + 0.3) notes.push(`장면 ${k + 1} 내레이션이 장면보다 깁니다(${n.duration.toFixed(1)}초 / ${durs[k].toFixed(1)}초) — 대사를 줄이면 좋습니다`); }
    f.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo${tempo > 1.001 ? `,atempo=${tempo.toFixed(3)}` : ''},adelay=delays=${Math.round((starts[k] + 0.2) * 1000)}:all=1[n${k}]`); mix.push(`[n${k}]`);
  });
  if (o.bgm) {
    const i = idx++; args.push('-stream_loop', '-1', '-i', o.bgm.file);
    f.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0, total - 1.6).toFixed(2)}:d=1.6,volume=${mix.length ? 0.2 : 0.7}[bgm]`); mix.push('[bgm]');
  }
  if (mix.length) f.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:dropout_transition=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100,apad,atrim=0:${total.toFixed(3)}[aout]`);
  else { const i = idx++; args.push('-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`); f.push(`[${i}:a]atrim=0:${total.toFixed(3)}[aout]`); }
  await writeFile(join(o.dir, 'graph.txt'), f.join(';\n'));
  await ffmpegOk([...args, '-/filter_complex', 'graph.txt', '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', '-movflags', '+faststart', '-t', total.toFixed(3), o.out], { cwd: o.dir, timeoutMs: 250_000 });
  const info = await mediaInfo(join(o.dir, o.out));
  return { file: o.out, duration: info.duration ?? total, notes };
}
