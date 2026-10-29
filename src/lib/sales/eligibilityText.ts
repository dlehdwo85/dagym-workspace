// 252차 #786(대표 10/29 00:20 "입찰 참가자격 요건(자본금·기술인력·실적 등)이 공고상에 적혀 있다 — 그걸 표기, 지금은 적격심사 같은 입찰 종류가 적혀 있음"):
// 공고문 글에서 '참가자격' 절을 잘라(원문 그대로, 1,500자) 요건 항목을 규칙으로 뽑는다 — AI·비용 없음. 다른 모듈을 불러오지 않는 잎 모듈(시험이 바로 불러 씀)
export type EligItem = { k: 'capital' | 'license' | 'perf' | 'staff' | 'credit' | 'region' | 'briefing' | 'joint' | 'other'; label: string };
/** 저장하는 절 길이 · 264차: 1,500자에서 잘린 절을 AI 에 줄 때 더 긴 절(4,000자) */
export const SEC_MAX = 1500;
export const SEC_LONG = 4000;
const MAX = SEC_MAX;
const ROMAN = 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ';
/** 절 머리 — '5. 참가자격' · '8. 입찰참가자격(입찰공고일 현재기준)' · '4. 입찰 참가자격' · '□ 참가자격의 제한' · 'Ⅲ. 입찰참가자격' */
const HEAD = new RegExp(`(?:^|\\n|[ \\t])[ \\t]*(?:(\\d{1,2})[.)]|([${ROMAN}]+)[.)]?|([□■◆◇▣○●◎※▶►]))?[ \\t]*(?:입찰\\s*)?참가\\s*자격(?:\\s*(?:의\\s*)?(?:제한|요건|조건|사항))?`, 'g');
/** 모든 공고에 있는 공통 문구(사업자선정지침 제26조 '해당하지 않는' 사업자) — 화면 한 줄에서는 빼고 원문에만 */
export const COMMON_CLAUSE = /(?:제\s*26\s*조|선정\s*지침|국토교통부\s*고시)[^\n]{0,80}?해당(?:하|되)지\s*않/;
/** 260차(로컬 10/29 13:15 나라장터 '(협상)보령시 파크골프장…'): 나라장터 공고의 공통 자격 문구 — 지방·국가계약법 시행령 제13조·제12조, 시행규칙 제14조, 제31조·제76조 부정당업자 제한,
 *  전자조달 입찰참가자격 등록 — 모든 공고에 있어 한 줄에서는 빼고 원문에만 */
export const G2B_COMMON = /(?:계약에\s*관한\s*법률|계약\s*법)[^\n]{0,40}?시행\s*(?:령|규칙)|시행령\s*제\s*1[23]\s*조|시행규칙\s*제\s*14\s*조|제\s*(?:31|76|92)\s*조|부정당\s*업자|참가\s*자격\s*(?:의\s*)?제한을?\s*받|전자\s*조달\s*시스템[^\n]{0,30}?등록|참가\s*자격\s*(?:을\s*)?등록(?:한|하여야|해야)/;
const commonPart = (x: string) => COMMON_CLAUSE.test(x) || G2B_COMMON.test(x);
/** 262차(로컬 10/29 13:40 나라장터 4건): 한 줄에 쓰면 안 되는 글 — 구분선 기호 · 청렴서약·서약서 문구 · 요건 없이 '아래(다음) 각 호의 자격을 모두 갖춘 자' 같은 머리글 */
const SEP = /[-=─━_~＝－]{4,}/g;
const PLEDGE = /서약|유죄\s*판결|허위로|청렴/;
const LEAD_IN = /^(?:[가-하]\.|\d{1,2}[.)])?\s*(?:(?:아래|다음|위)(?:의)?\s*(?:각\s*(?:호|항|목)\s*(?:의)?\s*)?(?:자격|요건|조건|사항)|(?:모두|다음을|아래를)\s*(?:충족|갖춘|갖추)|(?:각\s*(?:호|항)|어느\s*하나|중\s*하나)에\s*해당)/;

/** 공고문 글 → '참가자격' 절(머리부터 다음 같은 급 번호 머리 앞까지, 최대 1,500자 — max 로 바꿈). 없으면 null */
export function eligibilitySection(text: string | null | undefined, max = MAX): string | null {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  if (!t) return null;
  // 본문 안의 '참가자격이 없는 자의 입찰은 무효' 같은 말은 빼고, 머리 꼴(번호·기호로 시작하거나 줄 처음)인 것 중 첫째
  let best: { at: number; num: number | null; roman: string | null; sym: string | null; head: string } | null = null;
  for (const m of t.matchAll(HEAD)) {
    const at = (m.index ?? 0) + (m[0].length - m[0].trimStart().length);
    const lineStart = (m.index ?? 0) === 0 || m[0].startsWith('\n') || t[(m.index ?? 0) - 1] === '\n'; // 번호·기호 없는 머리는 줄 처음일 때만(글이 한 줄로 이어진 공고문도 '5. 참가자격'은 찾음)
    const after = t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 12);
    if (/^\s*(?:이|을|를|은|는|에|의\s*(?!제한)|과|와|이\s*없|을\s*갖|확인|심사|여부|미달|상실)/.test(after) && !m[1] && !m[2] && !m[3]) continue; // 본문 속 낱말
    // 256차(로컬 10/29 08:35 나라장터 'GH 주민공동시설 현황조사' 용역): '○ 입찰참가자격 등록, 나라장터 시스템: 나라장터 콜센터(☎ 1588-0800)' = 등록 절차 안내 — 절 머리 아님
    const nl = t.indexOf('\n', at); const headLine = t.slice(at, nl < 0 ? at + 120 : Math.min(nl, at + 120));
    if (/^\s*(?:등록|신청\s*(?:방법|안내|절차))|^\s*(?:\([^)]{0,20}\))?\s*(?:등록|확인)\s*(?:방법|안내|절차)/.test(after) || /콜센터|☎|고객\s*센터/.test(headLine)) continue;
    // 257차(같은 공고 다시): 문의처 표 '○ 입찰참가자격 및 제안서평가 등 : GH 건설임대처 건설임대시설1부' = 업무별 담당 부서 줄 — 절 머리 아님(쌍점 뒤가 부서·전화로 끝나는 줄)
    if (/[:：]\s*[^\n:：]{0,40}(?:처|팀|부|과|실|센터|본부|담당자?|문의|전화|☎\s*[\d-]*|\d{2,4}-\d{3,4}-\d{4})\s*\d*[\s)）]*$/.test(headLine)) continue;
    const numbered = !!(m[1] || m[2] || m[3]);
    if (!numbered && (best || !lineStart)) continue;
    best = { at, num: m[1] ? Number(m[1]) : null, roman: m[2] ?? null, sym: m[3] ?? null, head: m[0].trim() };
    if (numbered) break;
  }
  if (!best) return null;
  const body = t.slice(best.at);
  let end = Math.min(body.length, max);
  const from = best.head.length + 4;
  const cut = (re: RegExp, ok: (m: RegExpMatchArray) => boolean = () => true) => {
    for (const m of body.slice(from).matchAll(re)) if (ok(m)) { end = Math.min(end, from + (m.index ?? 0)); return; }
  };
  if (best.num != null) cut(/(?:^|\n|\s{2,}|[ \t])(\d{1,2})[.)]\s*(?=[가-힣(「\[])/g, (m) => Number(m[1]) === best!.num! + 1 || (Number(m[1]) > best!.num! && Number(m[1]) <= best!.num! + 3 && /\n/.test(m[0])));
  else if (best.roman) cut(new RegExp(`(?:^|\\n)[ \\t]*[${ROMAN}]+[.)]?\\s*[가-힣]`, 'g'));
  else if (best.sym) cut(new RegExp(`\\n[ \\t]*\\${best.sym}\\s*[가-힣]`, 'g'));
  else cut(/\n[ \t]*(?:\d{1,2}[.)]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.)]?|[□■◆▣])\s*[가-힣]/g);
  const sec = body.slice(0, end).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return sec.length > best.head.length + 2 ? sec.slice(0, max) : null;
}

/** 259차(로컬 10/29 10:10 나라장터 '(협상)보령시 파크골프장…' — 협상(제안서)·직찰 공고는 API 에 입찰 마감 칸(bidClseDt)이 없음): 공고문 글 → 제안서·입찰서 제출 마감 일시.
 *  '제안서 제출 마감: 2026. 11. 10.(화) 18:00' · '입찰서 제출기간 2026.11.03.(화) 09:00 ~ 2026.11.10.(화) 18:00까지'(끝 날짜) · '접수 기한 2026년 11월 10일(화) 오후 5시'.
 *  참가자격 등록·참가신청·공동수급·현장설명·질의·개찰 줄은 뺌. 날짜 줄에 없으면 바로 다음 줄(표 칸)까지. posted(공고일)가 있으면 그날~200일 안만. 없으면 null */
const DL_LABEL = /(?:(?:제안\s*서|입찰\s*서|가격\s*(?:입찰|제안)\s*서|제안\s*서류|입찰\s*서류|서류)\s*(?:의\s*)?(?:제출|접수|투찰)|(?:전자\s*)?입찰|투찰|제출|접수)\s*(?:마감\s*일시|마감|기한|기간|일시)/g;
const DL_SKIP = /참가\s*자격\s*(?:등록|신청)|참가\s*신청|공동\s*수급|현장\s*설명|질의|이의\s*신청|사전\s*심사|개찰|낙찰/;
const DL_DATE = /(20\d{2})\s*(?:[.\-/]|년)\s*(\d{1,2})\s*(?:[.\-/]|월)\s*(\d{1,2})\s*(?:일|\.)?\s*(?:\(\s*[월화수목금토일]\s*\)|[월화수목금토일]요일)?\s*(?:(오전|오후)\s*)?(?:(\d{1,2})\s*(?::|시)\s*(\d{2})?\s*분?)?/g;
export function docDeadline(text: string | null | undefined, posted?: string | null): { at: string; label: string } | null {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  const lo = /^\d{4}-\d{2}-\d{2}/.test(String(posted ?? '')) ? String(posted).slice(0, 10) : null;
  const hi = lo ? new Date(Date.parse(`${lo}T12:00:00+09:00`) + 200 * 864e5).toISOString().slice(0, 10) : null;
  const dates = (s: string) => [...s.matchAll(DL_DATE)].map((d) => {
    let h = d[5] != null ? Number(d[5]) : null; if (h != null && d[4] === '오후' && h < 12) h += 12;
    const ymd = `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}`;
    return { ymd, iso: `${ymd}T${h != null && h <= 24 ? String(Math.min(h, 23)).padStart(2, '0') : '23'}:${h != null && h <= 24 ? (d[6] ?? '00').padStart(2, '0') : '59'}:00+09:00`, end: (d.index ?? 0) + d[0].length };
  }).filter((d) => !Number.isNaN(Date.parse(d.iso)) && (!lo || (d.ymd >= lo && d.ymd <= hi!)));
  let best: { prio: number; at: string; label: string } | null = null;
  for (const m of t.matchAll(DL_LABEL)) {
    const at = m.index ?? 0; const ls = t.lastIndexOf('\n', at) + 1; const le0 = t.indexOf('\n', at); const le = le0 < 0 ? t.length : le0;
    const line = t.slice(ls, le); if (DL_SKIP.test(line)) continue;
    const rest = t.slice(at + m[0].length, le);
    let ds = dates(rest);
    if (!ds.length && le < t.length) { const ne0 = t.indexOf('\n', le + 1); const next = t.slice(le + 1, ne0 < 0 ? t.length : ne0); if (!DL_SKIP.test(next)) ds = dates(next.slice(0, 120)); }
    if (!ds.length) continue;
    const range = ds.length > 1 && /~|∼|부터|까지|-\s*20\d{2}/.test(rest);
    const d = range ? ds[ds.length - 1] : ds[0];
    const prio = /제안|입찰\s*서|투찰|가격/.test(m[0]) ? 0 : /입찰/.test(m[0]) ? 1 : 2;
    if (!best || prio < best.prio) best = { prio, at: d.iso, label: line.replace(/\s+/g, ' ').trim().slice(0, 80) };
    if (prio === 0) break;
  }
  return best ? { at: best.at, label: best.label } : null;
}
/** 257차: jsonb 가 받지 않는 글자(NUL·짝 없는 서로게이트 — 한글 hwp 를 글자 단위로 읽거나 1,500자에서 자를 때 생길 수 있음)를 지움. 하나라도 있으면 저장이 통째로 실패해 공고가 '아직 안 읽음'으로 남았음 */
export function jsonSafe<T extends string | null | undefined>(v: T): T {
  return (typeof v === 'string' ? v.replace(/\u0000/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '') : v) as T;
}
const one = (s: string) => s.replace(/\s+/g, ' ').trim();
/** 등록·면허 — 자주 나오는 이름(업종 중립: 회사 이름 아님) + 'OO공사업·OO사업자·OO관리업' 꼴 */
const LIC_WORDS = ['주민운동시설 위탁운영 등록', '체육시설업', '소프트웨어사업자', '정보통신공사업', '전기공사업', '소방시설공사업', '소방시설관리업', '경비업', '주택관리업', '실내건축공사업', '시설물유지관리업', '기계설비공사업',
  '건물위생관리업', '엔지니어링사업자', '직접생산확인', '정보보호전문서비스', '전문건설업', '종합건설업', '조경공사업', '승강기'];
const STAFF_WORDS = ['생활체육지도자', '건강운동관리사', '스포츠지도사', '체육지도자', '정보처리기사', '정보통신기사', '전기기사', '소방설비기사', '전기산업기사', '기술자', '기술인력', '전문인력', '관리사무소장', '주택관리사'];
/** 절 → 요건 항목(자본금·등록·면허·실적·인력·신용등급·지역·현장설명 참가·공동도급). 공통 문구(제26조)만 있으면 [] */
export function eligibilityItems(section: string | null | undefined): EligItem[] {
  const t = one(String(section ?? '')); if (!t) return [];
  const out: EligItem[] = [];
  const cap = t.match(/자본금[^.;]{0,24}?(\d+(?:[.,]\d+)?)\s*(억|천만|백만)\s*원?\s*(이상|초과)?/);
  if (cap) out.push({ k: 'capital', label: `자본금 ${cap[1]}${cap[2]}${cap[3] ? ' 이상' : ''}` });
  const lic = new Set<string>();
  // 256차(로컬 10/29 08:35 '주택관리업' 거짓 면허): 「주택관리업자 및 사업자 선정지침」 같은 지침·고시 이름 안 낱말은 면허로 안 봄
  const tl = t.replace(/「[^」]{0,80}」/g, ' ').replace(/[가-힣]+\s*(?:및\s*[가-힣]+\s*)?선정\s*지침/g, ' ');
  for (const w of LIC_WORDS) if (tl.replace(/\s/g, '').includes(w.replace(/\s/g, ''))) lic.add(w === '주민운동시설 위탁운영 등록' ? '주민운동시설 위탁운영 등록업체' : w);
  for (const m of tl.matchAll(/([가-힣]{2,10}(?:공사업|사업자|관리업|용역업|엔지니어링업))(?=\s*(?:등록|면허|허가|신고|,|·|및|를|을|\(|\)|$))/g)) if (![...lic].some((x) => x.includes(m[1]) || m[1].includes(x)) && !/^(?:해당|모든|입찰|참가|당해|기타)/.test(m[1])) lic.add(m[1]);
  if (lic.size) { const names = [...lic]; out.push({ k: 'license', label: `${names.join('·')}${/면허/.test(t) && !names.some((n) => /등록업체$/.test(n)) ? ' 면허' : ''}` }); }
  // 실적 — ① 'N년(간) … N개 단지 이상 (위탁)운영 실적'(숫자가 '실적' 앞, 252차 운영 hwp·hwpx 공고문) ② '최근 N년간 공사 실적 N건'·'실적 … N건'
  const UNIT = '\\d[\\d,]*\\s*(?:개\\s*)?(?:건|개소|단지|회|세대|곳|개)\\s*(?:이상)?';
  const p1 = t.match(new RegExp(`((?:최근|과거|현재로부터|공고일\\s*(?:현재|기준)(?:로부터)?)?\\s*\\d+\\s*년\\s*(?:간|이내|동안|내)?)\\s*([^.;]{0,40}?)(${UNIT})\\s*([^.;]{0,24}?)\\s*(?:의\\s*)?실적`));
  if (p1) {
    const per = p1[1].replace(/현재로부터|공고일\s*(?:현재|기준)(?:로부터)?/g, '').replace(/(\d+)\s*년\s*(?:간|동안)/, '$1년').trim();
    // 256차(로컬 10/29 08:35 '… 위탁운영 완료실적이 3 건 이상'): '실적' 뒤 건수도 붙임('완료'·'완료실적만 인정'은 원문에만)
    const cnt = t.slice((p1.index ?? 0) + p1[0].length, (p1.index ?? 0) + p1[0].length + 16).match(/^\s*(?:이|가|은|는)?\s*(\d[\d,]*)\s*(건|개소|단지|회|곳|개)\s*(이상)?/);
    const base = one(`실적 ${per} ${p1[2]} ${p1[3]} ${p1[4].replace(/\s*완료$/, '')}`).replace(/\s*(?:이|가|의|을|를)$/, '').replace(/(\d)\s+(건|개소|단지|회|세대|곳|개)/g, '$1$2').slice(0, cnt ? 52 : 60);
    out.push({ k: 'perf', label: cnt ? `${base} ${cnt[1]}${cnt[2]}${cnt[3] ? ' 이상' : ''}` : base });
  } else {
    const perf = t.match(new RegExp(`((?:최근|과거)\\s*\\d+\\s*년\\s*(?:간|이내|동안)?[^.;]{0,40}?${UNIT})`)) ?? t.match(new RegExp(`(실적[^.;]{0,50}?${UNIT})`));
    if (perf && /실적|수행|위탁\s*운영|용역|공사/.test(perf[1] + t.slice(Math.max(0, (perf.index ?? 0) - 15), perf.index ?? 0) + t.slice((perf.index ?? 0) + perf[0].length, (perf.index ?? 0) + perf[0].length + 20))) out.push({ k: 'perf', label: `실적 ${one(perf[1].replace(/(?:사업\s*)?실적\s*[:：]?\s*/g, ' ').replace(/(\d+)\s*년\s*간/, '$1년').replace(/\s*이상$/, ' 이상'))}` });
  }
  const staff: string[] = [];
  for (const w of STAFF_WORDS) {
    const m = t.match(new RegExp(`${w}[^.;]{0,20}?(\\d+)\\s*(?:명|인)\\s*(이상)?`));
    if (staff.some((x) => x.includes(w))) continue; // '생활체육지도자' 안의 '체육지도자'
    if (m) staff.push(`${w} ${m[1]}명${m[2] ? ' 이상' : ''}`);
    else if (t.includes(w) && !staff.some((x) => x.includes(w)) && !/기술자|기술인력|전문인력/.test(w)) staff.push(w);
  }
  if (staff.length) out.push({ k: 'staff', label: staff.slice(0, 3).join('·') });
  const cr = t.match(/신용\s*(?:평가\s*)?등급[^.;]{0,12}?([A-D]{1,3}[+-]?0?)\s*(?:등급\s*)?(이상)/);
  if (cr) out.push({ k: 'credit', label: `신용등급 ${cr[1]} 이상` });
  const rg = t.match(/([가-힣]{2,8}(?:특별시|광역시|특별자치시|특별자치도|도|시|군))\s*(?:내|관내)?\s*(?:에\s*)?(?:주된\s*영업소|본사|본점|사업장)?\s*(?:를|가|이)?\s*(?:소재|둔|두고|있는)/);
  if (rg && !/^(?:입찰|해당|공고|현재)/.test(rg[1])) out.push({ k: 'region', label: `${rg[1]} 소재` });
  if (/현장\s*설명(?:회)?에\s*(?:참가|참석)(?:한|하여|한\s*업체)/.test(t)) out.push({ k: 'briefing', label: '현장설명 참가 업체' });
  const jt = t.match(/공동\s*(?:도급|수급|계약)[^.;]{0,15}?(불가|불허|허용하지\s*않|금지|가능|허용)/);
  if (jt) out.push({ k: 'joint', label: /불가|불허|않|금지/.test(jt[1]) ? '공동도급 불가' : '공동도급 가능' });
  return out;
}
/** 262차: 요건이 있는데 항목으로 못 뽑은 공고 — 원문 첫 문장 대신(원문은 펼치기에) */
export const ELIG_NO_ITEMS = '요건을 항목으로 못 뽑음 — 원문 보기';
/** 262차: 규칙으로 못 뽑아 빠른 AI 가 원문 절에서 항목을 정리한 것 — 한 줄 옆 안내 */
export const AI_ITEMS_NOTE = 'AI 가 정리 — 원문 확인';
/** 화면 한 줄 — 뽑은 요건(자본금 → 실적 → 등록·면허 → 인력 → 신용 → 지역 → 현장설명 → 공동도급 → 그 밖), 못 뽑았으면 공통 문구·구분선·서약·머리글을 뺀 짧은 원문(40자까지), 길면 ELIG_NO_ITEMS · 공통 문구뿐이면 null */
export function eligibilityLine(items: EligItem[], section: string | null | undefined, extra: string[] = []): string | null {
  const order: EligItem['k'][] = ['capital', 'perf', 'license', 'staff', 'credit', 'region', 'briefing', 'joint', 'other'];
  const parts = [...order.flatMap((k) => items.filter((x) => x.k === k).map((x) => x.label)), ...extra.filter(Boolean)];
  if (parts.length) return parts.join(' · ').slice(0, 200);
  // 260차: 공통 문구가 섞인 줄은 쉼표·'갖추고' 단위로 나눠 공통 부분만 뺌(뒤에 붙은 진짜 요건은 남김)
  const strip = (x: string) => (commonPart(x) ? x.split(/(?<=,|갖추고|있고|하고|이며|로서|로써)\s+/).filter((c) => !commonPart(c)).join(' ').replace(/^[가-하]\.\s*$/, '').trim() : x);
  const pieces = String(section ?? '').split(/\n|(?=\s[가-하]\.\s)|(?=‣|•)/).map((x) => one(x.replace(SEP, ' '))).map(strip)
    .filter((x) => x && !/^[가-하]\.$/.test(x) && !/^\d{1,2}[.)]$/.test(x) && !/^(?:\d{1,2}[.)]\s*)?(?:입찰\s*)?참가\s*자격/.test(x) && !/콜센터|☎|등록\s*방법/.test(x));
  const rest = pieces.filter((x) => !PLEDGE.test(x) && !(LEAD_IN.test(x) && x.length < 70));
  if (!rest.length) return pieces.length ? ELIG_NO_ITEMS : null; // 서약·머리글만 남았으면 요건은 표·뒤쪽에 — 공통 자격으로 말하지 않음
  const joined = rest.join(' ');
  return joined.length <= 40 ? joined : ELIG_NO_ITEMS; // 262차(로컬 10/29 13:40): 긴 원문 첫 문장을 한 줄에 쓰지 않음
}
/** 262차: 빠른 AI 로 항목을 정리할 공고 — 규칙으로 항목을 하나도 못 뽑았고 공통 문구뿐도 아님(나라장터 API 업종·지역과 무관) */
export function needsAiItems(text: string | null | undefined): boolean {
  return !!text && !eligibilityItems(text).length && eligibilityLine([], text) === ELIG_NO_ITEMS;
}
/** 저장한 절의 지문(브라우저에서도 쓰는 모듈이라 crypto 없이) — AI 항목이 이 절에서 뽑은 것인지 */
export function textSig(t: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16)}:${t.length}`;
}
/** long(264차): 저장한 절이 잘려 AI 에 더 긴 절을 줬을 때 그 글자 수 */
export type EligAi = { sig: string; items: EligItem[]; usd?: number; at: string; error?: string; skip?: string; tries?: number; long?: number };
/** AI 가 정리한 항목(같은 절에서 뽑은 것만) */
export const aiItemsOf = (e: { text?: string | null; ai?: EligAi | null } | null | undefined): EligItem[] | null =>
  e?.text && e.ai?.items?.length && e.ai.sig === textSig(e.text) && !eligibilityItems(e.text).length ? e.ai.items : null;
type EligAiRow = { text?: string | null; ai?: EligAi | null; by?: string; aiLongTry?: string | null } | null | undefined;
/** 264차(로컬 10/29 15:50 GH 용역 — AI 가 '1)·2)·3) 중 하나(세부 내용 원문 없음)'): 저장한 절이 1,500자에서 잘렸고 규칙으로 못 뽑은 공고 —
 *  공고문을 한 번 다시 읽어 더 긴 절(4,000자)을 AI 에 줌(이미 줬거나 해 본 공고·사진 공고문은 빼고) */
export const aiLongDue = (e: EligAiRow): boolean => !!e?.text && e.text.length >= SEC_MAX && e.by !== 'vision' && !e.aiLongTry && !e.ai?.long && needsAiItems(e.text);
/** 264차(같은 메시지 천안상록골프장 프로샵): 규칙으로 못 뽑은 공고의 AI 정리 상태 — 'AI 가 아직 안 돈 것인지, AI 도 못 뽑은 것인지' */
export function aiStateOf(e: EligAiRow): string | null {
  if (!e?.text || !needsAiItems(e.text)) return null;
  const a = e.ai && e.ai.sig === textSig(e.text) ? e.ai : null;
  if (a?.items?.length) return null;
  return !a ? 'AI 정리 대기' : a.skip ? 'AI 정리 안 함' : a.error ? 'AI 정리 실패' : 'AI 도 못 뽑음';
}
/** '요건을 항목으로 못 뽑음(AI 도 못 뽑음) — 원문 보기' */
export const noItemsLine = (state: string | null) => (state ? ELIG_NO_ITEMS.replace(' — ', `(${state}) — `) : ELIG_NO_ITEMS);
/** 못 찾았을 때 말(목록·상세·당일 메일·공고 조회 같은 말) */
export const ELIG_MISS = '공고문에서 참가자격을 못 찾음 — 원문 확인';
/** 참가자격 한 줄 — 읽었으면 뽑은 요건, 못 찾았으면 이유(나라장터 업종·지역이 있으면 앞에), 아직 안 읽었으면 나라장터 업종·지역만(없으면 null) */
export function eligSay(e: { line?: string | null; text?: string | null; error?: string | null; ai?: boolean } | null | undefined): string | null {
  if (!e) return null;
  if (e.text) return e.line ? `${e.line}${e.ai ? ` (${AI_ITEMS_NOTE})` : ''}` : null;
  if (e.error) return `${e.line ? `${e.line} · ` : ''}${ELIG_MISS}(이유: ${e.error})`;
  return e.line ?? null;
}

const s0 = (v: unknown) => { const t = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return t || null; };
/** 나라장터 API 칸(업종 제한·참가 지역) — 공고문에서 같은 종류를 이미 뽑았으면 겹쳐 쓰지 않음 */
export function apiExtra(r: Record<string, any>, items: EligItem[]): string[] {
  const out: string[] = [];
  const lic = [...new Set(String(r.license_limit ?? '').split(/\s*[/,]\s*/).map((x) => s0(x.replace(/\(\d{3,5}\)/g, ''))).filter((x): x is string => !!x))].join('·'); // '체육시설업(4993) / 체육시설업' → '체육시설업'
  if (lic && !items.some((x) => x.k === 'license')) out.push(`업종 ${lic.slice(0, 60)}`);
  const rg = s0(String(r.region_restriction ?? '').replace(/\s*·\s*/g, '·'));
  if (rg && !items.some((x) => x.k === 'region')) out.push(`지역 ${rg.slice(0, 30)}`);
  return out;
}
/** 절에 공통 문구(제26조)만 있을 때 한 줄 */
export const COMMON_ONLY = '공통 자격(사업자선정지침)만 적힘 — 별도 요건 없음';
/** 260차: 공통 문구만 있을 때 한 줄 — 나라장터 공고는 어느 법의 공통 자격인지(지방·국가계약법) */
export function commonOnly(text: string | null | undefined): string {
  const t = String(text ?? '');
  return /지방\s*자치\s*단체를\s*당사자로|지방\s*계약\s*법/.test(t) ? '공통 자격(지방계약법)만 적힘 — 별도 요건 없음'
    : /국가를\s*당사자로|국가\s*계약\s*법/.test(t) ? '공통 자격(국가계약법)만 적힘 — 별도 요건 없음' : COMMON_ONLY;
}
/** 원문 절 → 화면 한 줄(뽑은 요건 + 나라장터 API 업종·지역) */
export function lineOf(text: string, r: Record<string, any> = {}): string {
  const items = eligibilityItems(text);
  return eligibilityLine(items, text, apiExtra(r, items)) ?? commonOnly(text);
}
/** 252차 #786 참가자격 칸(목록 줄·펼치기·상세·공고 조회 같은 말) — 한 줄은 저장한 원문에서 매번 다시 뽑음(뽑기 규칙을 고치면 공고문을 다시 받지 않고 바로 반영, 253차) */
export function eligView(r: any): { line: string | null; text: string | null; error: string | null; file: string | null; fileUrl: string | null; readAt: string | null; vision: boolean; ai: boolean; aiState: string | null } {
  const e = r?.eligibility; const extra = apiExtra(r ?? {}, []);
  if (!e) return { line: extra.length ? extra.join(' · ') : null, text: null, error: null, file: null, fileUrl: null, readAt: null, vision: false, ai: false, aiState: null };
  if (e.text && e.by !== 'vision' && !eligibilitySection(e.text)) // 256차: 예전 규칙으로 잘라 저장한 절이 지금 규칙으로는 절 머리가 아님(등록 절차 안내 등) — 없는 것으로(정기 실행이 다시 읽음)
    return { line: extra.length ? extra.join(' · ') : null, text: null, error: '공고문에서 참가자격 절을 못 찾음', file: e.file?.name ?? null, fileUrl: e.file?.url ?? null, readAt: e.readAt ?? null, vision: false, ai: false, aiState: null };
  const ai = aiItemsOf(e); // 262차: 규칙으로 못 뽑은 절은 AI 가 정리한 항목(같은 절일 때만)
  const line = ai ? eligibilityLine(ai, e.text, apiExtra(r, ai)) : e.text ? lineOf(e.text, r) : e.line ?? null;
  const aiState = !ai && line === ELIG_NO_ITEMS ? aiStateOf(e) : null; // 264차: 못 뽑은 줄에 AI 상태
  return { line: aiState ? noItemsLine(aiState) : line, text: e.text ?? null, error: e.error ?? null, file: e.file?.name ?? null, fileUrl: e.file?.url ?? null, readAt: e.readAt ?? null, vision: e.by === 'vision', ai: !!ai, aiState };
}
/** #790 사진 공고문을 AI 가 읽은 것 — 원문 옆 안내 */
export const VISION_NOTE = 'AI 가 사진에서 읽음 — 숫자는 원문 확인';
