import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db';
import { isAdmin } from '../access';
import { assertSpace } from '../spaces';
import { badRequest, forbidden, notFound } from '../errors';
import { aiEnabled, anthropicProvider, costUsd } from '../ai/provider';
import { tenantOf, type SessionUser } from '../types';

/** V41 단계 3(V40): 영업 공간 공공데이터 — 원천은 공용 1벌, 회사는 켠 원천·검색어·지역·제외어(필터)와 진행 상태만 */
export const COMMON = ['15081808', '3046071', '15129462']; // 공통: 국세청 상태조회(정리용) · 국민연금 사업장(규모) · 나라장터 발주계획

/** V40 (c) AI 자동 세팅 규칙표 — 승인된 원천 번호만(활용신청 35건) */
export const RULES: { key: string; label: string; words: string[]; sources: string[]; keywords: string[] }[] = [
  { key: 'facility', label: '건물청소·시설관리·경비', words: ['청소', '시설관리', '경비', '미화', '방역', '소독', '관리용역'], sources: ['15058453', '15057332', '15154949', '15154982'], keywords: ['청소용역', '시설관리', '경비용역', '미화'] },
  { key: 'sports', label: '체육시설 위탁운영·스포츠센터', words: ['체육', '헬스', '피트니스', '스포츠', '수영', '위탁운영', '커뮤니티'], sources: ['15155077', '15155071', '15155038'], keywords: ['체육시설 위탁', '민간위탁', '생활체육', '커뮤니티', '피트니스'] },
  { key: 'interior', label: '실내건축·인테리어', words: ['인테리어', '실내건축', '리모델링', '실내'], sources: ['15098547', '15057999', '15134735'], keywords: ['인테리어', '실내건축', '리모델링'] },
  { key: 'mep', label: '기계설비·전기·소방', words: ['설비', '전기', '소방', '승강기', '기계', 'LED'], sources: ['15061362', '15134735'], keywords: ['기계설비', '소방', '승강기', 'LED'] },
  { key: 'security', label: '보안·CCTV·출입통제·네트워크', words: ['보안', 'CCTV', '출입', '네트워크', '정보통신', '통신'], sources: ['15154948', '3048029', '15155066'], keywords: ['CCTV', '출입통제', '통합보안', '네트워크'] },
  { key: 'food', label: '식자재·식품 유통', words: ['식자재', '식품', '급식', '외식', '유통'], sources: ['15155168', '15155159', '15154916', '15154921'], keywords: ['식자재', '급식'] },
  { key: 'medical', label: '의료기기·의료소모품', words: ['의료', '병원', '의원', '요양', '약국'], sources: ['15001698', '15051043', '15059029', '15058856', '15154874', '15154458'], keywords: ['의료기기', '의료소모품'] },
  { key: 'factory', label: '부품·원료·포장재 납품', words: ['제조', '부품', '원료', '포장', '공장'], sources: ['15087611', '15155150'], keywords: ['부품', '원료', '포장재'] },
  { key: 'lodging', label: '숙박 린넨·어메니티·숙박 솔루션', words: ['숙박', '호텔', '모텔', '린넨', '어메니티', '펜션'], sources: ['15155124'], keywords: ['숙박', '린넨', '어메니티'] },
  // 로컬 10/19 예시: 아파트 커뮤니티 = 나라장터 입찰·입주 예정 단지·관리사무소 / 헬스장 = 지역 기업·학교·신규 오피스
  { key: 'apartment', label: '아파트 커뮤니티·관리 서비스', words: ['아파트', '커뮤니티', '입주', '관리사무소', '공동주택', '단지'], sources: ['15057332', '15058453', '15098547', '15057999'], keywords: ['커뮤니티 위탁', '입주자대표회의', '관리사무소'] },
  { key: 'gym', label: '헬스장·피트니스(기업·학교 제휴)', words: ['헬스장', 'PT', '필라테스', '요가', '짐'], sources: ['3046071', '15158963', '15134735'], keywords: ['기업 제휴', '임직원 복지', '신규 오피스'] },
  { key: 'logistics', label: '물류·창고 설비·운송', words: ['물류', '창고', '운송', '택배', '지게차'], sources: ['3048029', '15155066'], keywords: ['물류', '운송', '창고'] },
];
/** 원천마다 '왜 쓰는지' 한 줄(추천 근거) — 화면에 그대로 */
const WHY: Record<string, string> = {
  '15081808': '휴·폐업한 거래처를 걸러 목록을 깨끗하게',
  '3046071': '직원 수로 지역 기업 규모를 보고 제휴·영업 우선순위를 정함',
  '15129462': '공공기관이 올해 살 계획(발주계획)을 미리 봄',
  '15129427': '누가 어떤 계약을 얼마에 땄는지 — 경쟁·단가 참고',
  '15129468': '기관의 조달 요청 — 입찰 전 단계',
  '15057332': '관리사무소·입주자대표회의에 직접 제안할 단지 목록',
  '15058453': '단지 규모·세대수·관리 방식 — 큰 단지부터',
  '15098547': '입주 예정·신규 분양 단지 — 입주 전 미리 제안',
  '15057999': 'LH 분양·임대 공고 — 새로 생기는 단지',
  '15134735': '새로 준공·용도변경된 건물(신규 오피스·상가)',
  '15061362': '건설업체 목록 — 협력사·하도급 영업',
  '15154949': '건물위생관리업 등록 업체 — 경쟁·협력사',
  '15154982': '소독업 등록 업체',
  '15155077': '체력단련장(헬스장) 인허가 — 새로 연 곳·폐업한 곳',
  '15155071': '종합체육시설 — 위탁 운영 대상',
  '15155038': '수영장 — 위탁·관리 대상',
  '15154948': '대규모 점포 — 보안·시설 영업',
  '15155066': '물류창고업체 — 설비·보안·운송',
  '3048029': '물류창고 등록 정보',
  '15155168': '집단급식소 — 식자재 납품처',
  '15155159': '위탁급식 영업 — 식자재·급식 협력',
  '15154916': '일반음식점 인허가 — 신규 개업',
  '15154921': '휴게음식점(카페) 인허가 — 신규 개업',
  '15001698': '병원 목록 — 의료기기·소모품',
  '15051043': '요양기관 개·폐업 — 새로 연 곳',
  '15059029': '장기요양기관 — 요양 시설 영업',
  '15058856': '장기요양기관 상세(정원·규모)',
  '15154874': '의원 인허가', '15154458': '병원 인허가',
  '15087611': '공장 등록 — 부품·원료 납품처',
  '15155150': '식품 제조·가공업',
  '15155124': '숙박업 인허가 — 린넨·어메니티',
  '15158963': '학교(대학) 목록 — 학생·교직원 제휴',
};
const SIDO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const SIDO_LONG: Record<string, string> = { 서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원도: '강원', 강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주' };
export const sidoOf = (addr?: string | null) => { const w = String(addr ?? '').trim().split(/\s+/)[0] ?? ''; return SIDO_LONG[w] ?? SIDO.find((s) => w.startsWith(s)) ?? null; };
export const attribution = (s: { provider: string; license: string }) => `출처: ${s.provider}, 공공데이터포털${s.license === 'kogl3' ? ' (변경금지 — 원문 그대로)' : s.license === 'kogl1' ? ' (공공누리 제1유형)' : ''}`;

export async function listSources(u: SessionUser) {
  await assertSpace(u, 'sales');
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<any[]>`select s.code, s.name, s.provider, s.license, s.grp, s.category, s.refresh, s.collect, s.last_run_at, s.last_count,
      coalesce(ts.enabled, false) as enabled, coalesce(ts.keywords, '{}') as keywords, coalesce(ts.regions, '{}') as regions, coalesce(ts.excludes, '{}') as excludes,
      (select count(*)::int from prospects p where p.source_code = s.code) as total
    from data_sources s left join tenant_data_sources ts on ts.source_code = s.code and ts.tenant = ${t}
    where s.license <> 'noncommercial' order by s.grp, s.name`;
  const [st] = await sql<any[]>`select industry, region, setup_done_at from sales_settings where tenant = ${t}`;
  const [pf] = await sql<any[]>`select industry, industries, ai_business, ai_customers from tenants where id = ${t}`;
  const custom = await sql<any[]>`select id, kind, label, value, note, created_at from sales_custom_sources where tenant = ${t} order by created_at`;
  return { sources: rows.map((r) => ({ ...r, common: COMMON.includes(r.code), attribution: attribution(r), why: WHY[r.code] ?? null })), settings: st ?? null, canEdit: isAdmin(u), rules: RULES.map((r) => ({ key: r.key, label: r.label })),
    // 회사 정보(업종·사업 소개·주요 고객)로 추천 칸을 미리 채움
    profile: { industry: (pf?.industries?.length ? pf.industries.join('·') : pf?.industry) ?? null, industries: pf?.industries ?? [], business: pf?.ai_business ?? null, customers: pf?.ai_customers ?? null }, custom };
}

const words = z.array(z.string().trim().min(1).max(40)).max(30);
export const sourceInput = z.object({ enabled: z.boolean(), keywords: words.optional(), regions: z.array(z.string().max(10)).max(17).optional(), excludes: words.optional() });
export async function setSource(u: SessionUser, code: string, i: z.infer<typeof sourceInput>) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('원천 설정은 관리자만 바꿀 수 있습니다');
  const sql = db();
  if (!(await sql`select 1 from data_sources where code = ${code} and license <> 'noncommercial'`).length) throw notFound('원천을 찾을 수 없습니다');
  const regions = (i.regions ?? []).filter((r) => SIDO.includes(r));
  await sql`insert into tenant_data_sources (tenant, source_code, enabled, keywords, regions, excludes, updated_by) values (${tenantOf(u)}, ${code}, ${i.enabled}, ${i.keywords ?? []}, ${regions}, ${i.excludes ?? []}, ${u.id})
    on conflict (tenant, source_code) do update set enabled = excluded.enabled, keywords = coalesce(${i.keywords ?? null}, tenant_data_sources.keywords),
      regions = coalesce(${i.regions ? regions : null}, tenant_data_sources.regions), excludes = coalesce(${i.excludes ?? null}, tenant_data_sources.excludes), updated_by = excluded.updated_by, updated_at = now()`;
  return { ok: true };
}

/** AI 자동 세팅: 업태·종목(또는 업종 키워드)·지역 → 켤 원천·검색어 추천. AI 가 없으면 규칙표 낱말 일치로. 맞는 행이 없으면 공통만 + 키워드 3개 질문 */
export const suggestInput = z.object({ industry: z.string().trim().min(1, '업태·종목이나 하는 일을 적어 주세요').max(200), region: z.string().trim().max(40).optional(), product: z.string().trim().max(200).optional() });
export async function suggestSources(u: SessionUser, i: z.infer<typeof suggestInput>) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('자동 세팅은 관리자만 할 수 있습니다');
  const region = sidoOf(i.region) ?? SIDO.find((s) => (i.region ?? '').includes(s)) ?? null;
  const byRule = (keys: string[]) => {
    const rs = RULES.filter((r) => keys.includes(r.key));
    return { rules: rs.map((r) => r.label), sources: [...new Set([...COMMON, ...rs.flatMap((r) => r.sources)])], keywords: [...new Set(rs.flatMap((r) => r.keywords))].slice(0, 8) };
  };
  const text = `${i.industry} ${i.product ?? ''}`.toLowerCase();
  let keys = RULES.filter((r) => r.words.some((w) => text.includes(w.toLowerCase()))).map((r) => r.key);
  let extra: string[] = []; let via = 'rules';
  // 회사 월 AI 예산(원)을 다 썼으면 AI 없이 규칙으로만(대표 10/24 ②)
  if (aiEnabled() && await (await import('../plans')).assertAiRequest(u).then(() => true, () => false)) {
    const p = anthropicProvider({ tier: 'fast' });
    try {
      const r = await p.chat({
        system: `영업 공공데이터 자동 세팅. 회사의 업태·종목 설명을 보고 아래 규칙 중 맞는 것(0~3개)과, 공고·목록 검색에 쓸 짧은 검색어(최대 6개, 회사가 파는 것)를 고릅니다. 맞는 규칙이 없으면 빈 배열. JSON 만.
규칙: ${RULES.map((x) => `${x.key}=${x.label}`).join(' / ')}`,
        tools: [], messages: [{ role: 'user', content: [i.industry, i.product ? `주력 상품: ${i.product}` : ''].filter(Boolean).join('\n') }],
        format: { type: 'object', additionalProperties: false, required: ['rules', 'keywords'], properties: { rules: { type: 'array', items: { type: 'string', enum: RULES.map((x) => x.key) } }, keywords: { type: 'array', items: { type: 'string' } } } },
      });
      await db()`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
        values (${tenantOf(u)}, ${u.id}, ${randomUUID()}, 'anthropic', ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${costUsd(r.model ?? p.model, r.usage)}, 'sales_setup')`;
      const o = JSON.parse((r.content as any[]).find((b) => b.type === 'text')?.text ?? '{}');
      const ai = (Array.isArray(o.rules) ? o.rules : []).filter((k: string) => RULES.some((x) => x.key === k));
      if (ai.length) keys = [...new Set([...ai, ...keys])].slice(0, 3);
      extra = (Array.isArray(o.keywords) ? o.keywords : []).map((x: unknown) => String(x).trim()).filter((x: string) => x && x.length <= 20).slice(0, 6);
      via = 'ai';
    } catch { /* AI 실패 → 규칙표 */ }
  }
  const s = byRule(keys);
  // 로컬 10/19: 추천마다 근거 한 줄 + 체크로 고름(모두 선택형). 입찰·공고도 쓰는 업종만 추천(아파트·시설·체육 위탁 등)
  const names = new Map((await db()<{ code: string; name: string }[]>`select code, name from data_sources where code = any(${s.sources})`).map((r) => [r.code, r.name]));
  const ruleOf = (code: string) => RULES.find((r) => keys.includes(r.key) && r.sources.includes(code));
  const items = s.sources.map((code) => ({ code, name: names.get(code) ?? code, why: `${WHY[code] ?? '업종에 맞는 공공데이터'}${ruleOf(code) ? ` (${ruleOf(code)!.label})` : COMMON.includes(code) ? ' (모든 업종 공통)' : ''}`, common: COMMON.includes(code) }));
  const bidsRec = keys.some((k) => ['facility', 'sports', 'apartment', 'mep', 'security', 'food', 'medical'].includes(k));
  const out = { ...s, items, bids: { recommend: bidsRec, why: bidsRec ? '이 업종은 공공기관·단지 입찰로 일감이 나옵니다(나라장터)' : '이 업종은 입찰이 드물어 꺼 두기를 권합니다(나중에 켤 수 있음)' },
    keywords: [...new Set([...extra, ...s.keywords])].slice(0, 8), regions: region ? [region] : [], via, askKeywords: keys.length === 0 };
  await db()`insert into sales_settings (tenant, industry, region, last_suggestion) values (${tenantOf(u)}, ${i.industry}, ${region}, ${db().json(out as never)})
    on conflict (tenant) do update set industry = excluded.industry, region = excluded.region, last_suggestion = excluded.last_suggestion, updated_at = now()`;
  return out;
}
export const applyInput = z.object({ sources: z.array(z.string().max(20)).min(1).max(40), keywords: words, regions: z.array(z.string().max(10)).max(17), bids: z.boolean().optional() });
export async function applySuggestion(u: SessionUser, i: z.infer<typeof applyInput>) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('자동 세팅은 관리자만 할 수 있습니다');
  const sql = db(); const t = tenantOf(u);
  const known = new Set((await sql<{ code: string }[]>`select code from data_sources where code = any(${i.sources}) and license <> 'noncommercial'`).map((r) => r.code));
  if (!known.size) throw badRequest('켤 원천이 없습니다');
  const regions = i.regions.filter((r) => SIDO.includes(r));
  for (const code of known) {
    await sql`insert into tenant_data_sources (tenant, source_code, enabled, keywords, regions, updated_by) values (${t}, ${code}, true, ${i.keywords}, ${regions}, ${u.id})
      on conflict (tenant, source_code) do update set enabled = true, keywords = excluded.keywords, regions = excluded.regions, updated_by = excluded.updated_by, updated_at = now()`;
  }
  await sql`insert into sales_settings (tenant, setup_done_at) values (${t}, now()) on conflict (tenant) do update set setup_done_at = now(), updated_at = now()`;
  if (i.bids !== undefined) await sql`update tenants set sales_bids = ${i.bids} where id = ${t}`; // 입찰·공고 사용 여부도 같이(체크로 고른 대로)
  return { enabled: [...known] };
}

/** 로컬 10/19: 목록 밖 출처(사이트·키워드·엑셀) 직접 추가 — 관리자만, 자동 수집은 아님(영업 출처 기록) */
export const customSourceInput = z.object({ kind: z.enum(['site', 'keyword', 'excel']), label: z.string().trim().min(1, '이름을 적어 주세요').max(80), value: z.string().trim().max(500).optional(), note: z.string().trim().max(300).optional() });
export async function addCustomSource(u: SessionUser, i: z.infer<typeof customSourceInput>) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('영업 출처는 관리자가 추가합니다');
  if (i.kind === 'site' && i.value && !/^https?:\/\/\S+$/.test(i.value)) throw badRequest('사이트 주소는 https:// 로 시작해야 합니다');
  const sql = db();
  if ((await sql`select count(*)::int n from sales_custom_sources where tenant = ${tenantOf(u)}`)[0].n >= 100) throw badRequest('직접 추가한 출처는 100개까지입니다');
  const [r] = await sql<{ id: string }[]>`insert into sales_custom_sources (tenant, kind, label, value, note, created_by) values (${tenantOf(u)}, ${i.kind}, ${i.label}, ${i.value ?? null}, ${i.note ?? null}, ${u.id}) returning id`;
  return { id: r.id };
}
export async function removeCustomSource(u: SessionUser, id: string) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('영업 출처는 관리자가 지웁니다');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const r = await db()`delete from sales_custom_sources where id = ${id} and tenant = ${tenantOf(u)} returning id`;
  if (!r.length) throw notFound();
  return { ok: true };
}

/** 영업기회 목록: 회사가 켠 원천 × (지역·검색어·제외어) — 원천 데이터는 공용, 진행 상태·메모는 회사별 */
export async function listProspects(u: SessionUser, q: { status?: string; source?: string; q?: string; limit?: number }) {
  await assertSpace(u, 'sales');
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<any[]>`select p.id, p.name, p.address, p.sido, p.status as biz_status, to_char(p.opened_on, 'YYYY-MM-DD') as opened_on, to_char(p.closed_on, 'YYYY-MM-DD') as closed_on,
      p.category, p.detail, to_char(coalesce(p.base_date, p.fetched_at::date), 'YYYY-MM-DD') as base_date, s.code as source_code, s.name as source_name, s.provider, s.license,
      coalesce(tp.status, 'new') as status, tp.memo
    from prospects p join data_sources s on s.code = p.source_code
    join tenant_data_sources ts on ts.source_code = p.source_code and ts.tenant = ${t} and ts.enabled
    left join tenant_prospects tp on tp.prospect_id = p.id and tp.tenant = ${t}
    where (cardinality(ts.regions) = 0 or p.sido = any(ts.regions))
      and (cardinality(ts.keywords) = 0 or s.category = 'permit' or exists (select 1 from unnest(ts.keywords) k where p.name ilike '%' || k || '%' or coalesce(p.category, '') ilike '%' || k || '%'))
      and not exists (select 1 from unnest(ts.excludes) x where p.name ilike '%' || x || '%')
      and (${q.source ?? ''} = '' or p.source_code = ${q.source ?? ''})
      and (${q.q ?? ''} = '' or p.name ilike ${'%' + (q.q ?? '') + '%'} or coalesce(p.address, '') ilike ${'%' + (q.q ?? '') + '%'})
      and (${q.status ?? ''} = '' or coalesce(tp.status, 'new') = ${q.status ?? ''})
      and (${q.status ?? ''} = 'skip' or coalesce(tp.status, 'new') <> 'skip')
    order by p.opened_on desc nulls last, p.id desc limit ${Math.min(q.limit ?? 100, 300)}`;
  return { prospects: rows.map((r) => ({ ...r, attribution: attribution(r) })) };
}
export const prospectInput = z.object({ status: z.enum(['new', 'contacting', 'lead', 'skip']).optional(), memo: z.string().max(2000).optional() });
export async function setProspect(u: SessionUser, id: number, i: z.infer<typeof prospectInput>) {
  await assertSpace(u, 'sales');
  const sql = db(); const t = tenantOf(u);
  // 회사가 켠 원천의 영업기회만(다른 원천 id 를 넣어도 404)
  const [ok] = await sql`select 1 from prospects p join tenant_data_sources ts on ts.source_code = p.source_code and ts.tenant = ${t} and ts.enabled where p.id = ${id}`;
  if (!ok) throw notFound('영업기회를 찾을 수 없습니다');
  await sql`insert into tenant_prospects (tenant, prospect_id, status, memo, updated_by) values (${t}, ${id}, ${i.status ?? 'new'}, ${i.memo ?? null}, ${u.id})
    on conflict (tenant, prospect_id) do update set status = coalesce(${i.status ?? null}, tenant_prospects.status), memo = coalesce(${i.memo ?? null}, tenant_prospects.memo), updated_by = excluded.updated_by, updated_at = now()`;
  return { ok: true };
}
