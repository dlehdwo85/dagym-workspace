// #510(대표 10/23 17:30 "메일 내용 정리 수준은 21라인을 레퍼런스"): 당일 공고 메일 — HTML 표(메일 앱 호환: 인라인 스타일·폭 680px·휴대폰은 한 칸으로 줄바꿈) + 같은 내용의 텍스트판.
// 머리 요약(건수·받은 기간·사업별 건수·[오늘 공고 전체 보기]·[맞춤 설정]) → 맞춤 조건 상자 → 구역 ★ 즉시 검토 → 검토 → 마감 임박 → 정정·취소 → 결과(낙찰·유찰, 새 공고 수 밖) → 참고(건수 + [보기]만) → 걸러진 공고.
// 줄 = 1행 배지·공고명(워크인 상세)·사업 배지 / 2행 발주처·지역·금액(기초금액·추정가격·배정예산)·지역 제한(본사 기준 참가 가능/불가)·업종 /
// 3행 일정(현장설명 → 참가신청마감 → 입찰마감 D-day → 개찰) / 4행 이 회사 진행(상태·담당)·첨부·투찰처·출처 공고번호·[원문]. 번호는 구역마다 1부터, 값이 없으면 칸째 숨김.
// 215차(#530 로컬 10/24 21라인 대조 ①~⑨): 받은 기간·맞춤 조건 상자·금액 나눔·참가 가능·일정 줄·배지 확대·구역 안 사업별 묶음(두 묶음 이상일 때 머리·건수)·진행·담당.
import type { DigestCond, DigestItem, DigestSection } from './digest';
import type { RegionLimit } from './region';
import { sidoIn } from './region';

type Digest = { day: string; since?: string; until?: string; cond?: DigestCond; items: DigestItem[]; counts: { total: number; new: number; now: number; review: number; soon: number; result?: number; ref: number; amend: number; cancel: number; merged: number; skipped: Record<string, number> } };

const WD = ['일', '월', '화', '수', '목', '금', '토'];
/** 'YYYY-MM-DD' → '10/24(금)' */
export const mdw = (d: string) => { const [y, m, dd] = d.slice(0, 10).split('-').map(Number); return `${m}/${dd}(${WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]})`; };
/** 'YYYY-MM-DD HH:MM' 또는 'YYYY-MM-DD' → '10/28(화) 17:00' */
const whenLabel = (v: string | null) => (v ? `${mdw(v)}${v.length > 10 ? ` ${v.slice(11, 16)}` : ''}` : null);
const seenLabel = (v: string | null | undefined) => { if (!v) return ''; const d = new Date(v); if (Number.isNaN(d.getTime())) return ''; return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const http = (u: string) => (/^https?:\/\//i.test(u) ? u : null);
/** 사업 배지 바탕색: 사업 색을 흰색에 88% 섞은 연한 색(메일 앱은 반투명 색을 못 그리는 곳이 있어 섞은 값으로) */
const tint = (hex: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return '#EFF6FF'; const n = parseInt(m[1], 16); const mix = (c: number) => Math.round(c + (255 - c) * 0.88); return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`; };
const C = { ink: '#111827', ink2: '#374151', ink3: '#6B7280', line: '#E5E7EB', bg: '#F3F4F6', brand: '#2563EB', brandInk: '#1D4ED8', soft: '#EFF6FF' };
const BADGE: Record<string, [string, string]> = { 취소: ['#374151', '#E5E7EB'], 정정: ['#B45309', '#FEF3C7'], 긴급: ['#B91C1C', '#FEE2E2'], 재공고: ['#6D28D9', '#EDE9FE'], 재게시: ['#6D28D9', '#EDE9FE'],
  수의계약: ['#1D4ED8', '#DBEAFE'], 견적: ['#3730A3', '#E0E7FF'], 현장설명: ['#0E7490', '#CFFAFE'], '현장설명 필수': ['#B45309', '#FEF3C7'], 낙찰: ['#047857', '#D1FAE5'], 유찰: ['#4B5563', '#F3F4F6'],
  '면허 업체 협력 필요': ['#92400E', '#FFEDD5'] }; // #752
const kstDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
/** ISO → '10/26(월) 08:00'(서울) */
const stamp = (iso: string | undefined) => { if (!iso) return null; const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : `${mdw(kstDay(d))} ${seenLabel(iso)}`; };
const won = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1).replace(/\.0$/, '')}억` : n >= 1e4 ? `${Math.round(n / 1e4).toLocaleString('ko-KR')}만원` : `${n.toLocaleString('ko-KR')}원`);
/** #530 ①: 받은 기간 — 지난 메일 뒤(digestSince) ~ 이 메일을 만든 때 */
const periodLine = (d: Digest) => { const a = stamp(d.since), b = stamp(d.until); return a && b ? `받은 기간 ${a} ~ ${b}` : null; };
/** #530 ②: 맞춤 조건 상자 — 관심 사업·검색어 수·제외어 수·지역·발주처·물품 코드·금액·본사 */
const condParts = (c: DigestCond) => [c.biz.length ? `관심 사업 ${c.biz.join('·')}` : null, `관심 검색어 ${c.keywords}개`, `제외어 ${c.excludes}개`, c.regions.length ? `지역 ${c.regions.join('·')}` : '지역 전국',
  c.issuers ? `관심 발주처 ${c.issuers}곳` : null, c.itemCodes ? `물품·업종 코드 ${c.itemCodes}개` : null,
  c.amountMin && c.amountMax ? `추정가격 ${won(c.amountMin)}~${won(c.amountMax)}` : c.amountMin ? `추정가격 ${won(c.amountMin)} 이상` : c.amountMax ? `추정가격 ${won(c.amountMax)} 이하` : '금액 제한 없음',
  c.hq ? `본사 ${c.hq}` : null].filter((x): x is string => !!x);
/** #530 ④: 지역 제한 + 본사 기준 참가 가능/불가(21라인에 없는 것) */
const limitText = (l: RegionLimit, hq: string | null) => (l.ok === true ? `지역 제한 ${l.label} — 참가 가능` : l.ok === false ? `지역 제한 ${l.label} — 참가 불가${hq ? `(본사 ${hq})` : ''}` : `지역 제한 ${l.label}${hq ? ' — 참가 가능 여부 확인' : ''}`);
const limitColor = (l: RegionLimit) => (l.ok === true ? '#047857' : l.ok === false ? '#B91C1C' : C.ink2);
/** #530 ⑧: 구역 안 사업별 묶음(다짐 / 하이링크 / 둘 다 …) — 관심 사업 설정 순서, 여러 사업은 뒤, 사업 없음은 맨 뒤 */
const bizName = (i: DigestItem) => i.biz.map((b) => b.name).join('·');
function grouped(list: DigestItem[], order: string[]): DigestItem[][] {
  const m = new Map<string, DigestItem[]>();
  for (const i of list) { const k = i.biz.map((b) => b.name).join('\n'); const g = m.get(k); if (g) g.push(i); else m.set(k, [i]); }
  const rank = (k: string) => { if (!k) return 1e6; const n = k.split('\n'); return n.length === 1 ? order.indexOf(n[0]) + 1 || 999 : 1000 + n.length; };
  return [...m.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([, v]) => v);
}
const FONT = "-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif";
// 대표 10/24 추가 ③: 입찰 준비 기간 D-4~D-10 = 주황 '준비 시작'(입찰 화면 카드와 같은 기준), D-3 안 = 빨강
const ddText = (n: number) => (n === 0 ? 'D-day' : n >= 4 && n <= 10 ? `D-${n} · 준비 시작` : `D-${n}`);
const ddColor = (n: number) => (n <= 3 ? '#DC2626' : n <= 10 ? '#D97706' : C.ink2);

export const SECTIONS: { key: Exclude<DigestSection, 'ref'>; title: string; sub: string }[] = [
  { key: 'now', title: '★ 즉시 검토', sub: '' },
  { key: 'review', title: '검토', sub: '관련 사업이지만 공사·장비·조건을 확인할 공고' },
  { key: 'soon', title: '진행 중(D-3 안)', sub: '이미 받은 공고 중 마감·필수 현장설명 D-3 이내 · 진행 기록 없음' }, // #608(대표 10/25): 화면 칩 '마감 임박'을 없애며 메일 구역 이름도 같이
  { key: 'change', title: '정정·취소', sub: '관련 사업이거나 진행 기록이 있는 공고만' },
  { key: 'result', title: '결과(낙찰·유찰)', sub: '영업 기회가 아닌 결과 — 새 공고 수에는 넣지 않음' }, // 로컬 10/24 12:20(#537 후속·#530)
];
const of = (d: Digest, s: DigestSection) => d.items.filter((i) => i.section === s);
/** 로컬 10/23 22:45: 마감 임박은 10건까지 보이고 나머지는 '나머지 n건 — [보기]'(입찰 화면 진행 중·마감 임박순) */
const SOON_MAX = 10;
const cap = (s: DigestSection, list: DigestItem[]) => (s === 'soon' ? list.slice(0, SOON_MAX) : list);

/** 제목: '[다짐·하이링크 영업실] 10/24(금) 오늘 입찰 9건 — 즉시 검토 3 · 마감 임박 2' (0인 칸은 뺌) · 215차: 정기 시각 전 [지금 보내기]는 앞에 '[시험 발송]' */
export function digestSubject(fromName: string, d: Digest, test = false) {
  const tail = [d.counts.now ? `즉시 검토 ${d.counts.now}` : null, d.counts.soon ? `마감 임박 ${d.counts.soon}` : null, d.counts.result ? `결과 ${d.counts.result}` : null].filter(Boolean).join(' · ');
  return `${test ? '[시험 발송] ' : ''}[${fromName}] ${mdw(d.day)} 오늘 입찰 ${d.counts.total}건${tail ? ` — ${tail}` : ''}`;
}
const summary = (d: Digest) => `새 공고 ${d.counts.new}(즉시 검토 ${d.counts.now} · 검토 ${d.counts.review}) · 정정 ${d.counts.amend} · 취소 ${d.counts.cancel} · 마감 임박(D-3 이내) ${d.counts.soon}${d.counts.result ? ` · 결과(낙찰·유찰) ${d.counts.result}` : ''}`;
/** #530 ⑧: 머리의 사업별 새 공고 수 — 두 묶음 이상일 때만 */
const bizLine = (d: Digest) => { const g = grouped(d.items.filter((i) => i.section === 'now' || i.section === 'review'), d.cond?.biz ?? []);
  return g.length > 1 ? `사업별 새 공고 ${g.map((x) => `${bizName(x[0]) || '기타'} ${x.length}`).join(' · ')}` : null; };
/** 걸러진 공고: 업종 무관·제외어·마감 지남 먼저 */
const skippedLine = (d: Digest) => {
  const order = ['업종 무관', '제외어', '마감 지남']; const e = Object.entries(d.counts.skipped).filter(([, v]) => v > 0).sort(([a], [b]) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
  return e.length ? `걸러진 공고 ${e.map(([k, v]) => `${k} ${v}`).join(' · ')}` : '걸러진 공고 없음';
};
/** 2·3·4행 조각(글자) — HTML 은 아래에서 감쌈. 2행 발주·금액 / 3행 일정(현장설명 → 참가신청마감 → 입찰마감 → 개찰) / 4행 첨부·투찰처·출처 */
function parts(i: DigestItem, day: string, hq: string | null) {
  // 지역 제한이 같은 시·도 하나뿐이면(나라장터 '참가가능지역' = 지역 칸) 지역을 두 번 쓰지 않음
  const region = i.region && !(i.limit && !i.limit.label.includes(' ') && (sidoIn(i.region) ?? i.region) === i.limit.label) ? i.region : null;
  const l2 = [i.result, i.issuer, region, ...(i.amounts ?? (i.amount ? [i.amount] : []))].filter((x): x is string => !!x && x.trim() !== '' && x.trim() !== '-');
  const lim = i.limit ? limitText(i.limit, hq) : null;
  const src = [i.source, i.noticeNo].filter(Boolean).join(' ') || null;
  if (i.section === 'result') return { l2, lim, sched: i.openingAt ? [`개찰 ${whenLabel(i.openingAt)}`] : [], l4: src ? [src] : [], elig: null }; // 결과는 지난 마감·참가신청 대신 개찰·출처만
  // 239차(#744): 현장설명 필수·임의 · 장소까지(K-apt 상세 칸)
  const sched = [i.briefingAt ? `현장설명${i.briefingKind === '필수' || i.briefingKind === '임의' ? `(${i.briefingKind})` : ''} ${whenLabel(i.briefingAt)}${i.briefingPlace ? ` ${i.briefingPlace}` : ''}` : null, i.participationAt ? `참가신청마감 ${whenLabel(i.participationAt)}` : null, i.deadlineAt ? `입찰마감 ${whenLabel(i.deadlineAt)}` : null,
    i.openingAt ? `개찰 ${whenLabel(i.openingAt)}` : null].filter((x): x is string => !!x);
  const l4 = [i.attachments ? `첨부 ${i.attachments}` : null, i.bidSystem ? `투찰 ${i.bidSystem}` : null, src, i.posted && i.posted < day ? `공고일 ${mdw(i.posted)}` : null,
    i.refound ? `다시 찾은 공고(${seenLabel(i.seenAt)} 처음 수집)` : i.late ? `지난 메일 뒤 ${seenLabel(i.seenAt)} 수집` : null].filter((x): x is string => !!x);
  return { l2, lim, sched, l4, elig: i.kind === 'cancel' ? null : i.elig ?? null }; // 252차 #786 참가자격(공고문 절에서 뽑은 요건 · 못 찾으면 이유)
}
const pill = (b: { name: string; color: string }, ml = 4) => `<span style="display:inline-block;padding:1px 7px;margin-left:${ml}px;border-radius:9px;font-size:11px;font-weight:700;line-height:16px;color:${esc(b.color)};background:${tint(b.color)}">${esc(b.name)}</span>`;

function itemHtml(i: DigestItem, n: number, base: string, day: string, hq: string | null) {
  const { l2, lim, sched, l4, elig } = parts(i, day, hq);
  const badges = i.badges.map((b) => { const [fg, bg] = BADGE[b] ?? [C.ink2, C.bg]; return `<span style="display:inline-block;padding:1px 6px;margin-right:4px;border-radius:4px;font-size:11px;font-weight:700;line-height:16px;color:${fg};background:${bg}">${esc(b)}</span>`; }).join('');
  const biz = i.biz.map((b) => pill(b)).join('');
  const link = `${base}/s/sales/hub?tab=bids&bt=all&id=${encodeURIComponent(i.id)}`;
  const tags = i.tags.map((t) => `<span style="display:inline-block;padding:0 6px;margin-left:4px;border:1px solid ${C.line};border-radius:4px;font-size:11px;line-height:16px;color:${C.ink3}">${esc(t)}</span>`).join('');
  const dl = i.deadlineAt && i.dday != null ? ` <b style="color:${ddColor(i.dday)}">${ddText(i.dday)}</b>` : '';
  const l2html = [...l2.map(esc), lim && i.limit ? `<b style="color:${limitColor(i.limit)}" data-digest-limit="${i.limit.ok === true ? 'ok' : i.limit.ok === false ? 'no' : 'unknown'}">${esc(lim)}</b>` : ''].filter(Boolean).join(' · ');
  const schedHtml = sched.map((x) => (x.startsWith('입찰마감 ') ? `${esc(x)}${dl}` : esc(x))).join(' · ');
  const l4html = [i.progress ? `<b style="color:#047857" data-digest-progress="1">${esc(i.progress)}</b>` : '', ...l4.map(esc)].filter(Boolean).join(' · ');
  // #543 바로 가는 공고 주소가 없는 원천(온비드·국방·LH 첫 화면, 옛 사전규격 주소) — [원문] 대신 '○○에서 공고번호 ○○ 검색'
  const orig = i.search ? `${l4html ? ' · ' : ''}<a href="${esc(i.search.home)}" style="color:${C.brand};text-decoration:underline">${esc(i.search.site)}</a>에서 ${esc(i.search.label)} <b>${esc(i.search.no)}</b> 검색`
    : http(i.url) ? `${l4html ? ' · ' : ''}<a href="${esc(i.url)}" style="color:${C.brand};text-decoration:underline">원문</a>` : '';
  return `<tr><td style="padding:12px 16px;border-top:1px solid ${C.line}" data-digest-item="${esc(i.section)}">
<div style="font-size:15px;line-height:22px;font-weight:700;color:${C.ink}"><span style="color:${C.ink3};font-weight:600;margin-right:4px">${n}.</span>${badges}<a href="${esc(link)}" style="color:${C.ink};text-decoration:${i.kind === 'cancel' ? 'line-through' : 'none'}">${esc(i.title)}</a>${biz}</div>
${l2html || tags ? `<div style="margin-top:3px;font-size:13px;line-height:20px;color:${C.ink2}">${l2html}${tags}</div>` : ''}
${schedHtml ? `<div style="margin-top:3px;font-size:12px;line-height:19px;color:${C.ink2}" data-digest-sched="1"><b style="color:${C.ink3};margin-right:4px">일정</b>${schedHtml}</div>` : ''}
${elig ? `<div style="margin-top:2px;font-size:12px;line-height:19px;color:${C.ink2}" data-digest-elig="1"><b style="color:${C.ink3};margin-right:4px">참가자격</b>${esc(elig)}</div>` : ''}
${l4html || orig ? `<div style="margin-top:2px;font-size:12px;line-height:19px;color:${C.ink3}">${l4html}${orig}</div>` : ''}</td></tr>`;
}
const button = (href: string, label: string, primary: boolean) => `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 0 0;padding:8px 14px;border-radius:6px;font-size:13px;font-weight:700;text-decoration:none;${primary ? `background:${C.brand};color:#FFFFFF` : `background:#FFFFFF;color:${C.brandInk};border:1px solid #BFDBFE`}">${esc(label)}</a>`;
/** 구역 안 사업 묶음 머리(두 묶음 이상일 때) */
const groupHtml = (g: DigestItem[]) => `<tr><td style="padding:10px 16px 2px;font-size:12px;font-weight:700;color:${C.ink3}" data-digest-group="${esc(bizName(g[0]) || '기타')}">${g[0].biz.length ? g[0].biz.map((b, k) => pill(b, k ? 4 : 0)).join('') : `<span style="color:${C.ink2}">기타</span>`} <span style="margin-left:2px">${g.length}건</span></td></tr>`;

/** 메일 한 통(제목·HTML·텍스트) · opt.testHour = 정기 시각 전 [지금 보내기](시험 발송 — 누른 사람에게만, 정기 메일은 그대로) */
export function digestMail(fromName: string, d: Digest, base: string, opt: { testHour?: number } = {}) {
  const test = opt.testHour != null;
  const subject = digestSubject(fromName, d, test);
  const today = `${base}/s/sales/hub?tab=bids&bt=today`, prefs = `${base}/s/sales/sources`, refs = `${base}/s/sales/hub?tab=bids&bt=ref`, open = `${base}/s/sales/hub?tab=bids&bt=open`, profile = `${base}/s/sales/support`;
  const hq = d.cond?.hq ?? null; const order = d.cond?.biz ?? [];
  const period = periodLine(d); const bizs = bizLine(d); const cond = d.cond ? condParts(d.cond) : null;
  const testNote = test ? `시험 발송 — 누른 사람에게만 보냈습니다. 오늘 ${String(opt.testHour).padStart(2, '0')}:00 정기 메일은 그대로 갑니다.` : null;
  // 본사 시·도를 모르는데 지역 제한 공고가 있으면 끝에 한 줄 안내
  const hqHint = !hq && d.items.some((i) => i.section !== 'ref' && i.limit) ? '회사 프로필(영업 › 지원사업)에 본사 시·도를 넣으면 지역 제한 공고마다 참가 가능 여부를 함께 보여 줍니다' : null;
  const sections = SECTIONS.map((s) => { const list = of(d, s.key); if (!list.length) return '';
    const shown = cap(s.key, list); const rest = list.length - shown.length;
    const groups = s.key === 'soon' ? [shown] : grouped(shown, order); let n = 0;
    const rows = groups.map((g) => `${groups.length > 1 ? groupHtml(g) : ''}${g.map((x) => itemHtml(x, ++n, base, d.day, hq)).join('')}`).join('');
    return `<tr><td style="padding:18px 16px 6px" data-digest-section="${s.key}"><div style="font-size:15px;font-weight:800;color:${C.ink}">${esc(s.title)} <span style="color:${C.ink3};font-weight:700">${list.length}</span></div>${s.sub ? `<div style="margin-top:2px;font-size:12px;color:${C.ink3}">${esc(s.sub)}</div>` : ''}</td></tr>${rows}${rest > 0 ? `<tr><td style="padding:10px 16px;border-top:1px solid ${C.line};font-size:13px;color:${C.ink2}" data-digest-more="${s.key}">나머지 ${rest}건 — <a href="${esc(open)}" style="color:${C.brand}">보기</a></td></tr>` : ''}`; }).join('');
  const ref = d.counts.ref ? `<tr><td style="padding:14px 16px;border-top:1px solid ${C.line};font-size:13px;color:${C.ink2}" data-digest-section="ref"><b>참고(검색어만 일치)</b> ${d.counts.ref}건 — <a href="${esc(refs)}" style="color:${C.brand}">보기</a></td></tr>` : '';
  const empty = !sections && !ref ? `<tr><td style="padding:18px 16px;font-size:14px;color:${C.ink2}">지난 메일 뒤 들어온 맞춤 공고가 없습니다.</td></tr>` : '';
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;background:#FFFFFF;border:1px solid ${C.line};border-radius:10px;font-family:${FONT};color:${C.ink}" data-digest="1">
<tr><td style="padding:18px 16px 14px;background:${C.soft};border-radius:10px 10px 0 0" data-digest-head="1">
<div style="font-size:12px;font-weight:700;color:${C.brandInk}">${esc(fromName)}</div>
<div style="margin-top:2px;font-size:19px;font-weight:800;color:${C.ink}">${esc(mdw(d.day))} 오늘 입찰 ${d.counts.total}건</div>
${period ? `<div style="margin-top:2px;font-size:12px;color:${C.ink3}" data-digest-period="1">${esc(period)}</div>` : ''}
${testNote ? `<div style="margin-top:8px;padding:6px 10px;border-radius:6px;background:#FEF3C7;font-size:12px;font-weight:700;color:#92400E" data-digest-test="1">${esc(testNote)}</div>` : ''}
<div style="margin-top:6px;font-size:13px;line-height:20px;color:${C.ink2}">${esc(summary(d))}</div>
${bizs ? `<div style="margin-top:2px;font-size:13px;line-height:20px;color:${C.ink2}" data-digest-biz="1">${esc(bizs)}</div>` : ''}
<div style="margin-top:8px">${button(today, '오늘 공고 전체 보기', true)}${button(prefs, '맞춤 설정', false)}</div></td></tr>
${cond ? `<tr><td style="padding:10px 16px;border-top:1px solid ${C.line};background:#F9FAFB;font-size:12px;line-height:19px;color:${C.ink2}" data-digest-cond="1"><b style="color:${C.ink};margin-right:4px">맞춤 조건</b>${esc(cond.join(' · '))} — <a href="${esc(prefs)}" style="color:${C.brand}">바꾸기</a></td></tr>` : ''}
${sections}${ref}${empty}
<tr><td style="padding:14px 16px 18px;border-top:1px solid ${C.line};font-size:12px;line-height:19px;color:${C.ink3}">${esc(skippedLine(d))}${d.counts.merged ? ` · 같은 공고 ${d.counts.merged}줄은 최신 차수 하나로` : ''} — <a href="${esc(prefs)}" style="color:${C.brand}">맞춤 설정에서 바꾸기</a>${hqHint ? `<br><a href="${esc(profile)}" style="color:${C.brand}" data-digest-hq-hint="1">${esc(hqHint)}</a>` : ''}<br>이 메일은 워크인 영업실 당일 공고 알림입니다.</td></tr>
</table></td></tr></table></body></html>`;
  const txt = (i: DigestItem, n: number) => { const { l2, lim, sched, l4, elig } = parts(i, d.day, hq);
    return [`${n}. ${i.badges.map((b) => `[${b}] `).join('')}${i.title}${i.biz.length ? ` [${bizName(i)}]` : ''}`,
      l2.length || lim || i.tags.length ? `   ${[...l2, ...(lim ? [lim] : []), ...i.tags].join(' · ')}` : null,
      sched.length ? `   일정: ${sched.map((x) => (x.startsWith('입찰마감 ') && i.dday != null ? `${x} ${ddText(i.dday)}` : x)).join(' · ')}` : null,
      elig ? `   참가자격: ${elig}` : null,
      i.progress || l4.length ? `   ${[i.progress, ...l4].filter(Boolean).join(' · ')}` : null,
      `   보기: ${base}/s/sales/hub?tab=bids&bt=all&id=${encodeURIComponent(i.id)}`].filter(Boolean).join('\n'); };
  const text = [subject, ...(period ? [period] : []), ...(testNote ? [testNote] : []), '', summary(d), ...(bizs ? [bizs] : []), ...(cond ? [`맞춤 조건: ${cond.join(' · ')} — 바꾸기: ${prefs}`] : []), `오늘 공고 전체 보기: ${today}`, `맞춤 설정: ${prefs}`,
    ...SECTIONS.flatMap((s) => { const list = of(d, s.key); const shown = cap(s.key, list); const rest = list.length - shown.length;
      const groups = s.key === 'soon' ? [shown] : grouped(shown, order); let n = 0;
      return list.length ? ['', `■ ${s.title} (${list.length})${s.sub ? ` — ${s.sub}` : ''}`, ...groups.flatMap((g) => [...(groups.length > 1 ? [`  ◇ ${bizName(g[0]) || '기타'} ${g.length}건`] : []), ...g.map((x) => txt(x, ++n))]), ...(rest > 0 ? [`   나머지 ${rest}건 — 보기: ${open}`] : [])] : []; }),
    ...(d.counts.ref ? ['', `■ 참고(검색어만 일치) ${d.counts.ref}건 — 보기: ${refs}`] : []),
    ...(!d.items.some((i) => i.section !== 'ref') && !d.counts.ref ? ['', '지난 메일 뒤 들어온 맞춤 공고가 없습니다.'] : []),
    '', `${skippedLine(d)}${d.counts.merged ? ` · 같은 공고 ${d.counts.merged}줄은 최신 차수 하나로` : ''} — 맞춤 설정에서 바꾸기: ${prefs}`, ...(hqHint ? [`${hqHint}: ${profile}`] : []), '이 메일은 워크인 영업실 당일 공고 알림입니다.'].join('\n');
  return { subject, html, text };
}
