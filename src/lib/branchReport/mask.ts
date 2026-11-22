/**
 * #1096 지점 주간보고(다짐 전용) — AI 로 보내기 전에 개인정보 가림(docs/branch-report-design.md 3절).
 * 단톡방에는 직원·입주민 정보가 섞인다 → 전화번호·주민번호·카드·계좌·차량번호·동호수·이메일을 바꿔 쓴 글만 저장·전송.
 * 보낸 사람 이름은 '담당' 칸에 필요해 그대로(본문 속 입주민 이름은 가리기 어려움 — 대표 확인 사항). 이 파일은 Node 로 바로 불러 시험한다.
 */
export type MaskCounts = Record<'email' | 'rrn' | 'card' | 'phone' | 'car' | 'unit' | 'account', number>;
const RULES: [keyof MaskCounts, RegExp, string][] = [
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[이메일]'],
  ['rrn', /(?<!\d)\d{6}\s?-\s?[1-8]\d{6}(?!\d)/g, '[주민번호]'],
  ['card', /(?<!\d)\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}(?!\d)/g, '[카드]'],
  // 로컬 11/21 실측: 줄 맨 앞 목록 표시 '-' 바로 뒤에 붙은 번호(" -010-1234-5678 (")가 새던 것 — 앞의 '-'는 허용하고 숫자만 막음
  ['phone', /(?<!\d)(?:\+?82[- ]?)?0\d{1,2}[- .)]?\d{3,4}[- .]?\d{4}(?![\d-])/g, '[전화]'],
  ['phone', /(?<![\d-])1[5-9]\d{2}-\d{4}(?![\d-])/g, '[전화]'],
  // 번호판 가운데 글자만(가~호·배·육해공국합) — '12월 2026'·'30분 1000원' 같은 글은 건드리지 않게
  ['car', /(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\s?)?(?<!\d)\d{2,3}\s?[가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호육해공국합]\s?\d{4}(?!\d)/g, '[차량]'],
  ['unit', /(?<!\d)\d{1,4}\s?동\s?\d{1,4}\s?호(?!기|선|차)/g, '[호수]'],
  ['unit', /(?<![\d동])\d{3,4}\s?호(?!기|선|차|실)/g, '[호수]'],
  ['account', /(?<![\d-])\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,3})?(?![\d-])/g, '[계좌]'],
  ['account', /(?<!\d)\d{10,16}(?!\d)/g, '[계좌]'],
];
export function maskPII(text: string): { text: string; counts: MaskCounts } {
  const counts: MaskCounts = { email: 0, rrn: 0, card: 0, phone: 0, car: 0, unit: 0, account: 0 };
  let t = text;
  for (const [k, re, rep] of RULES) t = t.replace(re, () => { counts[k]++; return rep; });
  return { text: t, counts };
}

/**
 * #1117(대표 11/22 '민감한 내용은 경고 혹은 승인 후에 최종 파일이 생성될 수 있도록'): 고객사에 내기 전 규칙 검사(추가 비용 없음).
 * 걸린 곳마다 이유 · [가리기](개인정보·민원인 특정만) 또는 '그대로 두기(이유)' → 그대로 둔 것이 있으면 본사 승인 뒤에만 '고객사 제출용'.
 */
export type SensKind = 'pii' | 'resident' | 'legal' | 'internal' | 'change';
/** 표지·엑셀 첫 줄·워터마크 글 — 승인 뒤(검사 통과·승인)에만 '고객사 제출용' */
export const REVIEW_MARK = { draft: '초안 — 고객사 제출 금지', rejected: '반려됨 — 고객사 제출 금지', pending: '승인 대기 — 고객사 제출 금지', unchecked: '검사 전 제출 — 고객사 제출 금지', clean: '고객사 제출용', approved: '고객사 제출용' } as const;
export type SensHit = { kind: SensKind; match: string; reason: string; mask?: string };
export type SensFlag = SensHit & { key: string; path: string; label: string; text: string; fixIn?: 'weekly' };
const SURNAME = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경사부';
const NOT_NAME = new Set(['이용자', '이용객', '관리자', '담당자', '입주민', '고객', '회원', '대표', '원장', '강사', '선생', '코치', '매니저', '팀장', '소장', '과장', '대리', '주임', '사원', '실장', '부장', '직원', '학부모', '어머님', '아버님', '어르신', '보호자', '신청자', '민원인', '동대표', '회장', '총무', '감사', '이사', '기사', '경비', '미화', '조리', '수강생', '학생', '손님', '방문자', '이웃', '주민', '세대주', '신규', '기존', '정회원', '준회원', '일반', '개인', '단체', '전체', '모든', '여러', '해당', '이번', '지난', '다음', '여성', '남성', '성인', '유아', '아동', '고령', '장기', '단기', '우수', '연회', '정기', '임시', '무료', '유료', '이용권', '수강권', '방문객', '고객님', '부모님', '선생님', '사장', '기존회', '신규회', '유아회', '전회원', '구매자', '사용자', '참가자', '참석자', '대상자', '수요자', '지원자', '위원', '위원장', '총괄', '주무', '반장', '조장', '공지', '도우미', '부모', '수영', '수강', '사우나', '남자', '여자', '노인', '경로', '신입', '기간', '연간', '주말', '오전', '오후', '한달', '하루', '도서', '문의', '방학', '장애', '임산부', '유치', '초등', '중등', '고등', '대학', '가족', '부부', '정규', '특별', '명예', '평생', '전용', '구독', '이용', '모집', '추가', '변경', '해지', '연장', '등록', '결제', '환불', '탈퇴']);
const nameMask = (n: string) => (n.length <= 2 ? `${n[0]}*` : `${n[0]}${'*'.repeat(n.length - 2)}${n[n.length - 1]}`);
const LEGAL = /사고|부상|다쳤|다침|골절|출혈|찰과상|119|구급차|응급실|경찰|112\s?신고|보험(?:\s?처리|사|금|\s?접수)|소송|고소|고발|배상|손해(?:\s?배상|를)|책임(?:을|이)?\s?(?:지겠|지기로|인정)|(?:저희|당사|회사)\s?(?:의\s?)?(?:잘못|과실|실수)|보상(?:하겠|해\s?드리|해드리|금)|변호사|합의금|내용증명/g;
const INTERNAL = /급여|월급|연봉|시급|인건비|원가|마진|이익률|수익률|영업이익|직원\s?평가|인사\s?평가|근무\s?평가|근태\s?평가|징계|경고장|시말서|해고|권고사직|내부\s?(?:메모|자료|용|보고)|대외비|사내\s?(?:메모|용)/g;

/** 글 하나에서 걸린 곳들 — 겹치는 곳은 앞에서 먼저 찾은 것(개인정보) 하나만 */
export function scanText(text: string): SensHit[] {
  const t = String(text ?? ''); if (!t.trim()) return [];
  const out: (SensHit & { at: number; end: number })[] = [];
  const push = (h: SensHit, at: number) => { const end = at + h.match.length; if (!out.some((x) => at < x.end && end > x.at)) out.push({ ...h, at, end }); };
  for (const m of t.matchAll(/(?<!\d)(\d{1,4})\s?동\s?\d{1,4}\s?호(?!기|선|차)(\s?(?:입주민|세대|주민|거주자|회원|민원인|어르신|분))?/g)) {
    if (m[2]) push({ kind: 'resident', match: m[0], reason: '민원인을 알아볼 수 있는 표현(동·호수)', mask: m[2].trim() }, m.index!);
    else push({ kind: 'pii', match: m[0], reason: '개인정보(동·호수)', mask: `${m[1]}동` }, m.index!);
  }
  for (const m of t.matchAll(/(?<!\d)\d{6}\s?-\s?[1-8]\d{6}(?!\d)/g)) push({ kind: 'pii', match: m[0], reason: '개인정보(주민등록번호)', mask: `${m[0].slice(0, 6)}-*******` }, m.index!);
  for (const m of t.matchAll(/(?<!\d)(?:\+?82[- ]?)?(0\d{1,2})[- .)]?\d{3,4}[- .]?(\d{4})(?![\d-])/g)) push({ kind: 'pii', match: m[0], reason: '개인정보(전화번호)', mask: `${m[1]}-****-${m[2]}` }, m.index!);
  for (const m of t.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) push({ kind: 'pii', match: m[0], reason: '개인정보(이메일)', mask: `${m[0].slice(0, 2)}***@${m[0].split('@')[1]}` }, m.index!);
  for (const m of t.matchAll(/(?<!\d)(\d{2,3})\s?([가-힣])\s?\d{4}(?!\d)/g)) if (/[가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호육해공국합]/.test(m[2])) push({ kind: 'pii', match: m[0], reason: '개인정보(차량번호)', mask: `${m[1]}${m[2]}****` }, m.index!);
  for (const m of t.matchAll(/(?:생년월일|생일|출생)\s*[:：]?\s*(?:19|20)?\d{2}\s?[.\-/년]\s?\d{1,2}\s?[.\-/월]\s?\d{1,2}일?/g)) push({ kind: 'pii', match: m[0], reason: '개인정보(생년월일)', mask: '생년월일 [가림]' }, m.index!);
  for (const m of t.matchAll(new RegExp(`(?<![가-힣])([${SURNAME}][가-힣]{1,2})\\s?(님|씨|회원님|회원|고객님)`, 'g'))) { // 뒤 조사(이·께·은)는 그대로 허용
    if (NOT_NAME.has(m[1]) || NOT_NAME.has(m[1] + m[2])) continue;
    push({ kind: 'pii', match: m[0], reason: '이름으로 보이는 말', mask: `${nameMask(m[1])}${m[0].slice(m[1].length)}` }, m.index!);
  }
  for (const m of t.matchAll(LEGAL)) push({ kind: 'legal', match: m[0], reason: '사고·부상·법적 책임 표현 — 고객사 문서에 넣어도 되는지 확인' }, m.index!);
  for (const m of t.matchAll(INTERNAL)) push({ kind: 'internal', match: m[0], reason: '내부 정보(급여·원가·평가·징계·내부 메모)' }, m.index!);
  return out.sort((a, b) => a.at - b.at).map(({ at: _a, end: _e, ...h }) => h);
}

const LABEL: Record<string, string> = { usage: '이용 인원', facilities: '시설 점검', lines: '줄', issues: '특이사항', details: '세부', important: '중요업무', progress: '업무 진행', next: '차월 목표', unfinished: '미완료', resolved: '완료로 바뀐 것', issuesMonth: '이번 달 민원·특이사항', lockers: '락커' };
const FIELD: Record<string, string> = { item: '항목', count: '인원', note: '비고', name: '이름', cleaning: '청소 상태', condition: '시설 상태', status: '상태', action: '조치', title: '제목', work: '업무내용', result: '결과', task: '실천업무', focus: '중점 확인사항', goal: '업무목표', actions: '실천사항', notes: '메모' };
/** 'issues.2.details.0' → '특이사항 3 · 세부 1' */
export function pathLabel(path: string) {
  const p = path.split('.'); const out: string[] = [];
  for (let i = 0; i < p.length; i++) {
    if (LABEL[p[i]] && /^\d+$/.test(p[i + 1] ?? '')) { out.push(`${LABEL[p[i]]} ${Number(p[i + 1]) + 1}`); i++; }
    else out.push(FIELD[p[i]] ?? LABEL[p[i]] ?? p[i]);
  }
  return out.join(' · ');
}
function walk(v: unknown, path: string, cb: (path: string, text: string) => void) {
  if (typeof v === 'string') { cb(path, v); return; }
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`, cb));
}
const WEEKLY_FIELDS: [string, string[]][] = [['usage', ['item', 'count', 'note']], ['facilities', ['name', 'cleaning', 'condition']], ['issues', ['title', 'details']]];
const MONTHLY_FIELDS: [string, string[]][] = [['important', ['work', 'result']], ['progress', ['task', 'focus', 'result', 'note']], ['next', ['goal', 'actions']], ['unfinished', ['title']], ['resolved', ['title']], ['issuesMonth', ['title', 'details']]];
const keyOf = (path: string, h: SensHit) => `${path}#${h.kind}#${h.match}`;
/** 보고서 본문 전체 검사(주간·월간) — 월간 '이번 달 민원·특이사항'은 주간보고에서 온 것이라 그 주에서 고침(fixIn) */
export function scanReport(kind: 'weekly' | 'monthly', body: any, extra: { changes?: { path: string; label: string; text: string }[] } = {}): SensFlag[] {
  const out: SensFlag[] = [];
  const add = (path: string, text: string) => { for (const h of scanText(text)) out.push({ ...h, key: keyOf(path, h), path, label: pathLabel(path), text, ...(path.startsWith('issuesMonth.') ? { fixIn: 'weekly' as const } : {}) }); };
  for (const [arr, fields] of kind === 'weekly' ? WEEKLY_FIELDS : MONTHLY_FIELDS) (body?.[arr] ?? []).forEach((row: any, i: number) => { for (const f of fields) walk(row?.[f], `${arr}.${i}.${f}`, add); });
  if (kind === 'weekly') (body?.facilities ?? []).forEach((f: any, i: number) => (f?.lines ?? []).forEach((l: any, j: number) => { for (const k of ['item', 'status', 'action']) walk(l?.[k], `facilities.${i}.lines.${j}.${k}`, add); }));
  walk(body?.notes, 'notes', add);
  for (const c of extra.changes ?? []) { const h: SensHit = { kind: 'change', match: c.text, reason: '전달 대비 30% 넘는 변동 — 고객사에 설명이 필요한지 확인' }; out.push({ ...h, key: keyOf(c.path, h), path: c.path, label: c.label, text: c.text }); }
  return out;
}
/** [가리기] — 그 칸의 글에서 걸린 말만 바꿈(가릴 수 있는 것만). 바꾼 본문을 돌려줌(원본은 그대로) */
export function applyMask(body: any, flag: Pick<SensFlag, 'path' | 'match' | 'mask'>) {
  if (!flag.mask || flag.path.startsWith('issuesMonth.')) return null;
  const p = flag.path.split('.'); const copy = structuredClone(body ?? {});
  let o: any = copy; for (let i = 0; i < p.length - 1; i++) { o = o?.[/^\d+$/.test(p[i]) ? Number(p[i]) : p[i]]; if (o == null) return null; }
  const last = /^\d+$/.test(p[p.length - 1]) ? Number(p[p.length - 1]) : p[p.length - 1];
  if (typeof o[last] !== 'string' || !o[last].includes(flag.match)) return null;
  o[last] = o[last].split(flag.match).join(flag.mask);
  return copy;
}
