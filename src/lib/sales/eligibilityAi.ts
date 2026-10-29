// 262차(로컬 10/29 13:40, 결정 15-38 입찰 참가자격 AI 범위): 규칙으로 요건 항목을 하나도 못 뽑은 공고(표·번호가 섞인 머리글·서약 문구 등)만
// 저장한 참가자격 절(1,500자까지)을 빠른 모델로 항목 JSON 으로 정리한다. 공고당 한 번(절이 바뀔 때만) · 회사 AI 예산 안 · 사용량 이름 'sales_eligibility_items'
// · 화면에 'AI 가 정리 — 원문 확인'. 끄기 SALES_ELIGIBILITY_AI=off
// 264차: 저장한 절이 1,500자에서 잘린 공고는 공고문에서 다시 자른 더 긴 절(4,000자)을 줌(o.long) — 지문(sig)은 저장한 절 그대로
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { aiEnabled, anthropicProvider, costUsd, type AiProvider } from '../ai/provider';
import { tenantOf } from '../types';
import { COMMON_CLAUSE, G2B_COMMON, SEC_LONG, SEC_MAX, needsAiItems, textSig, type EligAi, type EligItem } from './eligibilityText';
import { visionPayer } from './eligibilityVision';

const KINDS: EligItem['k'][] = ['capital', 'perf', 'license', 'staff', 'credit', 'region', 'briefing', 'joint', 'other'];
const SCHEMA = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['k', 'label'], properties: { k: { type: 'string', enum: KINDS }, label: { type: 'string' } } } } } };
export const aiItemsOff = (): string | null => process.env.SALES_ELIGIBILITY_AI === 'off' ? 'AI 항목 정리를 꺼 둠' : !aiEnabled() ? 'AI 키가 없음' : null;
const RETRY_MS = 20 * 3600e3;

/** 규칙으로 못 뽑은 절인데 아직 AI 정리가 없거나(절이 바뀜 포함) 실패·건너뜀 뒤 20시간 지남(실패는 3번까지) */
export function aiItemsDue(e: { text?: string | null; ai?: EligAi | null } | null | undefined, now = Date.now()): boolean {
  if (!e?.text || !needsAiItems(e.text)) return false;
  const a = e.ai;
  if (!a || a.sig !== textSig(e.text)) return true;
  if (a.items.length || (!a.error && !a.skip)) return false; // 정리함(요건 없음도 결과)
  return (!!a.skip || (a.tries ?? 0) < 3) && now - Date.parse(a.at) > RETRY_MS;
}

/** 절 → AI 항목. 설정·예산 이유로 못 부르면 skip(횟수 안 셈), 그 밖 오류는 error(tries +1) · o.long = 잘린 절 대신 줄 더 긴 절 */
export async function aiItemsFor(text: string, title: string, prev: EligAi | null | undefined, o: { long?: string | null; provider?: AiProvider } = {}): Promise<EligAi> {
  const provider = o.provider ?? anthropicProvider({ tier: 'fast', maxTokens: 700 });
  const sig = textSig(text); const at = new Date().toISOString();
  const long = o.long && o.long.length > text.length ? o.long.slice(0, SEC_LONG) : null;
  const tries = prev && prev.sig === sig ? prev.tries ?? 0 : 0;
  const off = aiItemsOff(); if (off) return { sig, items: [], at, skip: off, tries };
  const sql = db();
  const payer = await visionPayer(sql); if ('why' in payer) return { sig, items: [], at, skip: payer.why, tries };
  try {
    await (await import('../plans')).assertAiRequest(payer, { legacy: true });
    await (await import('../ai/guard')).assertAiCredit(sql);
  } catch (e) { return { sig, items: [], at, skip: `AI 예산·한도: ${String((e as Error)?.message ?? e).slice(0, 60)}`, tries }; }
  const system = `입찰 공고문의 '참가자격' 절입니다. 입찰에 참가하려면 갖춰야 하는 요건만 짧은 항목으로 뽑으세요.
- k: capital(자본금) · perf(실적) · license(등록·면허·업종·인증) · staff(인력·자격증) · credit(신용등급) · region(지역) · briefing(현장설명 참가) · joint(공동도급) · other(그 밖 요건)
- label: 한국어 40자 안. 원문의 숫자·법 이름·업종 이름 그대로(예: '건설엔지니어링업(종합) 등록', '자본금 5억 이상', '최근 3년 유사 용역 실적 1건 이상'). '또는'으로 고르는 요건은 한 항목에.
- 빼기: 모든 공고에 붙는 공통 문구(지방·국가계약법 시행령 제13조·제12조·제92조, 부정당업자 제한, 전자조달 참가자격 등록), 청렴서약·서약서 제출, 제출 서류 목록, 절차 안내, 머리글.
- '1)·2)·3) 중 하나'처럼 번호로 가리키면 그 번호의 실제 내용(업종·자격 이름)을 찾아 '또는'으로 묶어 쓰세요. 내용을 못 찾으면 그 항목은 빼세요('원문 없음'·'세부 없음' 같은 말을 쓰지 않기).
- 요건이 없으면 items 는 빈 배열. 원문에 없는 내용을 추측하지 마세요.`;
  let r;
  try { r = await provider.chat({ system, tools: [], format: SCHEMA, messages: [{ role: 'user', content: `공고명: ${title.slice(0, 120)}\n\n${long ?? text.slice(0, SEC_MAX)}` }] }); }
  catch (e) {
    const err = await (await import('../ai/guard')).onAiError(e, sql);
    const status = (err as { status?: number })?.status;
    return status === 402 || status === 429 ? { sig, items: [], at, skip: `AI 예산·한도: ${String((err as Error)?.message ?? err).slice(0, 60)}`, tries }
      : { sig, items: [], at, error: String((err as Error)?.message ?? err).slice(0, 80), tries: tries + 1 };
  }
  const usd = costUsd(r.model ?? provider.model, r.usage);
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenantOf(payer)}, ${payer.id}, ${randomUUID()}, ${provider.name}, ${r.model ?? provider.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0}, ${r.usage.cache_creation_input_tokens ?? 0}, ${usd}, 'sales_eligibility_items')`;
  const raw = r.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
  let j: { items?: { k?: string; label?: string }[] } = {}; try { j = JSON.parse(raw); } catch { return { sig, items: [], at, usd, error: 'AI 답을 못 읽음', tries: tries + 1 }; }
  // 지킴: 모르는 종류는 '그 밖' · 빈 글자·공통 문구·서약 문구는 버림 · 8개·60자까지
  const items = (Array.isArray(j.items) ? j.items : []).map((x) => ({ k: (KINDS.includes(x?.k as EligItem['k']) ? x!.k : 'other') as EligItem['k'], label: String(x?.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) }))
    .filter((x) => x.label && !COMMON_CLAUSE.test(x.label) && !G2B_COMMON.test(x.label) && !/서약|청렴|원문\s*(?:에\s*)?없|세부\s*(?:내용\s*)?(?:원문\s*)?없/.test(x.label)).slice(0, 8);
  return { sig, items, at, usd, tries: 0, ...(long ? { long: long.length } : {}) };
}
