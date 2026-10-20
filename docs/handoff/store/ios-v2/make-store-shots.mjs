// 워크인 App Store 스크린샷 v2 — "기업형 홍보 + 앱 미리보기" (헤드라인 + iPhone 프레임 안 실제 화면 + 브랜드 배경)
// 생성 AI 없음: sharp + SVG 만 사용. 글자는 Pretendard(fontconfig 로 지정).
// 실행(Git Bash):
//   FONTCONFIG_FILE=C:/Users/User/Claude-Operations/artifacts/marketing/hilink-dagym-1022/fontcfg/fonts.conf \
//   node docs/handoff/store/ios-v2/make-store-shots.mjs
// 산출: docs/handoff/store/ios-v2/iphone-01..07.png (1206×2622), ipad-01..07.png (2064×2752), 00_sheet.jpg
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/User/Documents/DAGYM-DEV/dagym-workspace';
const require = createRequire(`${ROOT}/package.json`);
const sharp = require('sharp');
sharp.cache(false); sharp.concurrency(1);

const RAW = `${ROOT}/docs/handoff/store/raw`;
const BRAND = `${ROOT}/docs/handoff/brand/workin-s3`;
const OUT = `${ROOT}/docs/handoff/store/ios-v2`;
mkdirSync(OUT, { recursive: true });

const FONT = 'Pretendard';
const GREEN = '#0F766E', G1 = '#13866f', G2 = '#0b5c4e', ORANGE = '#F59E0B', LIGHT = '#F3F6F5';
const INK = '#0F172A', INK2 = '#475569';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 장별 구성: 헤드라인(줄바꿈 허용)·보조 카피·화면 파일·배경(dark=딥그린)·iPad 보조 포인트
const SLIDES = [
  { n: 1, dark: true, screen: `${RAW}/01-home.png`,
    title: ['업무도, 영업도, 마케팅도', '한 화면에서'], sub: '직원 5~30명 회사를 위한 업무 관리',
    points: ['업무·일정·결재 한 앱에', '영업 리드·거래처 관리', '마케팅 승인함', 'AI 비서 내장'] },
  { n: 2, dark: false, screen: `${RAW}/02-tasks.png`,
    title: ['말로 등록, 정확한 알림'], sub: '“내일 3시 미팅” 한마디면 끝',
    points: ['음성으로 업무 등록', '마감 알림 정확히', '담당·마감·단계 한 줄', '지연 업무 모아보기'] },
  { n: 3, dark: false, screen: `${RAW}/03-calendar.png`,
    title: ['업무 마감이', '캘린더에 그대로'], sub: '주·월 보기, 일정과 업무를 한 번에',
    points: ['주·월·목록 보기', '업무 마감 자동 표시', '미팅 일정 바로 등록', '완료 보기 전환'] },
  { n: 4, dark: true, screen: `${RAW}/11-approval-leave-3x.png`,
    title: ['검토 요청부터', '결재까지 한 흐름'], sub: '결재선 1~6단계, 휴가는 연차에 자동 반영',
    points: ['휴가·지출결의·품의', '결재선 1~6단계', '연차·반차 캘린더 자동 반영', '지출결의 엑셀 내보내기'] },
  { n: 5, dark: false, screen: `${RAW}/04-assistant.png`,
    title: ['AI 비서가 초안을,', '보내는 건 사람이'], sub: '메일·문자·견적서 시안, 회사 자료 검색',
    points: ['메일·문자 초안 작성', '견적서 시안', '회사 자료 검색·요약', '보내기는 사람이 확인'] },
  { n: 6, dark: false, screen: `${RAW}/08-mkt-home.png`,
    title: ['대행사 없이', '직접 마케팅'], sub: 'AI 시안 → 승인함 → 게시',
    points: ['AI 시안 자동 제작', '승인함에서 한 번에', '게시 일정 관리', '성과 요약 7일'] },
  { n: 7, dark: true, screen: `${RAW}/01-home.png`, logo: true,
    title: ['5명까지 무료 ·', '카드 등록 없음'], sub: 'work-in.dev 에서 바로 시작',
    points: ['5명까지 무료', '카드 등록 없음', '웹·iOS·Android 동시 사용', 'work-in.dev'] },
];

const text = (x, y, s, { size = 40, weight = 500, fill = '#fff', anchor = 'start', opacity = 1, ls = 0 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" opacity="${opacity}" letter-spacing="${ls}">${esc(s)}</text>`;

// ---------- 배경 ----------
function backgroundSvg(W, H, dark, phone) {
  const deco = dark
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${G1}"/><stop offset="1" stop-color="${G2}"/></linearGradient>
       <radialGradient id="r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.10"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
       <rect width="${W}" height="${H}" fill="url(#g)"/>
       <circle cx="${W * 0.92}" cy="${H * 0.12}" r="${W * 0.42}" fill="url(#r)"/>
       <circle cx="${W * 0.08}" cy="${H * 0.78}" r="${W * 0.36}" fill="url(#r)"/>`
    : `<defs><radialGradient id="r" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${GREEN}" stop-opacity="0.08"/><stop offset="1" stop-color="${GREEN}" stop-opacity="0"/></radialGradient></defs>
       <rect width="${W}" height="${H}" fill="${LIGHT}"/>
       <circle cx="${W * 0.9}" cy="${H * 0.16}" r="${W * 0.4}" fill="url(#r)"/>
       <circle cx="${W * 0.1}" cy="${H * 0.8}" r="${W * 0.34}" fill="url(#r)"/>`;
  // 폰 그림자
  const sh = phone ? `<defs><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${Math.round(phone.w * 0.05)}"/></filter></defs>
       <rect x="${phone.x + phone.w * 0.04}" y="${phone.y + phone.h * 0.03}" width="${phone.w * 0.92}" height="${phone.h}" rx="${phone.r}" fill="#000" opacity="${dark ? 0.45 : 0.22}" filter="url(#b)"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${deco}${sh}</svg>`;
}

// ---------- 폰 프레임(베젤·버튼·노치·상태표시줄) ----------
// 화면 폭 sw 기준: iPhone 15 (393pt) 비율로 둥근 모서리·다이내믹 아일랜드 크기를 정함
function phoneGeom(sw, imgW, imgH, x, y) {
  const k = sw / 390;
  const status = Math.round(54 * k);          // 상태표시줄 높이
  const bezel = Math.round(16 * k);
  const shH = status + Math.round(imgH * (sw / imgW));
  const rScreen = Math.round(55 * k), rFrame = rScreen + bezel;
  return { k, status, bezel, sw, sh: shH, fx: x, fy: y, fw: sw + bezel * 2, fh: shH + bezel * 2, sx: x + bezel, sy: y + bezel, rScreen, rFrame };
}

function frameBodySvg(g, W, H) {
  const btn = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="#1c1c1f"/>`;
  const k = g.k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3a3f"/><stop offset="0.5" stop-color="#18181b"/><stop offset="1" stop-color="#3a3a3f"/></linearGradient></defs>
    ${btn(g.fx - 4 * k, g.fy + 150 * k, 5 * k, 32 * k)}${btn(g.fx - 4 * k, g.fy + 210 * k, 5 * k, 62 * k)}${btn(g.fx - 4 * k, g.fy + 290 * k, 5 * k, 62 * k)}
    ${btn(g.fx + g.fw - 1 * k, g.fy + 230 * k, 5 * k, 96 * k)}
    <rect x="${g.fx}" y="${g.fy}" width="${g.fw}" height="${g.fh}" rx="${g.rFrame}" fill="url(#m)"/>
    <rect x="${g.fx + 3 * k}" y="${g.fy + 3 * k}" width="${g.fw - 6 * k}" height="${g.fh - 6 * k}" rx="${g.rFrame - 3 * k}" fill="#0b0b0d"/>
  </svg>`;
}

function statusOverlaySvg(g, W, H, dark) {
  const k = g.k, cx = g.sx + g.sw / 2, top = g.sy;
  const ink = dark ? '#fff' : '#111';
  const t = top + g.status * 0.62;
  // 다이내믹 아일랜드 + 시각 + 신호·와이파이·배터리
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect x="${cx - 63 * k}" y="${top + 11 * k}" width="${126 * k}" height="${37 * k}" rx="${18.5 * k}" fill="#000"/>
    ${text(g.sx + 42 * k, t, '9:41', { size: 17 * k, weight: 600, fill: ink })}
    <g fill="${ink}">
      <rect x="${g.sx + g.sw - 100 * k}" y="${top + 30 * k}" width="${3.2 * k}" height="${4.5 * k}" rx="1"/>
      <rect x="${g.sx + g.sw - 95 * k}" y="${top + 28 * k}" width="${3.2 * k}" height="${6.5 * k}" rx="1"/>
      <rect x="${g.sx + g.sw - 90 * k}" y="${top + 25.5 * k}" width="${3.2 * k}" height="${9 * k}" rx="1"/>
      <rect x="${g.sx + g.sw - 85 * k}" y="${top + 23 * k}" width="${3.2 * k}" height="${11.5 * k}" rx="1"/>
    </g>
    <g fill="none" stroke="${ink}" stroke-width="${1.8 * k}" stroke-linecap="round">
      <path d="M ${g.sx + g.sw - 76 * k} ${top + 27.5 * k} a ${9 * k} ${9 * k} 0 0 1 ${14 * k} 0"/>
      <path d="M ${g.sx + g.sw - 72.5 * k} ${top + 30.8 * k} a ${5 * k} ${5 * k} 0 0 1 ${7 * k} 0"/>
    </g>
    <circle cx="${g.sx + g.sw - 69 * k}" cy="${top + 34.5 * k}" r="${1.4 * k}" fill="${ink}"/>
    <rect x="${g.sx + g.sw - 56 * k}" y="${top + 23.5 * k}" width="${25 * k}" height="${12.5 * k}" rx="${3.5 * k}" fill="none" stroke="${ink}" stroke-opacity="0.4" stroke-width="${1.2 * k}"/>
    <rect x="${g.sx + g.sw - 54 * k}" y="${top + 25.5 * k}" width="${21 * k}" height="${8.5 * k}" rx="${2 * k}" fill="${ink}"/>
    <rect x="${g.sx + g.sw - 30 * k}" y="${top + 27.5 * k}" width="${1.6 * k}" height="${4.5 * k}" rx="1" fill="${ink}" fill-opacity="0.4"/>
  </svg>`;
}

// 화면 캡처 → 상태표시줄 띠를 캡처 윗줄 색으로 덧붙이고 둥근 모서리로 잘라 냄
async function screenImage(file, g) {
  const src = sharp(file);
  const meta = await src.metadata();
  const px = await sharp(file).extract({ left: 6, top: 2, width: 4, height: 4 }).raw().toBuffer();
  const bg = { r: px[0], g: px[1], b: px[2] };
  const bodyH = g.sh - g.status;
  const body = await sharp(file).resize(g.sw, bodyH, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${g.sw}" height="${g.sh}"><rect width="${g.sw}" height="${g.sh}" rx="${g.rScreen}" fill="#fff"/></svg>`);
  return sharp({ create: { width: g.sw, height: g.sh, channels: 4, background: { ...bg, alpha: 1 } } })
    .composite([{ input: body, top: g.status, left: 0 }, { input: mask, blend: 'dest-in' }])
    .png().toBuffer();
}

// 좌상단 브랜드(아이콘 + 워크인)
async function brandMark(size) {
  return sharp(`${BRAND}/icon-1024-rounded.png`).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
}

// ---------- iPhone 1206×2622 ----------
async function makeIphone(s) {
  const W = 1206, H = 2622, M = 90;
  const dark = s.dark, ink = dark ? '#fff' : INK, sub = dark ? 'rgba(255,255,255,0.85)' : INK2;
  const meta = await sharp(s.screen).metadata();
  let sw, py;
  if (s.logo) { sw = 790; py = 1010; } else { sw = 790; py = 640; }
  const g = phoneGeom(sw, meta.width, meta.height, Math.round((W - (sw + 2 * Math.round(16 * sw / 390))) / 2), py);
  const layers = [];
  layers.push({ input: Buffer.from(backgroundSvg(W, H, dark, { x: g.fx, y: g.fy, w: g.fw, h: g.fh, r: g.rFrame })), top: 0, left: 0 });
  // 브랜드
  const icon = await brandMark(72);
  layers.push({ input: icon, top: 150, left: M });
  const tl = s.title.length;
  const lines = s.title.map((t, i) => text(M, 352 + i * 98, t, { size: 82, weight: 800, fill: ink, ls: -2 })).join('');
  const subY = 352 + (tl - 1) * 98 + 92;
  const accentY = subY + 44;
  const svgTop = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    ${text(M + 92, 202, '워크인', { size: 44, weight: 700, fill: dark ? '#fff' : GREEN, ls: -1 })}
    ${lines}
    ${text(M, subY, s.sub, { size: 42, weight: 500, fill: sub, ls: -0.5 })}
    <rect x="${M}" y="${accentY}" width="96" height="10" rx="5" fill="${ORANGE}"/>
  </svg>`;
  layers.push({ input: Buffer.from(svgTop), top: 0, left: 0 });
  if (s.logo) {
    const lock = await sharp(`${BRAND}/lockup-horizontal-2400x720-dark.png`).resize(760, null, { kernel: 'lanczos3' }).png().toBuffer();
    const lm = await sharp(lock).metadata();
    layers.push({ input: lock, top: 720, left: Math.round((W - lm.width) / 2) });
  }
  layers.push({ input: Buffer.from(frameBodySvg(g, W, H)), top: 0, left: 0 });
  layers.push({ input: await screenImage(s.screen, g), top: g.sy, left: g.sx });
  layers.push({ input: Buffer.from(statusOverlaySvg(g, W, H, false)), top: 0, left: 0 });
  const out = `${OUT}/iphone-${String(s.n).padStart(2, '0')}.png`;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } }).composite(layers).png().toBuffer().then((b) => sharp(b).removeAlpha().png({ compressionLevel: 9 }).toFile(out));
  return out;
}

// ---------- iPad 2064×2752 (iPhone 프레임을 가운데, 좌우 여백에 포인트 카피) ----------
async function makeIpad(s) {
  const W = 2064, H = 2752, M = 110;
  const dark = s.dark, ink = dark ? '#fff' : INK, sub = dark ? 'rgba(255,255,255,0.85)' : INK2;
  const meta = await sharp(s.screen).metadata();
  const sw = 760, py = s.logo ? 1040 : 780;
  const g = phoneGeom(sw, meta.width, meta.height, Math.round((W - (sw + 2 * Math.round(16 * sw / 390))) / 2), py);
  const layers = [];
  layers.push({ input: Buffer.from(backgroundSvg(W, H, dark, { x: g.fx, y: g.fy, w: g.fw, h: g.fh, r: g.rFrame })), top: 0, left: 0 });
  const icon = await brandMark(84);
  layers.push({ input: icon, top: 160, left: M });
  // 헤드라인은 가운데 정렬(한 줄로 합침 — 폭이 넓어 들어감)
  const title = s.title.join(' ');
  const titleY = 420, subY = 530;
  // 포인트 카드: 좌 2·우 2
  const cardW = 420, cardH = 150, cardR = 28;
  const cardFill = dark ? 'rgba(255,255,255,0.12)' : '#ffffff', cardStroke = dark ? 'rgba(255,255,255,0.25)' : '#DCE5E2';
  const cards = s.points.map((p, i) => {
    const left = i < 2;
    const x = left ? M : W - M - cardW;
    const y = g.fy + 320 + (i % 2) * (cardH + 40);
    return `<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="${cardR}" fill="${cardFill}" stroke="${cardStroke}" stroke-width="2"/>
      <circle cx="${x + 46}" cy="${y + cardH / 2}" r="12" fill="${ORANGE}"/>
      ${text(x + 80, y + cardH / 2 + 13, p, { size: 36, weight: 600, fill: ink, ls: -0.5 })}`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    ${text(M + 106, 222, '워크인', { size: 50, weight: 700, fill: dark ? '#fff' : GREEN, ls: -1 })}
    ${text(W / 2, titleY, title, { size: 96, weight: 800, fill: ink, anchor: 'middle', ls: -2 })}
    ${text(W / 2, subY, s.sub, { size: 48, weight: 500, fill: sub, anchor: 'middle', ls: -0.5 })}
    <rect x="${W / 2 - 56}" y="${subY + 52}" width="112" height="12" rx="6" fill="${ORANGE}"/>
    ${cards}
  </svg>`;
  layers.push({ input: Buffer.from(svg), top: 0, left: 0 });
  if (s.logo) {
    const lock = await sharp(`${BRAND}/lockup-horizontal-2400x720-dark.png`).resize(900, null, { kernel: 'lanczos3' }).png().toBuffer();
    const lm = await sharp(lock).metadata();
    layers.push({ input: lock, top: 680, left: Math.round((W - lm.width) / 2) });
  }
  layers.push({ input: Buffer.from(frameBodySvg(g, W, H)), top: 0, left: 0 });
  layers.push({ input: await screenImage(s.screen, g), top: g.sy, left: g.sx });
  layers.push({ input: Buffer.from(statusOverlaySvg(g, W, H, false)), top: 0, left: 0 });
  const out = `${OUT}/ipad-${String(s.n).padStart(2, '0')}.png`;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } }).composite(layers).png().toBuffer().then((b) => sharp(b).removeAlpha().png({ compressionLevel: 9 }).toFile(out));
  return out;
}

// ---------- 축소 시트 ----------
async function makeSheet(iphone, ipad) {
  const tw = 300, gap = 20;
  const ih = Math.round(tw * 2622 / 1206), ph = Math.round(tw * 2752 / 2064);
  const W = 7 * tw + 8 * gap, H = gap * 3 + ih + ph;
  const layers = [];
  for (let i = 0; i < 7; i++) {
    layers.push({ input: await sharp(iphone[i]).resize(tw, ih).png().toBuffer(), top: gap, left: gap + i * (tw + gap) });
    layers.push({ input: await sharp(ipad[i]).resize(tw, ph).png().toBuffer(), top: gap * 2 + ih, left: gap + i * (tw + gap) });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#e5e7eb' } }).composite(layers).jpeg({ quality: 86 }).toFile(`${OUT}/00_sheet.jpg`);
}

const only = process.argv[2] ? Number(process.argv[2]) : null;
const iphone = [], ipad = [];
for (const s of SLIDES) {
  if (only && s.n !== only) continue;
  iphone.push(await makeIphone(s)); console.log('✔', iphone.at(-1));
  ipad.push(await makeIpad(s)); console.log('✔', ipad.at(-1));
}
if (!only) { await makeSheet(iphone, ipad); console.log('✔', `${OUT}/00_sheet.jpg`); }
