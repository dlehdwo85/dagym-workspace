import { z } from 'zod';
import { db } from './db';
import { directory } from './admin';
import { accessibleUnitIds } from './access';
import { tenantOf, type SessionUser } from './types';
import { aiEnabled, anthropicProvider, costUsd } from './ai/provider';

/**
 * V24 음성 등록 인식률 — 받아쓰기 결과(후보 최대 5개)를 회사 단어장으로 보정한다.
 * 1) 후보 중 단어장 단어가 가장 많이 들어 있는 문장을 고른다
 * 2) 사람이 받아들인 보정 짝(voice_lexicon)을 그대로 적용, 되돌린 짝은 다시 쓰지 않는다
 * 3) 띄어쓰기만 다른 단어("노태 2단지" → "노태2단지")와 자모가 거의 같은 이름("김민서" → "김민수")을 고친다 — 흔한 업무 단어는 건드리지 않음
 * 4) 후보가 둘 이상으로 애매할 때만 가벼운 AI(Haiku) 1번에 고르게 한다(단어장 안의 말로만)
 * 단어장: 내가 볼 수 있는 사람·조직·프로젝트·팀 이름 + 내가 만든/맡은 최근 업무 제목에 자주 나온 말
 */
export const correctInput = z.object({ text: z.string().max(2000), alternatives: z.array(z.string().max(2000)).max(5).optional() });
export const learnInput = z.object({ from: z.string().trim().min(1).max(60), to: z.string().trim().min(1).max(60), accepted: z.boolean() });
export type Fix = { from: string; to: string; how: 'learned' | 'spacing' | 'similar' | 'ai' };

const CHO = 19, JUNG = 21, JONG = 28;
/** 한글 음절 → 자모(초·중·종) 기호열. 다른 글자는 그대로 */
export function jamo(s: string): string[] {
  const out: string[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)! - 0xac00;
    if (c >= 0 && c < CHO * JUNG * JONG) { out.push(`c${Math.floor(c / (JUNG * JONG))}`, `v${Math.floor((c % (JUNG * JONG)) / JONG)}`); if (c % JONG) out.push(`t${c % JONG}`); }
    else out.push(ch.toLowerCase());
  }
  return out;
}
function lev(a: string[], b: string[]) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
const nospace = (s: string) => s.replace(/\s+/g, '');
const syl = (s: string) => [...nospace(s)].length;
/** 이름 뒤에 붙는 조사·호칭 — 비교할 때만 떼고, 고친 뒤 다시 붙인다 */
const TAIL = /(님|씨|에게|한테|께서|께|은|는|이|가|을|를|에서|에|의|와|과|랑|이랑|으로|로|까지|부터|도|만)$/;
/** 단어장 이름과 비슷해도 고치지 않는 흔한 업무·시간 말 */
const COMMON = new Set(('회의 미팅 점검 내일 오늘 모레 어제 오전 오후 저녁 아침 점심 보고 확인 정리 업무 일정 전화 연락 준비 교체 수리 청소 주문 발송 견적 계약 방문 회신 검토 시간 다음 이번 주간 월간 '
  + '요청 처리 등록 작성 제출 공유 수정 삭제 완료 진행 시작 마감 고객 직원 대표 팀장 매니저 센터 지점 본사 문의 결제 환불 회원 상담 수업 강사 교육 행사 이벤트 사진 자료 문서 메일 문자').split(' '));

type Lex = { terms: string[]; known: Set<string> };
async function lexicon(u: SessionUser): Promise<Lex> {
  const sql = db();
  const dir = await directory(u, sql);
  const units = await accessibleUnitIds(u, sql);
  const [projects, teams, words] = await Promise.all([
    sql<{ name: string }[]>`select name from projects where not archived and org_unit_id = any(${units ?? []}::uuid[])`,
    sql<{ name: string }[]>`select name from teams where tenant = ${tenantOf(u)} and not archived`,
    // 내가 만들거나 맡은 최근 업무 제목에 2번 이상 나온 말(두 글자 이상)
    sql<{ w: string }[]>`select w from (select regexp_split_to_table(title, '\\s+') w from tasks where deleted_at is null and created_at > now() - interval '180 days'
        and (created_by = ${u.id} or assignee_id = ${u.id})) x where char_length(w) >= 2 group by w having count(*) >= 2 limit 500`,
  ]);
  const terms = new Set<string>();
  for (const x of [...(dir.users as any[]), ...(dir.orgUnits as any[]), ...(dir.brands as any[]), ...projects, ...teams]) if (x.name && syl(x.name) >= 2) terms.add(String(x.name).trim());
  const known = new Set<string>([...COMMON]);
  for (const r of words) { const w = r.w.replace(TAIL, ''); if (syl(w) >= 2) { terms.add(w); known.add(nospace(w)); } }
  return { terms: [...terms].slice(0, 3000), known };
}

const hitsIn = (s: string, terms: string[]) => { const n = nospace(s); return terms.reduce((k, t) => k + (n.includes(nospace(t)) ? 1 : 0), 0); };

/** 보정: 고친 문장 + 고친 곳 목록(화면 밑줄·되돌리기) */
export async function correctVoice(u: SessionUser, i: z.infer<typeof correctInput>) {
  const cands = [i.text, ...(i.alternatives ?? [])].map((s) => s.trim()).filter(Boolean);
  if (!cands.length) return { text: '', fixes: [] as Fix[] };
  const lex = await lexicon(u);
  // 1) 단어장 단어가 가장 많은 후보(같으면 첫 후보)
  let text = cands.reduce((best, c) => (hitsIn(c, lex.terms) > hitsIn(best, lex.terms) ? c : best), cands[0]);
  const fixes: Fix[] = [];
  // 2) 사람이 받아들인 짝
  const learned = await db()<{ heard: string; fixed: string; rejected: boolean }[]>`select heard, fixed, rejected from voice_lexicon where tenant = ${tenantOf(u)} order by hits desc limit 500`;
  const rejected = new Set(learned.filter((l) => l.rejected).map((l) => `${l.heard}→${l.fixed}`));
  for (const l of learned) if (!l.rejected && l.heard !== l.fixed) {
    const re = new RegExp(l.heard.split('').map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g');
    text = text.replace(re, (m, off: number, all: string) => {
      if (nospace(all.slice(off)).startsWith(nospace(l.fixed))) return m; // 이미 고친 말("노태2단지" 안의 "노태")
      fixes.push({ from: m, to: l.fixed, how: 'learned' }); return l.fixed;
    });
  }
  // 3) 낱말 창(3·2·1 낱말)마다 단어장과 비교
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const ambiguous: { from: string; options: string[]; at: number }[] = [];
  const done = new Set(fixes.map((f) => f.to));
  for (let k = 0; k < words.length;) {
    let used = 0;
    for (const n of [3, 2, 1]) {
      if (k + n > words.length) continue;
      const span = words.slice(k, k + n).join(' ');
      const tail = TAIL.exec(words[k + n - 1])?.[0] ?? '';
      const stem = nospace(tail ? span.slice(0, span.length - tail.length) : span);
      if (syl(stem) < 2 || lex.known.has(stem) || done.has(stem)) continue;
      if (lex.terms.some((t) => nospace(t) === stem)) { // 띄어쓰기만 다름
        const term = lex.terms.find((t) => nospace(t) === stem)!;
        if (n > 1 && !rejected.has(`${stem}→${term}`)) { out.push(term + tail); fixes.push({ from: span, to: term + tail, how: 'spacing' }); used = n; }
        else if (n === 1) { out.push(words[k]); used = 1; }
        if (used) break;
        continue;
      }
      if (n > 1) continue; // 비슷한 이름 찾기는 한 낱말만(긴 창은 띄어쓰기 맞추기 전용)
      const js = jamo(stem);
      const scored = lex.terms.map((t) => {
        const nt = nospace(t);
        if (Math.abs(syl(nt) - syl(stem)) > 1 || rejected.has(`${stem}→${t}`)) return null;
        const d = lev(js, jamo(nt));
        const okDist = syl(nt) <= 2 ? d <= 1 && jamo(nt)[0] === js[0] : d / Math.max(js.length, jamo(nt).length) <= 0.25;
        return okDist && d > 0 ? { t, d } : null;
      }).filter((x): x is { t: string; d: number } => !!x).sort((a, b) => a.d - b.d);
      if (scored.length === 1 || (scored.length > 1 && scored[1].d > scored[0].d)) {
        out.push(scored[0].t + tail); fixes.push({ from: words[k], to: scored[0].t + tail, how: 'similar' }); used = 1; break;
      }
      if (scored.length > 1) ambiguous.push({ from: words[k], options: scored.filter((s) => s.d === scored[0].d).map((s) => s.t + tail).slice(0, 4), at: out.length });
    }
    if (!used) { out.push(words[k]); used = 1; }
    k += used;
  }
  text = out.join(' ');
  // 4) 애매한 곳만 AI 1번(단어장 후보 안에서만)
  // 사람별 AI 한도를 다 썼거나 크레딧 부족이면 AI 보정은 건너뜀(서버 보정만)
  const canAi = ambiguous.length > 0 && aiEnabled() && await (async () => { try { const G = await import('./ai/guard'); await G.assertAiCredit(); await G.assertUserBudget(u); return true; } catch { return false; } })();
  if (canAi) {
    try {
      const p = anthropicProvider({ tier: 'fast' });
      const r = await p.chat({ system: '음성 받아쓰기 보정. 문장의 각 [n] 자리에 들어갈 말을 보기에서 하나씩 고르거나, 원래 말이 맞으면 원래 말을 고른다. JSON 만.', tools: [],
        messages: [{ role: 'user', content: `문장: ${text}\n${ambiguous.map((a, n) => `[${n}] 원래 "${a.from}" 보기: ${a.options.join(', ')}`).join('\n')}` }],
        format: { type: 'object', properties: { picks: { type: 'array', items: { type: 'string' } } }, required: ['picks'], additionalProperties: false } });
      const picks: string[] = JSON.parse((r.content as any[]).find((b) => b.type === 'text')?.text ?? '{}').picks ?? [];
      const ws = text.split(' ');
      ambiguous.forEach((a, n) => { const pk = picks[n]; if (pk && a.options.includes(pk) && ws[a.at] === a.from) { ws[a.at] = pk; fixes.push({ from: a.from, to: pk, how: 'ai' }); } });
      text = ws.join(' ');
      await db()`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
        values (${tenantOf(u)}, ${u.id}, ${crypto.randomUUID()}, 'anthropic', ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${costUsd(r.model ?? p.model, r.usage)}, 'voice')`;
    } catch { /* AI 보정 실패는 무시(서버 보정 결과만) */ }
  }
  return { text, fixes };
}

/** 사람이 보정을 받아들였는지(등록) / 되돌렸는지 기록 */
export async function learnVoice(u: SessionUser, i: z.infer<typeof learnInput>) {
  const heard = nospace(i.from).replace(TAIL, ''), fixed = i.to.replace(TAIL, '').trim();
  if (!heard || !fixed || heard === nospace(fixed)) return { ok: true };
  await db()`insert into voice_lexicon (tenant, heard, fixed, hits, rejected) values (${tenantOf(u)}, ${heard}, ${fixed}, ${i.accepted ? 1 : 0}, ${!i.accepted})
    on conflict (tenant, heard, fixed) do update set hits = voice_lexicon.hits + ${i.accepted ? 1 : 0}, rejected = ${!i.accepted}, updated_at = now()`;
  return { ok: true };
}

// ---------------- 대표 실기기(10/16): 말한 지시 → 업무 카드(업무명·담당·마감) 정리 ----------------
export const structureInput = z.object({ text: z.string().trim().min(1).max(2000) });
/**
 * 받아쓰기는 말더듬·반복("다음 다음 주")·지시 문구("본부장한테 업무 배정해 줘")가 섞여 업무명이 길고 지저분하다 →
 * 가벼운 AI 1번으로 업무명(짧은 명사형)·담당자(볼 수 있는 사람만)·마감을 고른다. AI 가 없거나 한도면 null(화면은 규칙 결과 그대로).
 */
export async function structureVoice(u: SessionUser, i: z.infer<typeof structureInput>) {
  if (!aiEnabled()) return { ok: false as const };
  try { const G = await import('./ai/guard'); await G.assertAiCredit(); await G.assertUserBudget(u); } catch { return { ok: false as const }; }
  const dir = await directory(u);
  const people = (dir.users as unknown as { id: string; name: string; title: string | null; title_short: string | null }[]).slice(0, 200);
  const { todaySeoul } = await import('./time');
  const today = todaySeoul();
  const dow = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'long' }).format(new Date());
  const p = anthropicProvider({ tier: 'fast' });
  try {
    const r = await p.chat({
      system: `음성으로 말한 업무 지시를 업무 카드로 정리합니다. JSON 만.
- title: 해야 할 일만 짧게(30자 이내, "~하기"·명사형). 받아쓰기 반복·말더듬("다음 다음 주", "푸르지오 푸르지오")은 한 번만, 지시 문구("업무 배정해 줘", "나 지금", "~할 것")·담당자·마감 표현은 빼고, 고유명사(현장·아파트·거래처 이름)는 그대로.
- assignee: 일을 맡을 사람. 아래 [사람] 목록의 이름 그대로. 이름이 잘못 들렸어도 직책이 목록에서 한 사람뿐이면 그 사람. 모르면 null(지어내지 않음).
- dueDate: YYYY-MM-DD(오늘 ${today} ${dow} 기준, "다음 주 금요일" = 다음 주의 금요일). 말하지 않았으면 null. dueTime: HH:MM 또는 null.
- description: 업무명에 다 못 담은 내용(조건·순서·참고)만 1~3문장, 없으면 "". checklist: 말한 단계가 여러 개면 짧은 항목(최대 8), 없으면 []. 말하지 않은 일은 만들지 않음.
- priority: "급함·긴급"=urgent, "높은 우선순위·중요"=high, "낮음·천천히"=low, 말하지 않았으면 null(우선순위 말은 설명에 넣지 않음).`,
      tools: [],
      messages: [{ role: 'user', content: `[사람]\n${people.map((x) => `${x.name}${x.title ? ` (${x.title})` : ''}`).join('\n')}\n\n[말한 내용]\n${i.text}` }],
      format: { type: 'object', additionalProperties: false, required: ['title', 'assignee', 'dueDate', 'dueTime', 'description', 'checklist', 'priority'], properties: {
        title: { type: 'string' }, assignee: { type: ['string', 'null'] }, dueDate: { type: ['string', 'null'] }, dueTime: { type: ['string', 'null'] },
        description: { type: 'string' }, checklist: { type: 'array', items: { type: 'string' } }, priority: { type: ['string', 'null'], enum: ['urgent', 'high', 'normal', 'low', null] } } },
    });
    await db()`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
      values (${tenantOf(u)}, ${u.id}, ${crypto.randomUUID()}, 'anthropic', ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${costUsd(r.model ?? p.model, r.usage)}, 'voice')`;
    const o = JSON.parse((r.content as any[]).find((b) => b.type === 'text')?.text ?? '{}') as { title?: string; assignee?: string | null; dueDate?: string | null; dueTime?: string | null; description?: string; checklist?: string[]; priority?: string | null };
    const nm = (o.assignee ?? '').replace(/\s/g, '');
    const who = nm ? people.find((x) => x.name.replace(/\s/g, '') === nm)
      ?? (() => { const h = people.filter((x) => [x.title, x.title_short].some((t) => t && t.replace(/\s/g, '') === nm)); return h.length === 1 ? h[0] : undefined; })() : undefined;
    return { ok: true as const, title: String(o.title ?? '').trim().slice(0, 200), assigneeId: who?.id ?? null,
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(o.dueDate ?? '') && o.dueDate! >= today ? o.dueDate! : null,
      dueTime: /^\d{2}:\d{2}$/.test(o.dueTime ?? '') && o.dueTime! <= '23:59' ? o.dueTime! : null,
      description: String(o.description ?? '').trim().slice(0, 2000), checklist: (Array.isArray(o.checklist) ? o.checklist : []).map((x) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 8),
      priority: (['urgent', 'high', 'normal', 'low'] as const).find((x) => x === o.priority) ?? null }; // 로컬 검수 10/17: "높은 우선순위" 반영
  } catch { return { ok: false as const }; }
}
