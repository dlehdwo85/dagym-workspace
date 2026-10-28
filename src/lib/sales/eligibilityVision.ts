// 253차 #790(대표 10/29 01:00 "사진으로 된 공고문도 읽게 승인"): 글자가 없는 공고문(그림만 든 docx·hwpx, 스캔 PDF, 그림 파일)은 AI 비전으로 '참가자격' 절을 옮겨 적는다.
// 열린 관련 공고만(정기 실행·[공고문 다시 읽기]) · 앞 6쪽(그림 6장) · 공고당 한 번(첨부가 바뀌면 다시) · 회사 AI 예산 안 · 사용량 이름 'sales_eligibility_vision' · 끄기 SALES_ELIGIBILITY_VISION=off
import { randomUUID } from 'node:crypto';
import { db, type Sql } from '../db';
import { aiEnabled, anthropicProvider, costUsd, type AiProvider } from '../ai/provider';
import { unzip } from '../textExtract';
import { tenantOf, type SessionUser } from '../types';

export const VISION_PAGES = 6;
export type PhotoDoc = { data: Buffer; fileName: string; mime: string };
const IMG = /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i;
const num = (s: string) => Number(s.match(/(\d+)(?=\.[a-z]+$)/i)?.[1] ?? 0);
async function jpeg(b: Buffer): Promise<{ j: Buffer | null; err?: string }> {
  try { return { j: await (await import('sharp')).default(b).rotate().resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer() }; }
  catch (e) { return { j: null, err: String((e as Error)?.message ?? e).slice(0, 60) }; }
}
/** 공고문 → AI 에 보낼 조각(PDF 앞 6쪽 / 문서 속 그림 앞 6장 / 그림 파일 1장). 보낼 것이 없으면 blocks [] + 이유(why) */
export async function visionBlocks(f: PhotoDoc): Promise<{ blocks: Record<string, unknown>[]; why: string | null }> {
  const name = f.fileName.toLowerCase();
  if (/\.pdf$/.test(name) || f.mime === 'application/pdf') {
    const { PDFDocument } = await import('pdf-lib');
    const src = await PDFDocument.load(f.data, { ignoreEncryption: true }); const out = await PDFDocument.create();
    const pages = await out.copyPages(src, [...Array(Math.min(VISION_PAGES, src.getPageCount())).keys()]); for (const pg of pages) out.addPage(pg);
    const bytes = Buffer.from(await out.save());
    return bytes.length <= 25 * 1024 * 1024 ? { blocks: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } }], why: null } : { blocks: [], why: 'PDF 앞 6쪽이 25MB 넘음' };
  }
  let imgs: Buffer[] = [];
  if (/\.(docx|hwpx|pptx)$/.test(name)) {
    const z = unzip(f.data);
    imgs = [...z.keys()].filter((k) => /(^|\/)(media|BinData)\//i.test(k) && IMG.test(k)).sort((a, b) => num(a) - num(b) || a.localeCompare(b)).slice(0, VISION_PAGES).map((k) => z.get(k)!());
  } else if (IMG.test(name) || /^image\//.test(f.mime)) imgs = [f.data];
  if (!imgs.length) return { blocks: [], why: '문서 속 그림(jpg·png 등)을 못 찾음' };
  const out: Record<string, unknown>[] = []; let err: string | undefined;
  for (const b of imgs) { const x = await jpeg(b); if (x.j) out.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: x.j.toString('base64') } }); else err = err ?? x.err; }
  return { blocks: out, why: out.length ? null : `그림 ${imgs.length}장을 AI 용으로 못 바꿈(${err ?? '알 수 없음'})` };
}
/** 비용을 낼 회사 — 영업 공간을 쓰는(전환 열림) 운영 회사의 관리자(시험·체험 조직 빼고). 공고는 모든 회사가 같이 보는 원천 */
export async function visionPayer(sql: Sql = db()): Promise<SessionUser | { why: string }> {
  const [t] = await sql<{ id: string }[]>`select t.id from tenants t join sales_cutover c on c.tenant = t.id where 'sales' = any(t.spaces) and t.status = 'active' and not coalesce(t.is_test, false) and c.writes_open order by t.created_at limit 1`;
  if (!t) return { why: '비용 낼 회사 없음(영업 공간·전환 열린 운영 회사)' };
  return (await (await import('./support')).adminActor(sql, t.id)) ?? { why: '비용 낼 회사의 관리자 계정을 못 찾음' };
}
/** 사진 읽기를 못 하는 설정 이유(없으면 null) — 이 이유로 건너뛴 것은 '읽기 시도'로 세지 않는다 */
export const visionOff = (): string | null => process.env.SALES_ELIGIBILITY_VISION === 'off' ? 'AI 사진 읽기를 꺼 둠' : !aiEnabled() ? 'AI 키가 없음' : null;
const SCHEMA = { type: 'object', additionalProperties: false, required: ['found', 'text'], properties: { found: { type: 'boolean' }, text: { type: 'string' } } };
/** 사진 공고문 → '참가자격' 절 원문(옮겨 적은 글). AI 를 부르지 못한 설정·파일 이유는 { skip }. 회사 AI 예산·요청 수를 넘으면 그 오류를 그대로 던짐(402·429 — 다음에 다시) */
export async function visionRead(f: PhotoDoc, title: string, provider: AiProvider = anthropicProvider({ tier: 'fast', maxTokens: 2500 })): Promise<{ text: string | null; usd: number; pages: number } | { skip: string }> {
  const sql = db();
  const off = visionOff(); if (off) return { skip: off };
  const payer = await visionPayer(sql); if ('why' in payer) return { skip: payer.why };
  const { blocks, why } = await visionBlocks(f); if (!blocks.length) return { skip: why ?? '보낼 그림 없음' };
  await (await import('../plans')).assertAiRequest(payer, { legacy: true });
  await (await import('../ai/guard')).assertAiCredit(sql);
  const system = `입찰 공고문을 찍은 사진(또는 스캔 PDF)입니다. 공고문에서 '입찰참가자격'(참가자격·참가자격의 제한) 절을 찾아 원문 그대로 옮겨 적으세요.
- 절 머리(번호·제목)부터 다음 번호 머리 바로 앞까지. 줄바꿈·번호(가. 나. 1) 등)는 원문대로.
- 숫자(자본금·실적 건수·인원·기간)는 사진에 보이는 그대로. 읽을 수 없는 글자는 □ 로.
- 요약·설명·추측 금지. 그런 절이 없으면 found=false, text 는 빈 글자.`;
  let r;
  try { r = await provider.chat({ system, tools: [], format: SCHEMA, messages: [{ role: 'user', content: [...blocks, { type: 'text', text: `공고명: ${title.slice(0, 120)}` }] as never }] }); }
  catch (e) { throw await (await import('../ai/guard')).onAiError(e, sql); }
  const usd = costUsd(r.model ?? provider.model, r.usage);
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenantOf(payer)}, ${payer.id}, ${randomUUID()}, ${provider.name}, ${r.model ?? provider.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0}, ${r.usage.cache_creation_input_tokens ?? 0}, ${usd}, 'sales_eligibility_vision')`;
  const raw = r.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
  let j: { found?: boolean; text?: string } = {}; try { j = JSON.parse(raw); } catch { /* 아래 null */ }
  const text = j.found && j.text ? String(j.text).replace(/\r\n?/g, '\n').trim().slice(0, 3000) : null;
  return { text, usd, pages: blocks.length };
}
