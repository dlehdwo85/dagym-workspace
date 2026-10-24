// #450 영업실 '지원사업' — 공고(공용 수집 + 회사 수기) × 회사 프로필 → 1차 규칙(지역·업력·규모·관심 분야) → AI 판단(✅/⚠/❌·이유·맞는 브랜드·준비 서류)
// → [관심]·[신청 준비] = 담당 업무(체크리스트) + 마감 7일·3일 전 알림 → 신청·선정·탈락 기록. 업종 중립: 회사 이름·업종을 코드에 두지 않고 회사마다 자기 프로필로 판단.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type Sql } from '../db';
import { isAdmin } from '../access';
import { assertSpace } from '../spaces';
import { HttpError, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../log';
import { notify } from '../notifications';
import { aiEnabled, anthropicProvider, costUsd, type AiProvider } from '../ai/provider';
import { tenantOf, type SessionUser } from '../types';
import { SIDO, supportKeyStatus, watchDetailText } from './collectors/support';

const ymd = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const addDays = (day: string, n: number) => ymd(new Date(Date.parse(`${day}T12:00:00+09:00`) + n * 864e5));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00+09:00`) - Date.parse(`${a}T12:00:00+09:00`)) / 864e5);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_SLUG: Record<string, string> = { bizinfo: 'bizinfo_support', kstartup: 'kstartup_support', watch: 'support_watch' };
export const SOURCE_LABEL: Record<string, string> = { bizinfo: '기업마당', kstartup: 'K-Startup', watch: '기관 공지', manual: '직접 입력' };
export const STATUS_LABEL: Record<string, string> = { interest: '관심', preparing: '신청 준비', applied: '신청 완료', selected: '선정', rejected: '탈락', dropped: '포기' };
const OPEN_WORK = ['interest', 'preparing'];
export const SIZES = ['예비창업', '소상공인', '소기업', '중기업', '중견기업'] as const;
/** 관심 분야 → 공고에서 찾을 낱말(목록에 없는 관심 분야는 그 낱말 그대로) */
export const INTEREST_WORDS: Record<string, string[]> = {
  IP: ['지식재산', '특허', '상표', '디자인권', '디자인 출원', 'IP'], 'R&D': ['R&D', '연구개발', '기술개발', '연구 개발'], 수출: ['수출', '해외', '글로벌', '바이어'], 고용: ['고용', '채용', '인력', '일자리', '인건비'],
  SaaS: ['SaaS', '소프트웨어', '클라우드', '플랫폼', '디지털 전환', 'AI'], 마케팅: ['마케팅', '홍보', '판로', '광고', '브랜드', '온라인 판매'], 창업: ['창업', '스타트업', '예비창업'], 자금: ['융자', '보증', '자금', '정책자금', '대출'],
  시설: ['시설', '설비', '리모델링', '환경 개선', '스마트공장'], 교육: ['교육', '컨설팅', '멘토링', '역량 강화'], 인증: ['인증', '시험', '검사', '표준'],
};
export const CERTS = ['벤처기업', '이노비즈', '메인비즈', '기업부설연구소', '연구개발전담부서', 'SW사업자', '여성기업', '사회적기업', '장애인기업', '소셜벤처', 'ISO'];
/** 시·군 이름(광역시·특별시·도 제외) — 제목·대상·기관에 다른 시·군이 적힌 지자체 공고를 가려내는 데 씀 */
export const SIGUNGU = new Set(('수원시 성남시 의정부시 안양시 부천시 광명시 평택시 동두천시 안산시 고양시 과천시 구리시 남양주시 오산시 시흥시 군포시 의왕시 하남시 용인시 파주시 이천시 안성시 김포시 화성시 광주시 양주시 포천시 여주시 연천군 가평군 양평군 '
  + '춘천시 원주시 강릉시 동해시 태백시 속초시 삼척시 홍천군 횡성군 영월군 평창군 정선군 철원군 화천군 양구군 인제군 고성군 양양군 청주시 충주시 제천시 보은군 옥천군 영동군 증평군 진천군 괴산군 음성군 단양군 '
  + '천안시 공주시 보령시 아산시 서산시 논산시 계룡시 당진시 금산군 부여군 서천군 청양군 홍성군 예산군 태안군 전주시 군산시 익산시 정읍시 남원시 김제시 완주군 진안군 무주군 장수군 임실군 순창군 고창군 부안군 '
  + '목포시 여수시 순천시 나주시 광양시 담양군 곡성군 구례군 고흥군 보성군 화순군 장흥군 강진군 해남군 영암군 무안군 함평군 영광군 장성군 완도군 진도군 신안군 포항시 경주시 김천시 안동시 구미시 영주시 영천시 상주시 문경시 경산시 '
  + '의성군 청송군 영양군 영덕군 청도군 고령군 성주군 칠곡군 예천군 봉화군 울진군 울릉군 창원시 진주시 통영시 사천시 김해시 밀양시 거제시 양산시 의령군 함안군 창녕군 남해군 하동군 산청군 함양군 거창군 합천군 '
  + '제주시 서귀포시 기장군 달성군 군위군 강화군 옹진군 울주군').split(' '));

export type Profile = { region_sido: string | null; region_sigungu: string | null; founded: string | null; size: string | null; employees: number | null; revenue_krw: number | null; industries: string[]; keywords: string[];
  certs: string[]; brands: string[]; interests: string[]; excludes: string[]; memo: string | null };
type Prog = { id: string; tenant: string | null; source: string; title: string; agency: string | null; executor: string | null; category: string | null; target: string | null; regions: string[]; nationwide: boolean; summary: string | null;
  apply_start: string | null; apply_end: string | null; apply_text: string | null; amount: string | null; biz_years: string | null; url: string | null; apply_url: string | null; attachments: { name: string; url: string }[]; hashtags: string[];
  posted_at: string | null; first_seen_at: string; created_by: string | null };
const COLS = (sql: Sql, summaryLen = 1500) => sql`p.id, p.tenant, p.source, p.title, p.agency, p.executor, p.category, p.target, p.regions, p.nationwide, left(p.summary, ${summaryLen}) as summary, p.apply_start::text, p.apply_end::text,
  p.apply_text, p.amount, p.biz_years, p.url, p.apply_url, p.attachments, p.hashtags, p.posted_at, p.first_seen_at, p.created_by`;

// ---------------- 회사 프로필 ----------------
const arr = z.array(z.string().trim().min(1).max(40)).max(40).default([]);
export const profileInput = z.object({
  regionSido: z.string().trim().max(10).nullable().optional(), regionSigungu: z.string().trim().max(20).nullable().optional(),
  founded: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), size: z.enum(SIZES).nullable().optional(),
  employees: z.number().int().min(0).max(1_000_000).nullable().optional(), revenueKrw: z.number().int().min(0).max(1e15).nullable().optional(),
  industries: arr, keywords: arr, certs: arr, brands: arr, interests: arr, excludes: arr, memo: z.string().trim().max(1000).nullable().optional(),
});
const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
/** 저장된 프로필, 없으면 회사 정보에서 채운 기본값(업종·본점 주소 시·도·관심 사업 이름·사업 소개) */
export async function profileOf(t: string, sql: Sql = db()): Promise<{ profile: Profile; saved: boolean; updatedAt: string | null }> {
  const [r] = await sql<any[]>`select region_sido, region_sigungu, founded::text, size, employees, revenue_krw::float8 as revenue_krw, industries, keywords, certs, brands, interests, excludes, memo, updated_at from support_profiles where tenant = ${t}`;
  if (r) return { profile: { ...r, revenue_krw: r.revenue_krw == null ? null : Number(r.revenue_krw) }, saved: true, updatedAt: r.updated_at };
  const [tn] = await sql<{ industries: string[]; industry: string | null; ai_business: string | null }[]>`select industries, industry, ai_business from tenants where id = ${t}`;
  const [cp] = await sql<{ address: string | null }[]>`select address from company_profiles where tenant = ${t} order by is_default desc, key limit 1`;
  const brands = (await sql<{ name: string }[]>`select name from sales_business_categories where tenant = ${t} and active order by sort, name`).map((x) => x.name);
  const addr = String(cp?.address ?? '').trim(); const first = addr.split(/\s+/);
  const { SIDO_ALIASES } = await import('./collectors/prospects');
  const sido = SIDO_ALIASES[first[0] ?? ''] ?? SIDO.find((s) => (first[0] ?? '').startsWith(s)) ?? null;
  const sigungu = first[1] && /(시|군|구)$/.test(first[1]) ? first[1] : null;
  return { profile: { region_sido: sido, region_sigungu: sigungu, founded: null, size: null, employees: null, revenue_krw: null, industries: clean(tn?.industries?.length ? tn.industries : tn?.industry ? [tn.industry] : []),
    keywords: [], certs: [], brands, interests: [], excludes: [], memo: tn?.ai_business ? tn.ai_business.slice(0, 1000) : null }, saved: false, updatedAt: null };
}
export async function getProfile(u: SessionUser) {
  await assertSpace(u, 'sales');
  const p = await profileOf(tenantOf(u));
  return { ...p, canEdit: isAdmin(u), sido: SIDO, sizes: SIZES, certOptions: CERTS, interestOptions: Object.keys(INTEREST_WORDS) };
}
export async function saveProfile(u: SessionUser, i: z.infer<typeof profileInput>) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('회사 프로필은 관리자만 바꿀 수 있습니다');
  if (i.regionSido && !SIDO.includes(i.regionSido)) throw badRequest('시·도를 목록에서 고르세요');
  const t = tenantOf(u); const sql = db();
  const v = { region_sido: i.regionSido ?? null, region_sigungu: i.regionSigungu || null, founded: i.founded ?? null, size: i.size ?? null, employees: i.employees ?? null, revenue_krw: i.revenueKrw ?? null,
    industries: clean(i.industries), keywords: clean(i.keywords), certs: clean(i.certs), brands: clean(i.brands), interests: clean(i.interests), excludes: clean(i.excludes), memo: i.memo || null };
  await sql`insert into support_profiles ${sql({ tenant: t, ...v, updated_by: u.id } as never)}
    on conflict (tenant) do update set region_sido = excluded.region_sido, region_sigungu = excluded.region_sigungu, founded = excluded.founded, size = excluded.size, employees = excluded.employees, revenue_krw = excluded.revenue_krw,
      industries = excluded.industries, keywords = excluded.keywords, certs = excluded.certs, brands = excluded.brands, interests = excluded.interests, excludes = excluded.excludes, memo = excluded.memo, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'support.profile', 'tenant', null, { region: v.region_sido, size: v.size, interests: v.interests.length }).catch(() => {});
  return getProfile(u);
}

// ---------------- 1차 규칙 맞춤 ----------------
export type Flag = { level: 'ok' | 'warn' | 'no'; text: string };
export type Rule = { score: number; verdict: 'fit' | 'maybe' | 'no'; flags: Flag[] };
const yearsSince = (founded: string, today: string) => Math.max(0, Math.floor((daysBetween(founded, today) / 365.25) * 10) / 10);
/** 업력 상한(년) — K-Startup 업력 칸(예: 예비창업자,1년미만,…,7년미만) · '창업 N년 이내·미만' 문구 · '창업기업'(법정 업력 7년 이내). 10년이상이 있으면 제한 없음 */
export function maxYears(p: Pick<Prog, 'biz_years' | 'target' | 'title' | 'summary'>): { max: number; strict: boolean; preOnly: boolean; why?: string } | null {
  const by = String(p.biz_years ?? '');
  if (by) {
    if (/이상/.test(by)) return null;
    const ns = [...by.matchAll(/(\d+)\s*년\s*(미만|이하|이내)/g)].map((m) => ({ n: Number(m[1]), strict: m[2] === '미만' }));
    if (ns.length) { const top = ns.sort((a, b) => b.n - a.n)[0]; return { max: top.n, strict: top.strict, preOnly: false }; }
    if (/예비\s*창업/.test(by)) return { max: 0, strict: false, preOnly: true };
  }
  const text = `${p.title} ${p.target ?? ''} ${(p.summary ?? '').slice(0, 2000)}`;
  const m = text.match(/(?:창업|업력|설립)\s*(?:후\s*)?(\d{1,2})\s*년\s*(이내|미만|이하)/);
  if (m) return { max: Number(m[1]), strict: m[2] === '미만', preOnly: false };
  if (/(?<!예비\s*)창업\s*기업/.test(`${p.title} ${p.target ?? ''}`)) return { max: 7, strict: false, preOnly: false, why: '창업기업' }; // 중소기업창업 지원법: 업력 7년 이내
  return null;
}
const base = (s: string) => s.replace(/(특별자치시|특별자치도|광역시|특별시|시|군|구)$/, '');
const termsOf = (pr: Profile) => {
  const words = new Map<string, string>(); // 낱말 → 화면 이름
  for (const i of pr.interests) for (const w of INTEREST_WORDS[i] ?? [i]) words.set(w.toLowerCase(), i);
  for (const k of [...pr.keywords, ...pr.industries]) for (const w of k.split(/[\s,·/]+/).filter((x) => x.length >= 2)) words.set(w.toLowerCase(), k);
  return words;
};
const SIGUNGU_LONG = [...SIGUNGU].sort((a, b) => b.length - a.length);
/** 글 속 시·군 — 긴 이름부터 찾고 지워서 '남양주시' 안의 '양주시' 같은 겹침을 막는다 */
/** 짧은 영문 낱말(IP·AI·R&D)은 낱말 경계로만(VIP·mail 같은 데 안 걸리게), 나머지는 포함 */
const inText = (t: string, w: string) => (/^[a-z0-9&+]{1,4}$/.test(w) ? new RegExp(`(^|[^a-z0-9])${w.replace(/[&+]/g, '\\$&')}([^a-z0-9]|$)`).test(t) : t.includes(w));
const sigunguIn = (t: string) => { let x = t; const out: string[] = []; for (const n of SIGUNGU_LONG) if (x.includes(n)) { out.push(n); x = x.split(n).join(' '); } return out; };
/** 상시근로자 조건(예: 상시근로자 5인 이상 50인 미만) */
function workerRules(t: string) { return [...t.matchAll(/상시\s*근로자\s*(?:수\s*)?(?:가\s*)?(\d{1,4})\s*(?:인|명)\s*(이상|이하|미만|초과)/g)].map((m) => ({ n: Number(m[1]), op: m[2] })); }
const workerOk = (e: number, r: { n: number; op: string }) => (r.op === '이상' ? e >= r.n : r.op === '초과' ? e > r.n : r.op === '이하' ? e <= r.n : e < r.n);
export function ruleMatch(p: Prog, pr: Profile | null, today: string): Rule {
  const flags: Flag[] = []; let score = 0;
  const title = p.title.toLowerCase(); const body = `${p.target ?? ''} ${p.summary ?? ''}`;
  const text = `${p.title} ${p.category ?? ''} ${p.target ?? ''} ${(p.hashtags ?? []).join(' ')} ${p.summary ?? ''}`.toLowerCase();
  // 기출원 건 지원 불가(IP) — 프로필과 무관하게 늘 경고
  if (/(기\s*출원|이미\s*출원|출원\s*(?:완료|된|한)\s*건)[^.\n]{0,30}(불가|제외|지원하지|지원\s*안|않)/.test(body) || /협약\s*(?:체결\s*)?(?:이\s*)?후\s*출원/.test(body))
    flags.push({ level: 'warn', text: '이미 출원한 건은 지원 불가 — 선정·협약 전에 출원하지 않기' });
  if (!pr) return { score: 0, verdict: 'maybe', flags: [...flags, { level: 'warn', text: '회사 프로필을 채우면 맞춤 판단' }] };
  const has = (c: string) => pr.certs.some((x) => x.replace(/\s/g, '').includes(c));
  // 제외어
  const ex = pr.excludes.find((w) => title.includes(w.toLowerCase()) || String(p.target ?? '').toLowerCase().includes(w.toLowerCase()));
  if (ex) { flags.push({ level: 'no', text: `제외어 '${ex}'` }); score -= 100; }
  // 지역 — 시·도
  if (p.regions?.length && pr.region_sido) {
    if (p.regions.includes(pr.region_sido)) { flags.push({ level: 'ok', text: `${pr.region_sido} 지역 공고` }); score += 20; }
    else { flags.push({ level: 'no', text: `${p.regions.join('·')} 기업 대상(우리 ${pr.region_sido})` }); score -= 100; }
  } else if (p.regions?.length && !pr.region_sido) flags.push({ level: 'warn', text: `${p.regions.join('·')} 지역 공고 — 본점 지역을 넣으면 판단` });
  // 지역 — 시·군(제목·대상·해시태그에 적힌 시·군은 강한 신호, 기관 이름에만 있으면 확인 필요)
  const strong = sigunguIn(`${p.title} ${p.target ?? ''} ${(p.hashtags ?? []).map((h) => (SIGUNGU.has(`${h}시`) ? `${h}시` : SIGUNGU.has(`${h}군`) ? `${h}군` : h)).join(' ')}`);
  const weak = sigunguIn(`${p.agency ?? ''} ${p.executor ?? ''}`).filter((n) => !strong.includes(n));
  const mine = pr.region_sigungu ? base(pr.region_sigungu.split(/\s+/)[0]) : null;
  const isMine = (n: string) => !!mine && base(n) === mine;
  if (strong.length) {
    if (strong.some(isMine)) { flags.push({ level: 'ok', text: `${pr.region_sigungu} 공고` }); score += 25; }
    else if (mine) { flags.push({ level: 'no', text: `${strong.slice(0, 2).join('·')} 공고(우리 ${pr.region_sigungu})` }); score -= 100; }
    else flags.push({ level: 'warn', text: `${strong.slice(0, 2).join('·')} 공고 — 본점 시·군을 넣으면 판단` });
  } else if (weak.length) {
    if (weak.some(isMine)) { flags.push({ level: 'ok', text: `${pr.region_sigungu} 기관 공고` }); score += 15; }
    else flags.push({ level: 'warn', text: `${weak[0]} 기관 공고 — 지역 제한 확인` });
  } else if (mine && mine.length >= 2 && `${p.title} ${p.agency ?? ''} ${p.executor ?? ''}`.includes(mine)) { flags.push({ level: 'ok', text: `${pr.region_sigungu} 공고` }); score += 25; }
  // 업력
  const my = maxYears(p);
  if (my) {
    const yrs = pr.founded ? yearsSince(pr.founded, today) : null; const cond = `${my.why ? `${my.why}(업력 ${my.max}년 이내)` : `업력 ${my.max}년 ${my.strict ? '미만' : '이내'}`}`;
    if (my.preOnly) { if (pr.founded) { flags.push({ level: 'no', text: '예비창업자 대상' }); score -= 100; } else flags.push({ level: 'warn', text: '예비창업자 대상' }); }
    else if (yrs == null) flags.push({ level: 'warn', text: `${cond} — 설립일을 넣으면 판단` });
    else if (my.strict ? yrs < my.max : yrs <= my.max) { flags.push({ level: 'ok', text: `${cond} — 우리 ${yrs}년` }); score += 10; }
    else { flags.push({ level: 'no', text: `${cond}만 — 우리 ${yrs}년` }); score -= 100; }
  }
  // 상시근로자 수
  const wr = workerRules(`${p.target ?? ''} ${(p.summary ?? '').slice(0, 2000)}`);
  if (wr.length) {
    const cond = `상시근로자 ${wr.map((r) => `${r.n}인 ${r.op}`).join(' ')}`;
    if (pr.employees == null) flags.push({ level: 'warn', text: `${cond} — 근로자 수를 넣으면 판단` });
    else if (wr.every((r) => workerOk(pr.employees!, r))) { flags.push({ level: 'ok', text: `${cond} — 우리 ${pr.employees}명` }); score += 5; }
    else { flags.push({ level: 'no', text: `${cond}만 — 우리 ${pr.employees}명` }); score -= 100; }
  }
  // 규모·대상
  const tg = `${p.target ?? ''} ${p.title}`;
  if (/소상공인/.test(tg) && !/중소기업|중소·|기업\s*및|중견/.test(tg.replace(/소상공인/g, ''))) {
    if (pr.size && ['중기업', '중견기업'].includes(pr.size)) { flags.push({ level: 'no', text: `소상공인 대상(우리 ${pr.size})` }); score -= 100; }
    else if (pr.size && ['소상공인', '소기업'].includes(pr.size)) { flags.push({ level: 'ok', text: '소상공인 대상' }); score += 5; }
    else flags.push({ level: 'warn', text: '소상공인 대상 — 규모를 넣으면 판단' });
  }
  if (/중견기업/.test(tg) && !/중소/.test(tg) && pr.size && ['소상공인', '소기업', '예비창업'].includes(pr.size)) flags.push({ level: 'warn', text: '중견기업 대상' });
  if (/(대학생|대학원생|청년\s*개인|농업인|어업인|임업인)/.test(String(p.target ?? '')) && !/기업/.test(String(p.target ?? ''))) flags.push({ level: 'warn', text: '개인·특정 대상 공고' });
  // 연구소·전담부서 / 벤처·이노비즈 / SW사업자 — 요구(또는 우대) 문구가 있을 때
  if (/(기업부설\s*연구소|연구개발\s*전담\s*부서)[^.\n]{0,20}(보유|설립|인정|있는|갖춘)/.test(body)) {
    if (has('기업부설연구소') || has('연구개발전담부서')) { flags.push({ level: 'ok', text: '연구소·전담부서 보유' }); score += 10; }
    else flags.push({ level: 'warn', text: '기업부설연구소·연구개발전담부서 보유 기업 대상(또는 우대)' });
  }
  const vc = ['벤처기업', '이노비즈', '메인비즈'].filter((c) => new RegExp(`${c}[^.\\n]{0,20}(인증|확인|보유|대상|우대)`).test(body));
  if (vc.length) {
    if (vc.some(has)) { flags.push({ level: 'ok', text: `${vc.filter(has).join('·')} 인증 보유` }); score += 10; }
    else flags.push({ level: 'warn', text: `${vc.join('·')} 인증 기업 대상(또는 우대)` });
  }
  if (/(SW|소프트웨어)\s*사업자/.test(`${p.title} ${body}`)) {
    if (has('SW사업자') || has('소프트웨어사업자')) { flags.push({ level: 'ok', text: 'SW사업자 신고 기업' }); score += 5; }
    else flags.push({ level: 'warn', text: 'SW사업자 신고 필요' });
  }
  const certHit = pr.certs.filter((c) => !/벤처|이노비즈|메인비즈|연구소|전담부서|SW|소프트웨어/.test(c) && text.includes(c.toLowerCase()));
  if (certHit.length) { flags.push({ level: 'ok', text: `${certHit.join('·')} 대상·우대 — 보유` }); score += 10; }
  // 관심 분야·검색어·업종
  const hits = new Set<string>(); let kw = 0;
  for (const [w, label] of termsOf(pr)) { if (inText(title, w)) { hits.add(label); kw += 12; } else if (inText(text, w)) { hits.add(label); kw += 6; } }
  if (hits.size) { flags.push({ level: 'ok', text: `관심: ${[...hits].slice(0, 4).join('·')}` }); score += Math.min(40, kw); }
  const verdict: Rule['verdict'] = flags.some((f) => f.level === 'no') ? 'no' : hits.size && score >= 12 ? 'fit' : 'maybe';
  return { score, verdict, flags };
}

// ---------------- 목록·상세 ----------------
type Match = { program_id: string; ai_verdict: 'fit' | 'maybe' | 'no' | null; ai_reasons: string[]; ai_brands: string[]; ai_docs: string[]; ai_summary: string | null; ai_amount: string | null; ai_at: string | null; hidden: boolean };
type Work = { id: string; program_id: string; status: string; owner_id: string | null; owner_name: string | null; task_id: string | null; brands: string[]; applied_at: string | null; result_at: string | null; amount_awarded: string | null; result_memo: string | null; memo: string | null; updated_at: string };
const RANK: Record<string, number> = { fit: 0, maybe: 1, none: 2, no: 3 };
async function disabledSources(sql: Sql, t: string) {
  const off = await sql<{ slug: string }[]>`select slug from sales_collector_settings where tenant = ${t} and not enabled and slug = any(${Object.values(SOURCE_SLUG)})`;
  const g = await sql<{ slug: string }[]>`select slug from sales_collector_state where not enabled and slug = any(${Object.values(SOURCE_SLUG)})`;
  const slugs = new Set([...off, ...g].map((x) => x.slug));
  return Object.entries(SOURCE_SLUG).filter(([, s]) => slugs.has(s)).map(([src]) => src);
}
function itemOf(p: Prog, rule: Rule, m: Match | undefined, w: Work | undefined, today: string, me: string) {
  const dday = p.apply_end ? daysBetween(today, p.apply_end) : null;
  return {
    id: p.id, title: p.title, agency: p.agency, executor: p.executor, category: p.category, source: p.source, sourceLabel: SOURCE_LABEL[p.source] ?? p.source, regions: p.regions ?? [], nationwide: p.nationwide,
    applyStart: p.apply_start, applyEnd: p.apply_end, applyText: p.apply_text, dday, amount: m?.ai_amount || p.amount, url: p.url, applyUrl: p.apply_url, manual: !!p.tenant, mine: p.created_by === me,
    isNew: Date.now() - new Date(p.first_seen_at).getTime() < 2 * 864e5 && !p.tenant, target: p.target, seen: p.first_seen_at, alsoOn: [] as string[],
    rule, ai: m?.ai_verdict ? { verdict: m.ai_verdict, reasons: m.ai_reasons ?? [], brands: m.ai_brands ?? [], docs: m.ai_docs ?? [], summary: m.ai_summary, at: m.ai_at } : null, hidden: !!m?.hidden,
    work: w ? { id: w.id, status: w.status, statusLabel: STATUS_LABEL[w.status] ?? w.status, ownerId: w.owner_id, ownerName: w.owner_name, taskId: w.task_id, brands: w.brands ?? [], appliedAt: w.applied_at, resultAt: w.result_at,
      amountAwarded: w.amount_awarded, resultMemo: w.result_memo, memo: w.memo } : null,
  };
}
export type SupportItem = ReturnType<typeof itemOf>;
const normTitle = (t: string) => t.replace(/^\s*[[(【][^\])】]{1,20}[\])】]\s*/, '').replace(/[\s·.,()[\]"'「」<>~\-]/g, '').toLowerCase();
/** 기업마당·K-Startup 에 같은 공고가 함께 올라오면 공고명+접수 마감일로 하나로(진행·AI 판단이 있는 것 > K-Startup > 기업마당 > 기관 공지) — 직접 넣은 공고는 그대로 */
function dedupe(items: SupportItem[]) {
  const pri = (x: SupportItem) => (x.work ? 0 : x.ai ? 1 : x.source === 'kstartup' ? 2 : x.source === 'bizinfo' ? 3 : 4);
  const groups = new Map<string, SupportItem[]>(); const out: SupportItem[] = [];
  for (const x of items) { if (x.manual) { out.push(x); continue; } const k = `${normTitle(x.title)}|${x.applyEnd ?? ''}`; const g = groups.get(k); if (g) g.push(x); else groups.set(k, [x]); }
  for (const g of groups.values()) { g.sort((a, b) => pri(a) - pri(b)); out.push({ ...g[0], alsoOn: [...new Set(g.slice(1).map((x) => x.sourceLabel).filter((l) => l !== g[0].sourceLabel))] }); }
  return out;
}
const rankOf = (x: SupportItem) => (x.ai ? RANK[x.ai.verdict] : x.rule.verdict === 'no' ? RANK.no : x.rule.verdict === 'fit' ? 0.5 : RANK.none);
/** 담당 고르기: 영업 공간을 쓰는 사람(관리자는 켠 공간 전부) */
async function peopleOf(sql: Sql, t: string) {
  return sql<{ id: string; name: string }[]>`select us.id, us.name from users us left join space_members m on m.user_id = us.id and m.tenant = us.tenant
    where us.tenant = ${t} and us.status = 'active' and (us.role in ('owner', 'admin') or 'sales' = any(coalesce(m.spaces, '{}'::text[]))) order by us.name`;
}
/** 탭: fit(맞춤 — 기본) · closing(마감 14일 안) · mine(관심·준비) · results(신청·결과) · all(전체 공고, 새로 들어온 순) */
export async function listView(u: SessionUser, q: { tab?: string; q?: string; showNo?: boolean; limit?: number } = {}) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const today = ymd();
  const tab = ['fit', 'closing', 'mine', 'results', 'all'].includes(q.tab ?? '') ? q.tab! : 'fit';
  const [{ profile, saved }, off, matches, works] = await Promise.all([profileOf(t, sql), disabledSources(sql, t),
    sql<Match[]>`select program_id, ai_verdict, ai_reasons, ai_brands, ai_docs, ai_summary, ai_amount, ai_at, hidden from support_matches where tenant = ${t}`,
    sql<Work[]>`select w.id, w.program_id, w.status, w.owner_id, ou.name as owner_name, w.task_id, w.brands, w.applied_at::text, w.result_at::text, w.amount_awarded, w.result_memo, w.memo, w.updated_at from support_work w left join users ou on ou.id = w.owner_id where w.tenant = ${t}`]);
  const mm = new Map(matches.map((m) => [m.program_id, m])); const wm = new Map(works.map((w) => [w.program_id, w]));
  const workIds = works.map((w) => w.program_id);
  // 열린 공고(마감 전·마감 미정) + 우리 회사 진행 중인 것(마감 지나도)
  const rows = await sql<Prog[]>`select ${COLS(sql)} from support_programs p
    where (p.tenant is null or p.tenant = ${t}) and not (p.source = any(${off}))
      and ((p.apply_end is null or p.apply_end >= ${today}::date) and (p.tenant is not null or p.last_seen_at > now() - interval '45 days') or p.id = any(${workIds}::uuid[]))
    order by p.first_seen_at desc limit 5000`;
  const pr = saved || profile.region_sido || profile.industries.length || profile.interests.length ? profile : null;
  const all = dedupe(rows.map((p) => itemOf(p, ruleMatch(p, pr, today), mm.get(p.id), wm.get(p.id), today, u.id)));
  const term = (q.q ?? '').trim().toLowerCase();
  const hit = (x: SupportItem) => !term || `${x.title} ${x.agency ?? ''} ${x.executor ?? ''} ${x.category ?? ''} ${x.target ?? ''}`.toLowerCase().includes(term);
  const open = (x: SupportItem) => x.applyEnd == null || x.applyEnd >= today;
  const isNo = (x: SupportItem) => (x.ai ? x.ai.verdict === 'no' : x.rule.verdict === 'no');
  const inTab: Record<string, (x: SupportItem) => boolean> = {
    fit: (x) => open(x) && !x.hidden && (!x.work || OPEN_WORK.includes(x.work.status)) && (q.showNo || !isNo(x)),
    closing: (x) => x.dday != null && x.dday >= 0 && x.dday <= 14 && !x.hidden && !isNo(x) && (!x.work || OPEN_WORK.includes(x.work.status)),
    mine: (x) => !!x.work && OPEN_WORK.includes(x.work.status),
    results: (x) => !!x.work && !OPEN_WORK.includes(x.work.status),
    all: (x) => open(x) || !!x.work,
  };
  const counts = Object.fromEntries(Object.entries(inTab).map(([k, f]) => [k, all.filter((x) => f(x) && hit(x)).length]));
  let items = all.filter((x) => inTab[tab](x) && hit(x));
  const end = (x: SupportItem) => x.applyEnd ?? '9999-12-31';
  if (tab === 'fit') items.sort((a, b) => rankOf(a) - rankOf(b) || b.rule.score - a.rule.score || end(a).localeCompare(end(b)));
  else if (tab === 'closing' || tab === 'mine') items.sort((a, b) => end(a).localeCompare(end(b)));
  else if (tab === 'results') items.sort((a, b) => String(wm.get(b.id)?.updated_at ?? '').localeCompare(String(wm.get(a.id)?.updated_at ?? '')));
  else items.sort((a, b) => String(b.seen).localeCompare(String(a.seen)));
  const total = items.length; items = items.slice(0, Math.min(200, q.limit ?? 60));
  const hiddenNo = tab === 'fit' && !q.showNo ? all.filter((x) => open(x) && !x.hidden && !x.work && isNo(x) && hit(x)).length : 0;
  const sources = await sql<{ slug: string; last_run_at: string | null; last_status: string | null; summary: string | null }[]>`select s.slug, s.last_run_at, s.last_status, r.summary from sales_collector_state s
    left join lateral (select summary from sales_collector_runs x where x.slug = s.slug order by started_at desc limit 1) r on true where s.slug = any(${Object.values(SOURCE_SLUG)})`;
  return { tab, today, items, total, counts, hiddenNo, profile: { saved, filled: !!pr, region: profile.region_sido, sigungu: profile.region_sigungu, size: profile.size, founded: profile.founded, interests: profile.interests, brands: profile.brands },
    sources: sources.map((s) => ({ ...s, label: SOURCE_LABEL[Object.entries(SOURCE_SLUG).find(([, v]) => v === s.slug)?.[0] ?? ''] ?? s.slug })), off,
    canEdit: isAdmin(u), platformAdmin: !!u.platformAdmin, aiOn: aiEnabled(), people: await peopleOf(sql, t), statusLabel: STATUS_LABEL,
    keys: await supportKeyStatus().then((k) => ({ bizinfo: k.bizinfo.present, datago: k.datago.present })).catch(() => ({ bizinfo: false, datago: false })) };
}
async function programFor(sql: Sql, t: string, id: string, summaryLen = 20000): Promise<Prog> {
  if (!UUID.test(id)) throw notFound();
  const [p] = await sql<Prog[]>`select ${COLS(sql, summaryLen)} from support_programs p where p.id = ${id} and (p.tenant is null or p.tenant = ${t})`;
  if (!p) throw notFound('공고를 찾을 수 없습니다');
  return p;
}
export async function detailView(u: SessionUser, id: string) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const today = ymd();
  const p = await programFor(sql, t, id);
  const { profile, saved } = await profileOf(t, sql);
  const [m] = await sql<Match[]>`select program_id, ai_verdict, ai_reasons, ai_brands, ai_docs, ai_summary, ai_amount, ai_at, hidden from support_matches where tenant = ${t} and program_id = ${id}`;
  const [w] = await sql<Work[]>`select w.id, w.program_id, w.status, w.owner_id, ou.name as owner_name, w.task_id, w.brands, w.applied_at::text, w.result_at::text, w.amount_awarded, w.result_memo, w.memo, w.updated_at from support_work w left join users ou on ou.id = w.owner_id where w.tenant = ${t} and w.program_id = ${id}`;
  const log = w ? await sql`select l.from_status, l.to_status, l.note, l.changed_at, us.name as by from support_work_log l left join users us on us.id = l.changed_by where l.work_id = ${w.id} order by l.changed_at desc limit 30` : [];
  const [task] = w?.task_id ? await sql<{ id: string; title: string; status: string; due_date: string | null; total: number; done: number }[]>`select t.id, t.title, t.status, t.due_date::text,
    (select count(*)::int from task_checklist_items ci where ci.task_id = t.id) total, (select count(*)::int from task_checklist_items ci where ci.task_id = t.id and ci.done) done from tasks t where t.id = ${w.task_id} and t.deleted_at is null` : [];
  const pr = saved || profile.region_sido || profile.industries.length || profile.interests.length ? profile : null;
  return { item: itemOf(p, ruleMatch(p, pr, today), m, w, today, u.id), summary: p.summary, target: p.target, hashtags: p.hashtags ?? [], attachments: p.attachments ?? [], applyText: p.apply_text, bizYears: p.biz_years,
    log, task: task ?? null, canEdit: isAdmin(u), canEditProgram: !!p.tenant && (p.created_by === u.id || isAdmin(u)), aiOn: aiEnabled(), people: await peopleOf(sql, t), statusLabel: STATUS_LABEL };
}

// ---------------- AI 판단 ----------------
const SCHEMA = { type: 'object', additionalProperties: false, required: ['verdict', 'reasons', 'brands', 'docs', 'summary', 'amount'], properties: {
  verdict: { type: 'string', enum: ['fit', 'maybe', 'no'] }, reasons: { type: 'array', items: { type: 'string' } }, brands: { type: 'array', items: { type: 'string' } },
  docs: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, amount: { type: ['string', 'null'] } } };
const profileText = (pr: Profile, today: string) => [
  `본점: ${[pr.region_sido, pr.region_sigungu].filter(Boolean).join(' ') || '(모름)'}`, `설립일: ${pr.founded ? `${pr.founded} (업력 ${yearsSince(pr.founded, today)}년)` : '(모름)'}`,
  `규모: ${pr.size ?? '(모름)'}${pr.employees != null ? ` · 상시 근로자 ${pr.employees}명` : ''}${pr.revenue_krw != null ? ` · 연 매출 약 ${Math.round(pr.revenue_krw / 1e8 * 10) / 10}억 원` : ''}`,
  `업종: ${pr.industries.join(', ') || '(모름)'}`, `키워드: ${pr.keywords.join(', ') || '-'}`, `보유 인증: ${pr.certs.join(', ') || '없음(또는 모름)'}`,
  `브랜드·사업부: ${pr.brands.join(', ') || '-'}`, `관심 분야: ${pr.interests.join(', ') || '-'}`, pr.memo ? `회사 소개: ${pr.memo.slice(0, 600)}` : ''].filter(Boolean).join('\n');
const programText = (p: Prog) => [`공고명: ${p.title}`, `원천: ${SOURCE_LABEL[p.source] ?? p.source}`, p.agency && `소관 기관: ${p.agency}`, p.executor && `수행 기관: ${p.executor}`, p.category && `지원 분야: ${p.category}`,
  p.target && `지원 대상: ${p.target}`, p.biz_years && `업력 조건: ${p.biz_years}`, `지역: ${p.regions?.length ? p.regions.join(', ') : '전국 또는 표시 없음'}`,
  `신청 기간: ${p.apply_text ?? ([p.apply_start, p.apply_end].filter(Boolean).join(' ~ ') || '표시 없음')}`, p.amount && `지원 규모(공고 문구): ${p.amount}`, (p.hashtags ?? []).length && `해시태그: ${p.hashtags.join(', ')}`,
  `공고 내용:\n${(p.summary ?? '(본문 없음 — 제목·기관만 있음)').slice(0, 9000)}`].filter(Boolean).join('\n');
/** 공고 1건 AI 판단 — 회사 AI 한도(AI 세일즈)·사람별 한도. 결과는 회사별로 저장(다시 누르면 새로 판단) */
export async function analyzeProgram(u: SessionUser, id: string, provider: AiProvider = anthropicProvider({ tier: 'fast' })) {
  await assertSpace(u, 'sales');
  if (!aiEnabled()) throw new HttpError(503, 'ai_off', 'AI 가 설정되지 않았습니다 — 플랫폼 운영자에게 요청해 주세요');
  const t = tenantOf(u); const sql = db(); const today = ymd();
  let p = await programFor(sql, t, id);
  await (await import('../plans')).assertAiRequest(u, { legacy: true }); // 회사 월 AI 예산(원)·예전 달러 한도·요청 수
  await (await import('../ai/guard')).assertUserBudget(u, sql);
  await (await import('../ai/guard')).assertAiCredit(sql);
  if (p.source === 'watch' && !p.summary && p.url) { // 기관 공지: 본문을 한 번 읽어 둔다(같은 호스트만)
    const body = await watchDetailText(p.url).catch(() => null);
    if (body) { await sql`update support_programs set summary = ${body}, updated_at = now() where id = ${p.id}`; p = { ...p, summary: body }; }
  }
  const { profile } = await profileOf(t, sql);
  const brands = clean([...profile.brands, ...(await sql<{ name: string }[]>`select name from sales_business_categories where tenant = ${t} and active`).map((x) => x.name)]);
  const system = `워크인 AI 세일즈의 지원사업 검토 도우미입니다. 정부·지자체 지원사업 공고 1건과 신청을 검토하는 회사 프로필을 받습니다.
공고에 적힌 내용과 회사 프로필만 근거로 판단하고, 공고에 없는 조건·금액·서류는 지어내지 마세요. 모르는 것은 '공고문 확인 필요'라고 쓰세요. 한국어로.
JSON 으로만 답하세요:
- verdict: fit(자격이 맞고 회사 사업과 맞음) · maybe(조건 일부를 확인해야 함) · no(지역·업력·규모·대상 등 자격이 안 됨)
- reasons: 판단 근거 2~5줄. 한 줄마다 공고 조건과 회사 정보를 맞대어(예: "○○시 소재 중소기업 대상 — 본점 ○○시라 해당").
  공고에 있으면 꼭 대조할 자격: 본점 시·군 · 업력(창업기업 = 7년 이내) · 상시근로자 수 · 기업부설연구소/연구개발전담부서 · 벤처/이노비즈 인증 · SW사업자 신고 · 기출원 건 지원 불가(지식재산 — 선정·협약 전 출원 금지) · 중복 수혜 제한
- brands: 이 공고에 맞는 브랜드·사업부(아래 목록에서만 고름, 없으면 빈 배열): ${brands.join(', ') || '(없음)'}
- docs: 공고에 적힌 신청·제출 서류(최대 12개, 짧게). 공고에 서류 목록이 없으면 빈 배열
- summary: 공고 요약 2~3문장(무엇을, 누구에게, 얼마나)
- amount: 지원 규모 한 줄(공고 문구 그대로 요약), 없으면 null
오늘: ${today} (Asia/Seoul).`;
  const ask = `[회사 프로필]\n${profileText(profile, today)}\n\n[공고]\n${programText(p)}`;
  let r;
  try { r = await provider.chat({ system, tools: [], format: SCHEMA, messages: [{ role: 'user', content: [{ type: 'text', text: ask }] }] }); }
  catch (e) { throw await (await import('../ai/guard')).onAiError(e, sql); }
  const usd = costUsd(r.model ?? provider.model, r.usage);
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${t}, ${u.id}, ${randomUUID()}, ${provider.name}, ${r.model ?? provider.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0}, ${r.usage.cache_creation_input_tokens ?? 0}, ${usd}, 'sales_support')`;
  if (r.stop_reason === 'refusal') throw badRequest('이 공고는 판단할 수 없습니다');
  const text = r.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
  let j: any; try { j = JSON.parse(text); } catch { throw new HttpError(502, 'ai_bad_output', 'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.'); }
  const lines = (v: unknown, n: number, len: number) => (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim().slice(0, len)).filter(Boolean).slice(0, n);
  const verdict = ['fit', 'maybe', 'no'].includes(j.verdict) ? j.verdict : 'maybe';
  const out = { verdict, reasons: lines(j.reasons, 5, 300), brands: lines(j.brands, 6, 40).filter((b) => brands.includes(b)), docs: lines(j.docs, 12, 120), summary: String(j.summary ?? '').slice(0, 800) || null,
    amount: j.amount ? String(j.amount).slice(0, 120) : null };
  await sql`insert into support_matches (tenant, program_id, ai_verdict, ai_reasons, ai_brands, ai_docs, ai_summary, ai_amount, ai_model, ai_cost_usd, ai_by, ai_at)
    values (${t}, ${p.id}, ${out.verdict}, ${sql.json(out.reasons)}, ${out.brands}, ${sql.json(out.docs)}, ${out.summary}, ${out.amount}, ${r.model ?? provider.model}, ${usd}, ${u.id}, now())
    on conflict (tenant, program_id) do update set ai_verdict = excluded.ai_verdict, ai_reasons = excluded.ai_reasons, ai_brands = excluded.ai_brands, ai_docs = excluded.ai_docs, ai_summary = excluded.ai_summary,
      ai_amount = excluded.ai_amount, ai_model = excluded.ai_model, ai_cost_usd = excluded.ai_cost_usd, ai_by = excluded.ai_by, ai_at = now(), updated_at = now()`;
  await (await import('../ai/guard')).userBudgetAlerts(u, sql).catch(() => {});
  const { usdKrw } = await import('../ai/provider');
  return { ok: true, ai: { ...out, at: new Date().toISOString() }, costKrw: Math.max(1, Math.round(usd * usdKrw())) };
}
/** 맞춤 순 위에서 아직 판단 안 한 공고 최대 5건 — 관리자 */
export async function analyzeTop(u: SessionUser, n = 5) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('여러 건 판단은 관리자만');
  const v = await listView(u, { tab: 'fit', limit: 200 });
  const todo = v.items.filter((x) => !x.ai && x.rule.verdict !== 'no').slice(0, Math.min(5, n));
  const rs = await Promise.allSettled(todo.map((x) => analyzeProgram(u, x.id)));
  const failed = rs.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  return { asked: todo.length, done: rs.length - failed.length, failed: failed.length, error: failed[0] ? String(failed[0].reason?.message ?? failed[0].reason) : null };
}

// ---------------- 진행(관심 → 신청 준비 → 신청 → 선정/탈락) ----------------
export const workInput = z.object({
  status: z.enum(['interest', 'preparing', 'applied', 'selected', 'rejected', 'dropped']).optional(),
  ownerId: z.string().uuid().nullable().optional(), brands: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  appliedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), resultAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  amountAwarded: z.string().trim().max(100).nullable().optional(), resultMemo: z.string().trim().max(2000).nullable().optional(), memo: z.string().trim().max(2000).nullable().optional(),
});
const STEPS_INTEREST = ['공고문·자격 요건 확인', '신청 여부 결정(신청 준비로 바꾸기)'];
const STEPS_PREPARE = ['공고문·신청 양식 내려받기', '신청서 작성', '온라인 제출·접수 확인'];
/** 담당 업무 — 없으면 만들고(체크리스트), 신청 준비로 바뀌면 제목·마감·서류 체크리스트를 채운다 */
async function ensureTask(sql: Sql, u: SessionUser, p: Prog, w: { id: string; status: string; owner_id: string | null; task_id: string | null }, docs: string[]) {
  const today = ymd(); const prep = w.status === 'preparing';
  const due = p.apply_end ? (prep ? p.apply_end : (() => { const d = addDays(p.apply_end!, -7); return d < today ? (p.apply_end! < today ? today : p.apply_end!) : d; })()) : null;
  const title = `[지원사업] ${p.title.slice(0, 100)} — ${prep ? '신청 준비' : '검토'}`;
  const steps = prep ? [...docs.map((d) => `서류: ${d}`), ...(docs.length ? [] : ['준비 서류 목록 정리(공고문 기준)']), ...STEPS_PREPARE] : STEPS_INTEREST;
  if (w.task_id) {
    const [cur] = await sql<{ id: string; status: string }[]>`select id, status from tasks where id = ${w.task_id} and deleted_at is null`;
    if (cur) {
      if (prep) {
        const have = new Set((await sql<{ text: string }[]>`select text from task_checklist_items where task_id = ${cur.id}`).map((x) => x.text));
        const [{ n }] = await sql<{ n: number }[]>`select coalesce(max(sort), 0)::int n from task_checklist_items where task_id = ${cur.id}`;
        let k = n + 1; for (const s of steps) if (!have.has(s)) await sql`insert into task_checklist_items (task_id, text, sort) values (${cur.id}, ${s}, ${k++})`;
        await sql`update tasks set title = ${title}, due_date = coalesce(${due}::date, due_date), status = case when status = 'done' then 'todo' else status end, updated_at = now(), version = version + 1 where id = ${cur.id}`;
      }
      return cur.id;
    }
  }
  const { createTask } = await import('../tasks');
  const owner = w.owner_id ?? u.id;
  const desc = [`지원사업 공고에서 만든 업무입니다 — /s/sales/support?id=${p.id}`, p.agency && `기관: ${[p.agency, p.executor].filter(Boolean).join(' · ')}`, `신청 기간: ${p.apply_text ?? ([p.apply_start, p.apply_end].filter(Boolean).join(' ~ ') || '공고문 확인')}`,
    p.amount && `지원 규모: ${p.amount}`, p.url && `공고: ${p.url}`, '마감 7일·3일 전에 알림이 갑니다. 신청하면 지원사업 화면에서 [신청 완료]로 바꾸세요.'].filter(Boolean).join('\n');
  const r = await createTask(u, { title, description: desc, space: 'sales', assigneeId: owner, requestedById: u.id, dueDate: due, approvalRequired: false, tags: ['영업', '지원사업'], checklist: steps } as never, { quiet: owner === u.id, skipQuota: true });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'support', id: p.id, name: p.title.slice(0, 120) })} where id = ${r.id}`;
  if ((p.attachments ?? []).length) (await import('./autoAttach')).attachSourceFilesLater(u, { kind: 'support', id: p.id, taskIds: [r.id] }); // #507 공고 첨부 자동
  return r.id;
}
export async function saveWork(u: SessionUser, id: string, i: z.infer<typeof workInput>) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const today = ymd();
  const p = await programFor(sql, t, id);
  if (i.ownerId && !(await peopleOf(sql, t)).some((x) => x.id === i.ownerId)) throw badRequest('영업 공간을 쓰는 사람만 담당으로 고를 수 있습니다');
  const [prev] = await sql<{ id: string; status: string; owner_id: string | null; task_id: string | null }[]>`select id, status, owner_id, task_id from support_work where tenant = ${t} and program_id = ${p.id}`;
  if (!prev && !i.status) throw badRequest('먼저 관심·신청 준비 중 하나를 고르세요');
  const status = i.status ?? prev!.status;
  const owner = i.ownerId !== undefined ? i.ownerId : prev?.owner_id ?? u.id;
  const v = { status, owner_id: owner, ...(i.brands ? { brands: clean(i.brands) } : {}), ...(i.memo !== undefined ? { memo: i.memo } : {}), ...(i.amountAwarded !== undefined ? { amount_awarded: i.amountAwarded } : {}),
    ...(i.resultMemo !== undefined ? { result_memo: i.resultMemo } : {}),
    applied_at: i.appliedAt !== undefined ? i.appliedAt : status === 'applied' && prev?.status !== 'applied' ? today : undefined,
    result_at: i.resultAt !== undefined ? i.resultAt : ['selected', 'rejected'].includes(status) && prev?.status !== status ? today : undefined };
  const set = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
  let w: { id: string; status: string; owner_id: string | null; task_id: string | null };
  if (prev) [w] = await sql<typeof w[]>`update support_work set ${sql(set as never)}, updated_by = ${u.id}, updated_at = now() where id = ${prev.id} returning id, status, owner_id, task_id`;
  else [w] = await sql<typeof w[]>`insert into support_work ${sql({ tenant: t, program_id: p.id, created_by: u.id, updated_by: u.id, ...set } as never)} returning id, status, owner_id, task_id`;
  if (!prev || prev.status !== status) await sql`insert into support_work_log (work_id, from_status, to_status, note, changed_by) values (${w.id}, ${prev?.status ?? null}, ${status}, ${i.resultMemo ?? i.memo ?? null}, ${u.id})`;
  // 업무: 관심·준비 = 만들기/채우기, 신청·결과·포기 = 열린 업무 완료
  let taskId = w.task_id;
  if (OPEN_WORK.includes(status) && (!prev || prev.status !== status || !w.task_id)) {
    const [m] = await sql<{ ai_docs: string[] }[]>`select ai_docs from support_matches where tenant = ${t} and program_id = ${p.id}`;
    taskId = await ensureTask(sql, u, p, w, Array.isArray(m?.ai_docs) ? m.ai_docs : []);
    if (taskId !== w.task_id) await sql`update support_work set task_id = ${taskId} where id = ${w.id}`;
  } else if (!OPEN_WORK.includes(status) && w.task_id) await sql`update tasks set status = 'done', completed_at = now(), updated_at = now(), version = version + 1 where id = ${w.task_id} and status <> 'done' and deleted_at is null`;
  if (taskId && prev && owner && owner !== prev.owner_id && OPEN_WORK.includes(status)) { // 담당이 바뀌면 열린 업무도 넘김
    await sql`update tasks set assignee_id = ${owner}, updated_at = now(), version = version + 1 where id = ${taskId} and status <> 'done' and deleted_at is null`;
    await notify(sql, { userIds: [owner], type: 'assigned', space: 'sales', title: `지원사업 담당: ${p.title.slice(0, 60)}`, body: `${u.name}님이 담당으로 지정했습니다${p.apply_end ? ` — 마감 ${p.apply_end}` : ''}`, link: `/s/sales/support?id=${p.id}`, actorId: u.id, dedupeKey: `support:owner:${w.id}:${owner}` } as never).catch(() => {});
  }
  await audit(sql, u.id, 'support.work', 'support_program', p.id, { from: prev?.status ?? null, to: status }).catch(() => {});
  return detailView(u, p.id);
}
export async function setHidden(u: SessionUser, id: string, hidden: boolean) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const p = await programFor(sql, t, id, 0);
  await sql`insert into support_matches (tenant, program_id, hidden) values (${t}, ${p.id}, ${hidden}) on conflict (tenant, program_id) do update set hidden = excluded.hidden, updated_at = now()`;
  return { ok: true, hidden };
}

// ---------------- 직접 입력(지난 신청 이력·목록에 없는 공고) ----------------
export const manualInput = z.object({
  title: z.string().trim().min(2, '공고명을 적어 주세요').max(300), agency: z.string().trim().max(100).nullable().optional(), url: z.string().trim().url().regex(/^https?:\/\//).nullable().optional().or(z.literal('')),
  applyStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), applyEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), amount: z.string().trim().max(100).nullable().optional(),
  summary: z.string().trim().max(5000).nullable().optional(), region: z.string().trim().max(10).nullable().optional(),
  status: z.enum(['interest', 'preparing', 'applied', 'selected', 'rejected', 'dropped']).optional(), appliedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  resultMemo: z.string().trim().max(2000).nullable().optional(), memo: z.string().trim().max(2000).nullable().optional(), brands: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});
export async function addManual(u: SessionUser, i: z.infer<typeof manualInput>) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db();
  if (i.applyStart && i.applyEnd && i.applyStart > i.applyEnd) throw badRequest('신청 시작일이 마감일보다 늦습니다');
  const region = i.region && SIDO.includes(i.region) ? [i.region] : [];
  const [p] = await sql<{ id: string }[]>`insert into support_programs ${sql({ tenant: t, source: 'manual', source_id: randomUUID(), title: i.title, agency: i.agency || null, url: i.url || null, apply_start: i.applyStart ?? null, apply_end: i.applyEnd ?? null,
    apply_text: [i.applyStart, i.applyEnd].filter(Boolean).join(' ~ ') || null, amount: i.amount || null, summary: i.summary || null, regions: region, nationwide: !region.length, created_by: u.id } as never)} returning id`;
  await audit(sql, u.id, 'support.manual', 'support_program', p.id, { title: i.title.slice(0, 80), status: i.status ?? null }).catch(() => {});
  if (i.status) return saveWork(u, p.id, { status: i.status, appliedAt: i.appliedAt ?? undefined, resultMemo: i.resultMemo ?? undefined, memo: i.memo ?? undefined, brands: i.brands });
  return detailView(u, p.id);
}
export const manualPatch = manualInput.partial().omit({ status: true, appliedAt: true, resultMemo: true, memo: true, brands: true });
export async function editManual(u: SessionUser, id: string, i: z.infer<typeof manualPatch>) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const p = await programFor(sql, t, id, 0);
  if (!p.tenant || (p.created_by !== u.id && !isAdmin(u))) throw forbidden('직접 넣은 공고만, 넣은 사람·관리자가 고칠 수 있습니다');
  const v: Record<string, unknown> = {};
  if (i.title !== undefined) v.title = i.title; if (i.agency !== undefined) v.agency = i.agency || null; if (i.url !== undefined) v.url = i.url || null;
  if (i.applyStart !== undefined) v.apply_start = i.applyStart; if (i.applyEnd !== undefined) v.apply_end = i.applyEnd; if (i.amount !== undefined) v.amount = i.amount || null; if (i.summary !== undefined) v.summary = i.summary || null;
  if (i.region !== undefined) { const r = i.region && SIDO.includes(i.region) ? [i.region] : []; v.regions = r; v.nationwide = !r.length; }
  if (i.applyStart !== undefined || i.applyEnd !== undefined) { const s = i.applyStart !== undefined ? i.applyStart : p.apply_start; const e = i.applyEnd !== undefined ? i.applyEnd : p.apply_end; v.apply_text = [s, e].filter(Boolean).join(' ~ ') || null; }
  if (Object.keys(v).length) await sql`update support_programs set ${sql(v as never)}, updated_at = now() where id = ${p.id}`;
  return detailView(u, p.id);
}
export async function deleteManual(u: SessionUser, id: string) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const p = await programFor(sql, t, id, 0);
  if (!p.tenant || (p.created_by !== u.id && !isAdmin(u))) throw forbidden('직접 넣은 공고만, 넣은 사람·관리자가 지울 수 있습니다');
  const [w] = await sql<{ task_id: string | null }[]>`select task_id from support_work where tenant = ${t} and program_id = ${p.id}`;
  if (w?.task_id) await sql`update tasks set status = 'done', completed_at = now(), updated_at = now(), version = version + 1 where id = ${w.task_id} and status <> 'done' and deleted_at is null`;
  await sql`delete from support_programs where id = ${p.id} and tenant = ${t}`;
  await audit(sql, u.id, 'support.manual_delete', 'support_program', p.id, { title: p.title.slice(0, 80) }).catch(() => {});
  return { ok: true };
}

// ---------------- 알림·홈 카드 ----------------
/** 마감 7일·3일 전 담당자 알림(관심·신청 준비) — tick 마다, KST 08~20시에만. 3일 안에 처음 잡힌 건은 3일 전 알림 하나만 */
export async function supportTick(opt: { now?: Date } = {}) {
  const now = opt.now ?? new Date(); const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(now)) % 24;
  const [h0, h1] = (process.env.SUPPORT_REMIND_HOURS ?? '8-20').split('-').map(Number); // 시험은 0-24
  if (hour < h0 || hour >= h1) return { sent: 0, skipped: 'quiet' };
  const sql = db(); const today = ymd(now);
  const rows = await sql<{ id: string; tenant: string; status: string; owner_id: string | null; created_by: string | null; remind7_at: string | null; remind3_at: string | null; program_id: string; title: string; apply_end: string }[]>`
    select w.id, w.tenant, w.status, w.owner_id, w.created_by, w.remind7_at, w.remind3_at, p.id as program_id, p.title, p.apply_end::text from support_work w join support_programs p on p.id = w.program_id
    where w.status in ('interest', 'preparing') and p.apply_end between ${today}::date and ${addDays(today, 7)}::date and (w.remind3_at is null and p.apply_end <= ${addDays(today, 3)}::date or w.remind7_at is null) limit 200`;
  let sent = 0;
  for (const r of rows) {
    const d = daysBetween(today, r.apply_end); const three = d <= 3;
    if (!three && r.remind7_at) continue;
    const to = [r.owner_id ?? r.created_by].filter(Boolean) as string[];
    if (to.length) {
      await notify(sql, { userIds: to, type: 'support_deadline', space: 'sales', title: `지원사업 마감 ${d === 0 ? '오늘' : `D-${d}`}: ${r.title.slice(0, 60)}`, body: `${STATUS_LABEL[r.status]} 상태 — 신청 마감 ${r.apply_end}${r.status === 'interest' ? ' · 신청할지 정해 주세요' : ' · 서류·신청서를 확인하세요'}`,
        link: `/s/sales/support?id=${r.program_id}`, dedupeKey: `support_deadline:${r.id}:${three ? 3 : 7}`, push: true } as never).catch(() => {});
      sent++;
    }
    if (three) await sql`update support_work set remind3_at = now(), remind7_at = coalesce(remind7_at, now()) where id = ${r.id}`;
    else await sql`update support_work set remind7_at = now() where id = ${r.id}`;
  }
  return { sent, checked: rows.length };
}
/** 영업 홈 카드 '마감 임박 지원사업 n건' — 7일 안 마감: 우리가 관심·준비 중인 것 + 맞춤(관심 분야 맞음, 숨김·해당 없음 제외) */
export async function supportHomeCard(t: string, sql: Sql = db()) {
  const today = ymd(); const until = addDays(today, 7);
  const { profile, saved } = await profileOf(t, sql);
  const pr = saved || profile.region_sido || profile.industries.length || profile.interests.length ? profile : null;
  const off = await disabledSources(sql, t);
  const rows = await sql<(Prog & { status: string | null; hidden: boolean | null; ai_verdict: string | null })[]>`select ${COLS(sql)}, w.status, m.hidden, m.ai_verdict from support_programs p
    left join support_work w on w.program_id = p.id and w.tenant = ${t} left join support_matches m on m.program_id = p.id and m.tenant = ${t}
    where (p.tenant is null or p.tenant = ${t}) and not (p.source = any(${off})) and p.apply_end between ${today}::date and ${until}::date limit 2000`;
  let mine = 0, fit = 0;
  for (const r of rows) {
    if (r.status) { if (OPEN_WORK.includes(r.status)) mine++; continue; }
    if (r.hidden || !pr) continue;
    const v = r.ai_verdict ?? ruleMatch(r, pr, today).verdict;
    if (v === 'fit') fit++;
  }
  return { closing: mine + fit, mine, fit };
}
