import Anthropic from '@anthropic-ai/sdk';

/**
 * V9 AI 공급자 어댑터. 제품 AI 는 워크인 플랫폼 계정의 API 키로 호출한다(고객 회사는 외부 계정 연결 없음).
 * 기본 공급자 Anthropic(Claude). 다른 공급자를 붙일 때는 같은 모양(`AiProvider`)으로 구현한다.
 * 환경변수: ANTHROPIC_API_KEY(없으면 AI 기능 전체 숨김), AI_MODEL(기본 claude-opus-5-5), AI_EFFORT(기본 medium)
 */
export type AiMessage = Anthropic.Beta.BetaMessageParam;
export type AiTool = Anthropic.Beta.BetaTool;
export type AiResponse = Anthropic.Beta.BetaMessage;
export interface AiProvider {
  name: string;
  model: string;
  chat(p: { system: string; messages: AiMessage[]; tools: AiTool[]; format?: Record<string, unknown> }): Promise<AiResponse>;
}

/** 모델 단가 (입력/출력, 100만 토큰당 달러) — 사용량·한도 계산용 추정 */
const PRICE: Record<string, [number, number]> = {
  'claude-fable-5-1': [10, 50], 'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5],
};
export function costUsd(model: string, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }) {
  const [i, o] = PRICE[model] ?? [4, 20];
  return ((u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1) * i + u.output_tokens * o) / 1e6;
}

export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;
/** 거절(refusal) 시 서버가 다른 모델로 이어 받는 기능을 지원하는 모델 */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

let client: Anthropic | null = null;
export function anthropicProvider(): AiProvider {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL || undefined, maxRetries: 2, timeout: 100_000 });
  const model = process.env.AI_MODEL || 'claude-opus-5-5';
  const effort = (process.env.AI_EFFORT || 'medium') as 'low' | 'medium' | 'high';
  return {
    name: 'anthropic',
    model,
    chat: ({ system, messages, tools, format }) =>
      client!.beta.messages.create({
        model,
        max_tokens: 16000,
        system,
        messages,
        ...(tools.length ? { tools } : {}),
        // 구조화 출력(JSON 스키마)이 필요하면 format — "자료로 채우기"
        output_config: { effort, ...(format ? { format: { type: 'json_schema', schema: format } } : {}) } as never,
        cache_control: { type: 'ephemeral' },
        ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      }),
  };
}
