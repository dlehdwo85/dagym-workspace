import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { chat } from '@/lib/ai/assistant';
import { usdKrw } from '@/lib/ai/provider';

/**
 * V45 원가 측정(플랫폼 관리자, 실제 AI 호출 = 소액 비용): 같은 문장 5개를 새 대화로 보내 질문마다 원가·모델·토큰(캐시 읽기 포함)을 돌려줌.
 * 만든 제안은 바로 취소(실행 안 됨). 적용 전 기준 = ai_usage 10/1~19 중앙 73원(로컬 실측, WORKIN_V45_AI_COST_PRICING.md).
 */
export const maxDuration = 300;
const SAMPLES = ['오늘 내 업무 뭐 남았어?', '이번 주 일정 알려줘', '이직원에게 금요일까지 주간 보고서 쓰라고 해줘', '자료실에서 회사 소개서 찾아줘', '다음 주 화요일 오후에 팀 회의 잡아줘'];
export const POST = handler(async ({ user }) => {
  if (!user.platformAdmin || user.support) throw notFound();
  const sql = db(); const out: any[] = [];
  for (const text of SAMPLES) {
    const t0 = new Date();
    const r: any = await chat(user, { text } as never).catch((e: any) => ({ error: String(e?.message ?? e) }));
    const rows = await sql<{ model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_usd: number }[]>`
      select model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd::float8 from ai_usage where user_id = ${user.id} and purpose = 'assistant' and created_at >= ${t0} order by created_at`;
    if (r?.proposals?.length) await sql`update ai_proposals set status = 'cancelled', decided_at = now() where id = any(${r.proposals.map((p: any) => p.id)}::uuid[]) and status = 'pending'`;
    const usd = rows.reduce((n, x) => n + Number(x.cost_usd), 0);
    out.push({ text, krw: Math.round(usd * usdKrw() * 10) / 10, steps: rows.length, models: [...new Set(rows.map((x) => x.model))],
      tokens: rows.reduce((m, x) => ({ in: m.in + x.input_tokens, out: m.out + x.output_tokens, cacheRead: m.cacheRead + x.cache_read_tokens, cacheWrite: m.cacheWrite + x.cache_write_tokens }), { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }),
      error: r?.error ?? null });
  }
  const krw = out.map((x) => x.krw).sort((a, b) => a - b);
  return { samples: out, medianKrw: krw[2], maxKrw: krw[4], baselineMedianKrw: 73 };
});
