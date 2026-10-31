// 239차(#743·#744 대표 10/28 '입찰공고 목록에서 파일 열기 전에 참가자격 확인' · '현장설명회 일시도 표기'):
// 공고 줄(K-apt 상세 칸·나라장터 API 칸)에서 참가 조건 한 줄·펼치기 표·현장설명을 만든다 — 목록·상세·공고 조회·메일이 같은 말을 쓰게 한 곳에서
type Row = Record<string, any>;
const s0 = (v: unknown) => { const t = v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); return t || null; };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** '2026-11-02T10:00:00+09:00' → '11/2(일) 10:00'(서울) */
export function mdhm(iso: string | null | undefined): string | null {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/); if (!m) return null;
  const dow = DOW[new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+09:00`).getUTCDay()];
  return `${Number(m[2])}/${Number(m[3])}(${dow})${m[4] && !(m[4] === '23' && m[5] === '59') ? ` ${m[4]}:${m[5]}` : ''}`;
}
export type Briefing = { kind: string | null; at: string | null; place: string | null; required: boolean };
/** 현장설명 — 종류(필수·임의·없음·공고문 참조)·일시·장소. 일시도 종류도 없거나 '없음'이면 null */
export function briefingOf(r: Row): Briefing | null {
  // 280차: KG2B 상세의 현장설명(실제 입찰 사이트 값)을 K-apt '공고문 참조'보다 먼저
  const kind = s0(r.kg2b_briefing_kind) ?? s0(r.site_briefing_kind); const at = s0(r.site_briefing_at ?? r.briefing_at) ?? s0(r.kg2b_briefing_at); const place = s0(r.site_briefing_place);
  if (kind === '없음' || (!at && !kind)) return null;
  return { kind, at, place, required: kind === '필수' };
}
/** '현장설명 필수 11/2(일) 10:00 · 생활지원센터 회의실' · 필수 여부를 원문 칸이 '공고문 참조'로 둔 공고는 그 말을 붙임 */
export function briefingLine(r: Row): string | null {
  const b = briefingOf(r); if (!b) return null;
  const ref = b.kind === '공고문 참조';
  if (ref && !b.at && !b.place) return '현장설명 공고문 참조';
  return [`현장설명${b.kind && !ref ? ` ${b.kind}` : ''}${b.at ? ` ${mdhm(b.at)}` : ''}`, b.place, ref ? '필수 여부 공고문 참조' : null].filter(Boolean).join(' · ');
}
const yes = (v: unknown) => s0(v) === '제출';
/** 참가 조건 한 줄 — '적격심사 · 제한경쟁 · 신용평가 제출 · 실적증명 제출 · 보증금 5% · 업종 제한 ○○ · 지역 제한 ○○ · 공고문 참조: 구비서류'
 *  252차 #786: 화면 이름은 '입찰 방식' — limits:false 면 업종·지역·공동수급(참가자격 줄로 옮김)은 뺌 */
export function termsLine(r: Row, o: { limits?: boolean } = {}): string | null {
  const parts: string[] = []; const refs: string[] = [];
  const award = s0(r.award_method); if (award) parts.push(award);
  const kind = s0(r.contract_method); if (kind && kind !== award) parts.push(kind);
  const cert = (v: unknown, label: string) => { const t = s0(v); if (!t) return; if (yes(t)) parts.push(`${label} 제출`); else if (/공고문/.test(t)) refs.push(label); };
  cert(r.credit_rating_cert, '신용평가'); cert(r.performance_cert, '실적증명');
  const docs = s0(r.bid_docs); if (docs && /공고문/.test(docs)) refs.push('구비서류');
  const bond = s0(r.bid_bond); if (bond) { const pct = bond.match(/(\d+(?:\.\d+)?)\s*%/); if (pct) parts.push(`보증금 ${pct[1]}%`); else if (/공고문/.test(bond)) refs.push('보증금'); }
  if (o.limits !== false) {
    const lic = s0(r.license_limit ?? r.industry_code); if (lic) parts.push(`업종 제한 ${lic.slice(0, 40)}`);
    const reg = s0(r.region_restriction); if (reg) parts.push(`지역 제한 ${reg.slice(0, 30)}`);
    const joint = s0(r.joint_bid); if (joint) parts.push(`공동수급 ${joint.slice(0, 20)}`);
  }
  if (refs.length) parts.push(`공고문 참조: ${refs.join('·')}`);
  return parts.length ? parts.join(' · ') : null;
}
/** 펼치기 표 — 값이 있는 칸만 */
export function termsRows(r: Row): [string, string][] {
  const rows: [string, string | null][] = [
    ['낙찰 방법', s0(r.award_method)], ['입찰 종류', s0(r.contract_method)], ['입찰 방법', s0(r.bid_method)],
    ['신용평가등급확인서', s0(r.credit_rating_cert)], ['실적증명서', s0(r.performance_cert)], ['입찰 구비서류', s0(r.bid_docs)], ['입찰 보증금', s0(r.bid_bond)],
    ['서류 제출 마감', r.docs_deadline_at && s0(r.docs_deadline_at) !== s0(r.deadline_at) ? mdhm(r.docs_deadline_at) : null], ['현장설명', briefingLine(r)?.replace(/^현장설명\s*/, '') ?? null],
    ['업종·면허 제한', s0(r.license_limit ?? r.industry_code)], ['지역 제한', s0(r.region_restriction)], ['공동수급', s0(r.joint_bid)],
    ['긴급 입찰', r.urgent_bid === true ? '긴급' : null], ['지급 조건', s0(r.payment_terms)],
  ];
  return rows.filter((x): x is [string, string] => !!x[1]);
}
