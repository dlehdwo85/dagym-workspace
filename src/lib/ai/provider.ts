import Anthropic from '@anthropic-ai/sdk';

/**
 * V9 AI 공급자 어댑터. 제품 AI 는 워크인 플랫폼 계정의 API 키로 호출한다(고객 회사는 외부 계정 연결 없음).
 * 기본 공급자 Anthropic(Claude). 다른 공급자를 붙일 때는 같은 모양(`AiProvider`)으로 구현한다.
 * 환경변수: ANTHROPIC_API_KEY(없으면 AI 기능 전체 숨김), AI_EFFORT(기본 medium)
 * 모델 3단계(비용 조정 2026-10-14): AI_MODEL = 기본(AI 비서, 기본 claude-sonnet-5-5) · AI_MODEL_FAST = 가벼운 작업(자료실 자동 정리·매출 추출, 기본 claude-haiku-5-5)
 *   · AI_MODEL_DEEP = 복잡한 분석(매출 AI 분석, 기본 claude-opus-5-5)
 */
export type AiMessage = Anthropic.Beta.BetaMessageParam;
export type AiTool = Anthropic.Beta.BetaTool;
export type AiResponse = Anthropic.Beta.BetaMessage;
export interface AiProvider {
  name: string;
  model: string;
  chat(p: { system: string; messages: AiMessage[]; tools: AiTool[]; format?: Record<string, unknown>; signal?: AbortSignal }): Promise<AiResponse>;
}

/**
 * V23 4.1 정가(API 표준 단가) — Max 월 크레딧으로 실제 청구가 0 이어도 "건별로 결제했다면 낸 돈"으로 계산한다.
 * 100만 토큰당 달러: 입력·출력·캐시 읽기. 캐시 쓰기 = 입력 × 1.25(5분). Haiku 5.5 는 입력 10만 토큰 넘으면 비싼 단가.
 * 표에 없는 모델은 가장 비싼 단가로(과소 계산 금지). 웹 검색은 건당(AI_WEB_SEARCH_USD, 기본 $0.01).
 * 코드 실행(컨테이너 시간)은 응답에 시간이 오지 않아 계산에 넣지 못함 — 콘솔 대조로 확인.
 */
type Price = { in: number; out: number; cacheRead: number };
export const PRICES: Record<string, Price> = {
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25 }, 'claude-mythos-5-1': { in: 10, out: 50, cacheRead: 0.25 },
  'claude-fable-5': { in: 10, out: 50, cacheRead: 1 }, 'claude-mythos-5': { in: 10, out: 50, cacheRead: 1 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 }, 'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 }, 'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01 },
};
const HAIKU_LONG: Price = { in: 0.5, out: 2.5, cacheRead: 0.05 };
const MAX_PRICE: Price = { in: 10, out: 50, cacheRead: 1 };
export type UsageLike = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null };
export function priceFor(model: string, promptTokens = 0): Price {
  const base = model.replace(/-\d{8}$/, '').replace(/\[1m\]$/, '');
  if (base === 'claude-haiku-5-5' && promptTokens > 100_000) return HAIKU_LONG;
  return PRICES[base] ?? MAX_PRICE;
}
export function costUsd(model: string, u: UsageLike) {
  const prompt = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const p = priceFor(model, prompt);
  const web = (u.server_tool_use?.web_search_requests ?? 0) * (Number(process.env.AI_WEB_SEARCH_USD) || 0.01);
  return (u.input_tokens * p.in + (u.cache_creation_input_tokens ?? 0) * p.in * 1.25 + (u.cache_read_input_tokens ?? 0) * p.cacheRead + u.output_tokens * p.out) / 1e6 + web;
}
/** 원 환산 환율(설정, 기본 1,400) */
export const usdKrw = () => Number(process.env.USD_KRW) || 1400;

export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;
/** 거절(refusal) 시 서버가 다른 모델로 이어 받는 기능을 지원하는 모델 */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

let client: Anthropic | null = null;
export type AiTier = 'default' | 'fast' | 'deep';
export const modelFor = (tier: AiTier = 'default') =>
  tier === 'fast' ? process.env.AI_MODEL_FAST || process.env.AI_LIGHT_MODEL || 'claude-haiku-5-5'
  : tier === 'deep' ? process.env.AI_MODEL_DEEP || 'claude-opus-5-5'
  : process.env.AI_MODEL || 'claude-sonnet-5-5';
export function anthropicProvider(opt: { tier?: AiTier } = {}): AiProvider {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL || undefined, maxRetries: 2, timeout: 100_000 });
  const light = opt.tier === 'fast';
  const model = modelFor(opt.tier);
  const effort = (light ? 'low' : process.env.AI_EFFORT || 'medium') as 'low' | 'medium' | 'high';
  const withEffort = !/haiku/.test(model); // 가벼운 모델에는 생각 깊이 설정을 보내지 않는다
  return {
    name: 'anthropic',
    model,
    chat: async ({ system, messages, tools, format, signal }) => {
      // V23-1: 크레딧 부족으로 막혀 있으면 호출하지 않고 바로 안내, 실패하면 종류별 문구(크레딧 부족은 1시간 차단)
      const G = await import('./guard');
      await G.assertAiCredit();
      try {
        const r = await client!.beta.messages.create({
        model,
        max_tokens: light ? 4000 : 16000,
        system,
        messages,
        ...(tools.length ? { tools } : {}),
        // 구조화 출력(JSON 스키마)이 필요하면 format — "자료로 채우기"
        output_config: { ...(withEffort ? { effort } : {}), ...(format ? { format: { type: 'json_schema', schema: format } } : {}) } as never,
        cache_control: { type: 'ephemeral' },
        ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      }, signal ? { signal } : undefined); // 부록 A2: 사용자가 [멈춤]하면 AI 호출도 끊는다
        await G.clearAiCredit();
        return r;
      } catch (e: any) {
        if (signal?.aborted) throw e;
        throw await G.onAiError(e);
      }
    },
  };
}
