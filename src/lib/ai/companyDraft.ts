import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db';
import { HttpError, badRequest } from '../errors';
import { aiEnabled, anthropicProvider, costUsd } from './provider';
import { tenantOf, type SessionUser } from '../types';

/**
 * 로컬 10/19(대표): 회사 정보 'AI 로 정리' — 생각나는 대로 쓴 글·홈페이지 주소·회사소개서(자료실 파일)·5문항 인터뷰 답을 보고
 * 칸별 초안(사업 소개·방향 / 주요 고객 / 말투 / 주의할 점)을 만든다. 저장은 하지 않음(화면에서 [적용] 뒤 사용자가 [저장]).
 * 회사 정보 편집 권한(관리자)만. AI 사용량은 ai_usage(purpose company_profile)에 기록.
 */
export const INTERVIEW = ['무엇을 파나요?(상품·서비스)', '누가 사나요?(주요 고객)', '고객은 왜 우리를 고르나요?', '고객에게 어떤 말투로 말하나요?', '쓰면 안 되는 표현·과장 금지가 있나요?'];
export const FIELDS = ['business', 'customers', 'tone', 'cautions'] as const;
export const draftInput = z.object({
  text: z.string().trim().max(6000).optional(),
  url: z.string().trim().max(500).optional(),
  fileId: z.string().uuid().optional(),
  answers: z.array(z.string().max(1000)).max(5).optional(),
  field: z.enum(FIELDS).optional(), // [다시 쓰기] — 그 칸만
});

/** 홈페이지 글: https 공개 주소만(내부 주소·IP 막음), 8초·500KB, 태그 지우고 앞 8,000자 */
async function pageText(raw: string) {
  let u: URL; try { u = new URL(raw); } catch { throw badRequest('홈페이지 주소 형식이 아닙니다'); }
  if (u.protocol !== 'https:' || /^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname) || /^[\d.]+$|^\[|:/.test(u.hostname)) throw badRequest('https:// 로 시작하는 공개 홈페이지 주소만 읽을 수 있습니다');
  const res = await fetch(u.href, { signal: AbortSignal.timeout(8000), redirect: 'follow', headers: { 'user-agent': 'WorkIn/1.0 (+https://www.work-in.dev)' } }).catch(() => null);
  if (!res?.ok) throw badRequest('홈페이지를 읽지 못했습니다 — 주소를 확인하거나 소개 글을 붙여 넣어 주세요');
  const html = (await res.text()).slice(0, 500_000);
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
}

export async function companyDraft(u: SessionUser, i: z.infer<typeof draftInput>) {
  const { requireAnyMenu } = await import('../menuPerms');
  await requireAnyMenu(u, ['company', 'ops'], 'edit');
  const parts: string[] = [];
  if (i.text) parts.push(`[대표가 적은 글]\n${i.text}`);
  if (i.answers?.some((a) => a.trim())) parts.push(`[질문 답]\n${INTERVIEW.map((q, k) => `${q} ${i.answers?.[k]?.trim() || '(답 없음)'}`).join('\n')}`);
  if (i.url) parts.push(`[홈페이지 ${i.url}]\n${await pageText(i.url)}`);
  if (i.fileId) {
    const { loadLibraryFile } = await import('../library');
    const f: any = await loadLibraryFile(u, i.fileId, 'ai');
    const text = String(f?.text_content ?? f?.file?.text_content ?? '').slice(0, 8000);
    if (!text) throw badRequest('그 파일에서 글자를 읽지 못했습니다(그림 PDF 등) — 소개 글을 붙여 넣어 주세요');
    parts.push(`[회사소개서 ${f?.title ?? f?.file?.title ?? ''}]\n${text}`);
  }
  if (!parts.length) throw badRequest('글을 적거나 홈페이지 주소·회사소개서를 넣거나, [질문으로 시작]으로 답해 주세요');
  if (!aiEnabled()) throw new HttpError(503, 'ai_off', 'AI 가 설정되지 않았습니다');
  await (await import('../plans')).assertAiRequest(u);
  await (await import('./guard')).assertAiCredit();
  const sql = db(); const t = tenantOf(u);
  const [cur] = await sql<any[]>`select name, industry, ai_business, ai_customers, ai_tone, ai_cautions from tenants where id = ${t}`;
  const p = anthropicProvider({ tier: 'fast' });
  const r = await p.chat({
    system: `회사 정보 정리 도우미. 아래 자료만 보고 회사 소개 칸 초안을 한국어로 씁니다. 자료에 없는 사실(숫자·수상·가격)은 만들지 않습니다.
- business(사업 소개·방향, 2~4문장): 무엇을 누구에게 어떻게, 강조점
- customers(주요 고객, 1~2문장)
- tone(고객에게 쓰는 말투, 1~2문장)
- cautions(주의할 점: 쓰면 안 되는 표현·과장 금지·업종 광고 규정(예: 의료·건강기능식품·금융·부동산이면 해당 규정), 불릿 없이 쉼표로)
${i.field ? `이번에는 ${i.field} 칸만 새로 씁니다(다른 칸은 빈 문자열).` : ''} JSON 만.`,
    tools: [],
    messages: [{ role: 'user', content: `[회사] ${cur?.name ?? ''}${cur?.industry ? ` · 업종 ${cur.industry}` : ''}\n${parts.join('\n\n')}` }],
    format: { type: 'object', additionalProperties: false, required: [...FIELDS], properties: Object.fromEntries(FIELDS.map((f) => [f, { type: 'string' }])) },
  });
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${t}, ${u.id}, ${randomUUID()}, 'anthropic', ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${costUsd(r.model ?? p.model, r.usage)}, 'company_profile')`;
  let o: Record<string, unknown> = {};
  try { o = JSON.parse((r.content as any[]).find((b) => b.type === 'text')?.text ?? '{}'); } catch { throw new HttpError(502, 'ai_format', 'AI 답을 읽지 못했습니다 — 다시 눌러 주세요'); }
  const lim: Record<(typeof FIELDS)[number], number> = { business: 1000, customers: 500, tone: 500, cautions: 500 };
  const draft = Object.fromEntries(FIELDS.filter((f) => !i.field || f === i.field).map((f) => [f, String(o[f] ?? '').trim().slice(0, lim[f])]));
  // 원래 값(비교 표시용)
  return { draft, current: { business: cur?.ai_business ?? null, customers: cur?.ai_customers ?? null, tone: cur?.ai_tone ?? null, cautions: cur?.ai_cautions ?? null } };
}
