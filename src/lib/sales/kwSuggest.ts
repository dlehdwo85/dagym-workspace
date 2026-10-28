import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type Sql } from '../db';
import { isAdmin } from '../access';
import { forbidden } from '../errors';
import { audit } from '../log';
import { assertSpace } from '../spaces';
import { tenantOf, type SessionUser } from '../types';
import { aiEnabled, anthropicProvider, costUsd } from '../ai/provider';
import { passPrefs, prefsOf, savePrefs, type Prefs } from './digest';
import { listBizCats } from './bizCats';
import { salesBidsOn } from './options';

/**
 * 224차 #457(대표 '관심 사업 검수 + AI 세일즈가 추천·분석해서 넣기'): 관심 검색어·제외어 추천.
 * 근거 = 이 회사가 진행한 공고(검토중·연락중·보류·입찰 진행·진행영업 전환) ↔ [대상 아님] 공고(사유), 지난 180일 · 놓친 공고 = 지난 30일 공고 중 지금 설정에 안 걸린 것.
 * 추천마다 숫자(진행 n · 대상 아님 m · 지난 30일 더 보일/가려질 공고 k)는 서버가 직접 셈(AI 말만 믿지 않음). 제외어가 진행한 공고를 가리면 '위험'으로 표시하고 미리 고르지 않음.
 * [추천 받기] = AI(회사 월 AI 예산 안 — 다 썼거나 AI 가 없으면 낱말 세기) · 월 1회 정기 = AI 없이 낱말 세기 + 놓친 공고 후보만 알림.
 */
const POS = ['검토중', '연락중', '보류', '입찰 진행', '진행영업 전환'];
const SKIP = /대상\s?아님/;
const STOP = new Set(['공고', '입찰', '용역', '사업', '사업자', '선정', '업체', '모집', '구매', '변경', '정정', '재공고', '긴급', '일반', '제한', '경쟁', '협상', '계약', '수의', '공개', '안내', '관련', '위한', '추진', '년도', '지원', '시행', '설치', '교체', '공사', '관리', '운영', '위탁', '용역의', '건', '차']);
type Row = Record<string, any>;
export type KwItem = { word: string; why: string; pos: number; neg: number; more: number; hidden: number; risky?: boolean };
export type KwSuggestion = { at: string; via: 'ai' | 'rules'; add: KwItem[]; exclude: KwItem[]; remove: KwItem[]; missed: { id: string; title: string; word: string }[]; base: { pos: number; neg: number; pool: number } };
const titleOf = (r: Row) => String(r.title ?? r.notice_title ?? r.bid_name ?? '').trim();
const hay = (r: Row) => `${r.title ?? ''} ${r.bid_category ?? ''} ${r.task_scope ?? ''}`.replace(/\s+/g, '').toUpperCase(); // passPrefs 와 같은 기준
const key = (w: string) => w.replace(/\s+/g, '').toUpperCase();
const clean = (w: unknown) => String(w ?? '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 30);

async function signals(sql: Sql, t: string) {
  const work = await sql<{ id: string; status: string; reason: string | null; row: Row }[]>`select w.ref_id as id, w.status, w.data->>'skip_reason' as reason, n.row from (
      select distinct on (ref_id) ref_id, status, data from sales_work_records where tenant = ${t} and src_tbl = 'opportunity_work' and ref_id is not null and updated_at > now() - interval '180 days'
      order by ref_id, updated_at desc) w
    join sales_src_rows n on n.scope = 'global' and n.tbl = 'procurement_notices' and n.src_id = w.ref_id limit 800`;
  const pool = await sql<{ id: string; row: Row }[]>`select src_id as id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and synced_at > now() - interval '30 days'
    order by synced_at desc limit 4000`;
  const done = new Set(work.map((w) => w.id));
  return { pos: work.filter((w) => POS.includes(w.status)), neg: work.filter((w) => SKIP.test(w.status)), pool: pool.filter((p) => !done.has(p.id)) };
}
type Sig = Awaited<ReturnType<typeof signals>>;
/** 낱말 하나의 숫자: 진행·대상 아님 공고에 몇 번 · 넣으면 지난 30일에 더 보일 공고(관심 검색어) / 가려질 공고(제외어) */
function measure(word: string, kind: 'add' | 'exclude' | 'remove', s: Sig, p: Prefs) {
  const k = key(word);
  const pos = s.pos.filter((x) => hay(x.row).includes(k)).length, neg = s.neg.filter((x) => hay(x.row).includes(k)).length;
  let more = 0, hidden = 0; const newly: { id: string; title: string }[] = [];
  if (kind === 'add') { const p2 = { ...p, keywords: [...p.keywords, word] }; for (const r of s.pool) if (hay(r.row).includes(k) && !passPrefs(r.row, p).ok && passPrefs(r.row, p2).ok) { more++; if (newly.length < 5) newly.push({ id: r.id, title: titleOf(r.row) }); } }
  if (kind === 'exclude') { const p2 = { ...p, excludes: [...p.excludes, word] }; for (const r of s.pool) if (hay(r.row).includes(k) && passPrefs(r.row, p).ok && !passPrefs(r.row, p2).ok) hidden++; }
  if (kind === 'remove') { const p2 = { ...p, keywords: p.keywords.filter((w) => key(w) !== k) }; for (const r of s.pool) if (passPrefs(r.row, p).ok && !passPrefs(r.row, p2).ok) hidden++; }
  return { pos, neg, more, hidden, newly };
}
/** AI 없이: 진행한 공고 제목에 자주 나오는 낱말(대상 아님에는 드문 것) · 대상 아님에만 자주 나오는 낱말 · 진행한 공고에는 없고 대상 아님에만 걸리는 지금 검색어 */
function byRules(s: Sig, p: Prefs) {
  const tokens = (r: Row) => new Set(titleOf(r).split(/[^0-9A-Za-z가-힣]+/).map((w) => w.trim()).filter((w) => w.length >= 2 && w.length <= 10 && !/^\d+$/.test(w) && !STOP.has(w)));
  const df = (rows: { row: Row }[]) => { const m = new Map<string, number>(); for (const r of rows) for (const w of tokens(r.row)) m.set(w, (m.get(w) ?? 0) + 1); return m; };
  const P = df(s.pos), N = df(s.neg);
  const has = (list: string[], w: string) => list.some((x) => key(x).includes(key(w)) || key(w).includes(key(x)));
  const add = [...P].filter(([w, n]) => n >= 2 && n - 2 * (N.get(w) ?? 0) > 0 && !has(p.keywords, w) && !has(p.excludes, w)).sort((a, b) => (b[1] - 2 * (N.get(b[0]) ?? 0)) - (a[1] - 2 * (N.get(a[0]) ?? 0)) || b[1] - a[1]).slice(0, 6)
    .map(([w, n]) => ({ word: w, why: `진행한 공고 ${n}건 제목에 있음` }));
  const exclude = [...N].filter(([w, n]) => n >= 2 && !P.get(w) && !has(p.excludes, w) && !has(p.keywords, w)).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([w, n]) => ({ word: w, why: `대상 아님 공고 ${n}건 제목에 있고 진행한 공고에는 없음` }));
  const remove = p.keywords.map((w) => ({ w, pos: s.pos.filter((x) => hay(x.row).includes(key(w))).length, neg: s.neg.filter((x) => hay(x.row).includes(key(w))).length }))
    .filter((x) => x.pos === 0 && x.neg >= 2).map((x) => ({ word: x.w, why: `진행한 공고 0건 · 대상 아님 ${x.neg}건에만 걸림` }));
  return { add, exclude, remove };
}
const AI_FORMAT = { type: 'object', additionalProperties: false, required: ['add', 'exclude', 'remove'], properties: Object.fromEntries(['add', 'exclude', 'remove'].map((k) => [k, { type: 'array', items: { type: 'object', additionalProperties: false, required: ['word', 'why'], properties: { word: { type: 'string' }, why: { type: 'string' } } } }])) };
async function byAi(u: SessionUser, s: Sig, p: Prefs) {
  if (!aiEnabled() || !(await (await import('../plans')).assertAiRequest(u).then(() => true, () => false))) return null; // 회사 월 AI 예산을 다 썼으면 낱말 세기로
  const cats = await listBizCats(tenantOf(u));
  const line = (r: { row: Row; reason?: string | null }) => `- ${titleOf(r.row).slice(0, 80)}${r.reason ? ` (사유: ${String(r.reason).slice(0, 40)})` : ''}`;
  const prov = anthropicProvider({ tier: 'fast' });
  try {
    const r = await prov.chat({
      system: `당신은 공공 입찰 영업 담당입니다. 회사가 실제로 진행한 공고와 '대상 아님'으로 넘긴 공고를 비교해 공고 맞춤 설정을 다듬습니다. JSON 만.
- add: 새로 넣을 관심 검색어(최대 6) — 진행한 공고 제목에 실제로 나오는 짧은 낱말(2~12자), 이미 있는 검색어와 겹치지 않게
- exclude: 넣을 제외어(최대 6) — 대상 아님 공고에만 나오고 진행한 공고에는 없는 낱말
- remove: 뺄 지금 관심 검색어(최대 4) — 대상 아님 공고만 끌어오는 것
- why: 한 줄 근거(어느 공고들 때문인지). 회사 이름·원가·외부 서비스 이름은 쓰지 않음`,
      tools: [], format: AI_FORMAT,
      messages: [{ role: 'user', content: [
        `관심 사업: ${cats.map((c) => `${c.name}(${c.keywords.slice(0, 8).join(', ')})`).join(' / ') || '없음'}`,
        `지금 관심 검색어: ${p.keywords.join(', ') || '없음'} · 제외어: ${p.excludes.join(', ') || '없음'}`,
        `[진행한 공고 ${s.pos.length}건]`, ...s.pos.slice(0, 60).map(line),
        `[대상 아님 공고 ${s.neg.length}건]`, ...s.neg.slice(0, 60).map(line)].join('\n') }],
    });
    await db()`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
      values (${tenantOf(u)}, ${u.id}, ${randomUUID()}, 'anthropic', ${r.model ?? prov.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${costUsd(r.model ?? prov.model, r.usage)}, 'sales_kw_suggest')`;
    const o = JSON.parse((r.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('') || '{}');
    const list = (v: unknown) => (Array.isArray(v) ? v : []).map((x: any) => ({ word: clean(x?.word), why: clean(x?.why).slice(0, 120) || 'AI 추천' })).filter((x) => x.word.length >= 2 && x.word.length <= 12);
    return { add: list(o.add), exclude: list(o.exclude), remove: list(o.remove) };
  } catch { return null; } // AI 실패 → 낱말 세기
}
/** 추천 만들기(숫자는 서버가 셈) — AI 결과가 근거 없으면 버리고, 낱말 세기 결과로 채움 */
export async function buildKwSuggestion(tenant: string, opt: { user?: SessionUser; ai?: boolean } = {}): Promise<KwSuggestion> {
  const sql = db(); const p = await prefsOf(tenant); const s = await signals(sql, tenant);
  const rules = byRules(s, p);
  const ai = opt.ai && opt.user ? await byAi(opt.user, s, p) : null;
  const seen = new Set<string>();
  const pick = (kind: 'add' | 'exclude' | 'remove', items: { word: string; why: string }[], cap: number) => {
    const out: KwItem[] = [];
    for (const it of items) {
      const k = `${kind}:${key(it.word)}`; if (seen.has(k) || out.length >= cap) continue;
      if (kind === 'remove' && !p.keywords.some((w) => key(w) === key(it.word))) continue; // 지금 검색어만 뺄 수 있음
      if (kind !== 'remove' && [...p.keywords, ...p.excludes].some((w) => key(w) === key(it.word))) continue;
      const m = measure(it.word, kind, s, p);
      if (kind === 'add' && !m.pos && !m.more) continue; // 근거 없는 낱말은 버림
      if (kind === 'exclude' && !m.neg) continue;
      seen.add(k); out.push({ word: it.word, why: it.why, pos: m.pos, neg: m.neg, more: m.more, hidden: m.hidden, ...(kind === 'exclude' && m.pos ? { risky: true } : {}) });
    }
    return out;
  };
  const add = pick('add', [...(ai?.add ?? []), ...rules.add], 6), exclude = pick('exclude', [...(ai?.exclude ?? []), ...rules.exclude], 6), remove = pick('remove', [...(ai?.remove ?? []), ...rules.remove], 4);
  const missed: KwSuggestion['missed'] = [];
  for (const a of add) for (const n of measure(a.word, 'add', s, p).newly) if (missed.length < 12 && !missed.some((x) => x.id === n.id)) missed.push({ ...n, word: a.word });
  const out: KwSuggestion = { at: new Date().toISOString(), via: ai ? 'ai' : 'rules', add, exclude, remove, missed, base: { pos: s.pos.length, neg: s.neg.length, pool: s.pool.length } };
  await sql`insert into sales_settings (tenant, kw_suggestion) values (${tenant}, ${sql.json(out as never)}) on conflict (tenant) do update set kw_suggestion = excluded.kw_suggestion, updated_at = now()`;
  return out;
}

async function gate(u: SessionUser, edit: boolean) {
  await assertSpace(u, 'sales');
  if (!(await salesBidsOn(tenantOf(u)))) throw forbidden('입찰·공고를 쓰지 않는 회사입니다');
  if (edit && !isAdmin(u)) throw forbidden('맞춤 설정은 관리자가 바꿉니다');
}
export async function getKwSuggestion(u: SessionUser) {
  await gate(u, false);
  const [r] = await db()<{ kw_suggestion: KwSuggestion | null }[]>`select kw_suggestion from sales_settings where tenant = ${tenantOf(u)}`;
  return { suggestion: r?.kw_suggestion ?? null, canEdit: isAdmin(u) };
}
export async function runKwSuggestion(u: SessionUser) {
  await gate(u, true);
  const s = await buildKwSuggestion(tenantOf(u), { user: u, ai: true });
  await audit(db(), u.id, 'sales.kw_suggest', 'tenant', null, { via: s.via, add: s.add.length, exclude: s.exclude.length, remove: s.remove.length }).catch(() => {});
  return { suggestion: s, canEdit: true };
}
const wordsIn = z.array(z.string().trim().min(2).max(30)).max(12);
export const kwApplyInput = z.object({ add: wordsIn.default([]), exclude: wordsIn.default([]), remove: wordsIn.default([]) });
/** 고른 것만 반영(관리자) — 관심 검색어 + add − remove, 제외어 + exclude */
export async function applyKwSuggestion(u: SessionUser, i: z.infer<typeof kwApplyInput>) {
  await gate(u, true);
  const p = await prefsOf(tenantOf(u)); const drop = new Set(i.remove.map(key));
  const uniq = (list: string[]) => list.filter((w, n) => list.findIndex((x) => key(x) === key(w)) === n);
  const prefs = await savePrefs(u, { keywords: uniq([...p.keywords.filter((w) => !drop.has(key(w))), ...i.add]).slice(0, 50), excludes: uniq([...p.excludes, ...i.exclude]).slice(0, 50) });
  // 반영한 낱말은 저장된 추천에서 뺌(다시 보이면 헷갈림) — 넣은 검색어로 이제 보일 놓친 공고 후보도 같이
  const sql = db(); const [cur] = await sql<{ kw_suggestion: KwSuggestion | null }[]>`select kw_suggestion from sales_settings where tenant = ${tenantOf(u)}`;
  if (cur?.kw_suggestion) {
    const s = cur.kw_suggestion; const used = (list: string[]) => new Set(list.map(key));
    const A = used(i.add), E = used(i.exclude), R = used(i.remove);
    const next: KwSuggestion = { ...s, add: s.add.filter((x) => !A.has(key(x.word))), exclude: s.exclude.filter((x) => !E.has(key(x.word))), remove: s.remove.filter((x) => !R.has(key(x.word))), missed: s.missed.filter((m) => !A.has(key(m.word))) };
    await sql`update sales_settings set kw_suggestion = ${sql.json(next as never)} where tenant = ${tenantOf(u)}`;
  }
  await audit(sql, u.id, 'sales.kw_apply', 'tenant', null, { add: i.add, exclude: i.exclude, remove: i.remove }).catch(() => {});
  return { prefs };
}

/** 정기: 매달 1일(KST) 09시 뒤 첫 tick 에 입찰을 쓰는 영업 회사마다 한 번 — AI 없이 낱말 세기 + 놓친 공고 후보, 있을 때만 관리자 알림(SALES_KW_MONTHLY = '일-시' 기본 '1-9', 'any' = 늘, 'off' = 안 함) */
export async function kwSuggestMonthlyTick(opt: { now?: Date } = {}) {
  const now = opt.now ?? new Date(); const g = process.env.SALES_KW_MONTHLY ?? '1-9';
  if (g === 'off') return { skipped: 'off' };
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  const month = `${get('year')}-${get('month')}`;
  if (g !== 'any') { const [d, h] = g.split('-').map(Number); if (Number(get('day')) !== d || Number(get('hour')) % 24 < h) return { skipped: 'time' }; }
  const sql = db();
  const tenants = await sql<{ id: string }[]>`select t.id from tenants t left join sales_settings s on s.tenant = t.id where 'sales' = any(t.spaces) and t.status = 'active' and coalesce(t.sales_bids, true)
    and coalesce(s.kw_monthly, '') <> ${month} order by t.id limit 20`;
  const out: Record<string, unknown> = {};
  for (const t of tenants) {
    try {
      const s = await buildKwSuggestion(t.id);
      await sql`insert into sales_settings (tenant, kw_monthly) values (${t.id}, ${month}) on conflict (tenant) do update set kw_monthly = excluded.kw_monthly`;
      if (s.add.length || s.missed.length) {
        const admins = await sql<{ id: string }[]>`select id from users where tenant = ${t.id} and status = 'active' and role in ('owner', 'admin')`;
        const { notify } = await import('../notifications');
        await notify(sql, { userIds: admins.map((a) => a.id), type: 'sales_kw_suggest', space: 'sales', title: `관심 검색어 추천 ${s.add.length}개 · 지난 30일 놓친 공고 후보 ${s.missed.length}건`,
          body: s.add.slice(0, 3).map((a) => a.word).join(', '), link: '/s/sales/sources#kw-suggest', dedupeKey: `kw_suggest:${month}` });
      }
      out[t.id] = { add: s.add.length, missed: s.missed.length };
    } catch (e) { out[t.id] = { error: String((e as Error)?.message ?? e).slice(0, 120) }; }
  }
  return { month, tenants: tenants.length, out };
}
