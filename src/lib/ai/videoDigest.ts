/**
 * 대표 10/20 17:00 (#109) AI 비서 영상 첨부 — "영상 요약 + 할 일 제안".
 * 영상 자체는 AI 에 보내지 않는다. 화면(브라우저)이 ① 1초 간격 표본에서 장면이 바뀐 프레임 최대 20장(JPEG 640px) ② 음성 트랙 WAV 를 뽑고,
 * 서버는 음성 → STT(stt.ts, 키 없으면 생략) → 프레임 + 녹취를 빠른 모델(Haiku)에 넣어 JSON 요약을 만든다.
 * 결과는 그 영상(자료실 파일)의 meta.video_digest 와 text_content 에 저장 → 이후 AI 비서에 영상을 첨부하면 글자 요약만 들어가고(fileBlocks 의 text_content 경로),
 * 자료실 검색에도 걸린다. mode 'review' 는 마케팅 시안 검토 관점(자막 오타·브랜드 톤·구성·길이)도 함께.
 */
import { z } from 'zod';
import { db } from '../db';
import { HttpError, badRequest, notFound } from '../errors';
import { denyDemo } from '../access';
import { todaySeoul } from '../time';
import { loadLibraryFile, tenantOf } from '../library';
import { anthropicProvider, aiEnabled, costUsd, type AiProvider } from './provider';
import { sttConfigured, sttCostUsd, transcribeAudio } from './stt';
import type { SessionUser } from '../types';

export const MAX_FRAMES = 20;
export const videoDigestInput = z.object({
  fileId: z.string().uuid(),
  duration: z.number().min(0).max(4 * 3600).optional(),
  frames: z.array(z.object({ t: z.number().min(0), data: z.string().min(1).max(200_000) })).max(MAX_FRAMES).default([]),
  audioFileId: z.string().uuid().optional(),
  mode: z.enum(['summary', 'review']).default('summary'),
  hint: z.string().max(1000).optional(),
});
export type VideoDigest = {
  summary: string; scenes: { t: number; text: string }[]; todos: { title: string; detail: string; due: string | null }[];
  review: string[]; transcript: string | null; sttNote: string | null; frames: number; duration: number | null; mode: 'summary' | 'review'; at: string;
};
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    scenes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { t: { type: 'number' }, text: { type: 'string' } }, required: ['t', 'text'] } },
    todos: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, detail: { type: 'string' }, due: { type: ['string', 'null'] } }, required: ['title', 'detail', 'due'] } },
    review: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'scenes', 'todos', 'review'],
};
const mmss = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** 저장할 글자(자료실 검색·AI 비서 첨부에 쓰임) */
export function digestText(d: VideoDigest, title: string) {
  const lines = [`[영상 요약: ${title}]${d.duration ? ` 길이 ${mmss(d.duration)}` : ''} · 프레임 ${d.frames}장${d.transcript ? ' · 음성 녹취 있음' : d.sttNote ? ` · ${d.sttNote}` : ''}`, d.summary];
  if (d.scenes.length) lines.push('', '장면:', ...d.scenes.map((s) => `- ${mmss(s.t)} ${s.text}`));
  if (d.todos.length) lines.push('', '할 일 후보:', ...d.todos.map((t) => `- ${t.title}${t.due ? ` (기한 ${t.due})` : ''} — ${t.detail}`));
  if (d.review.length) lines.push('', '검토 의견:', ...d.review.map((r) => `- ${r}`));
  if (d.transcript) lines.push('', '[음성 녹취]', d.transcript.slice(0, 20000));
  return lines.join('\n');
}

export async function digestVideo(u: SessionUser, i: z.infer<typeof videoDigestInput>, provider: AiProvider = anthropicProvider({ tier: 'fast' })) {
  denyDemo(u);
  if (!aiEnabled()) throw notFound();
  await (await import('../menuPerms')).requireMenu(u, 'assistant', 'use');
  const sql = db(); const tenant = tenantOf(u);
  const f = await loadLibraryFile(u, i.fileId, 'ai');
  if (!/^video\//i.test(f.mime_type)) throw badRequest('영상 파일이 아닙니다');
  if (!i.frames.length && !i.audioFileId) throw badRequest('프레임이나 음성이 필요합니다');
  await (await import('../plans')).assertAiRequest(u, { legacy: true }); // 회사 월 AI 예산(원)·예전 달러 한도·요청 수

  // 1) 음성 → 글자 (키 없으면 건너뜀). 음성 파일은 쓰고 나면 자료실에서 지운다(영상 원본만 남김)
  let transcript: string | null = null; let sttNote: string | null = null;
  if (i.audioFileId) {
    const a = await loadLibraryFile(u, i.audioFileId, 'ai').catch(() => null);
    if (!a || a.created_by !== u.id) throw badRequest('음성 파일을 찾을 수 없습니다');
    if (!sttConfigured()) sttNote = '음성 녹취 없음(STT 미설정)';
    else {
      try {
        const { getObject } = await import('../storage');
        const r = await transcribeAudio(await getObject(a.storage_key), a.file_name, a.mime_type);
        transcript = r.text || null; if (!transcript) sttNote = '음성에서 말을 찾지 못함';
        const secs = i.duration ?? Math.max(1, Number(a.size_bytes) / 32000); // WAV 16kHz·16bit·모노 = 32KB/초
        await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
          values (${tenant}, ${u.id}, ${crypto.randomUUID()}, 'openai', ${r.model}, 0, 0, 0, 0, ${sttCostUsd(secs)}, 'stt')`;
      } catch (e) { sttNote = `음성 녹취 실패: ${(e as Error).message}`.slice(0, 200); }
    }
    await sql`update library_files set deleted_at = now(), updated_at = now() where id = ${a.id} and tenant = ${tenant}`.catch(() => {});
  }

  // 2) 프레임 + 녹취 → 요약 JSON (빠른 모델)
  const system = `워크인 AI 비서의 영상 요약 도우미입니다. 사용자가 올린 영상에서 뽑은 장면 사진(시각 순)과 음성 녹취만 받습니다(영상 원본은 없음).
한국어로, 본 것·들은 것만 근거로 답하고 없는 내용은 지어내지 마세요. 사람 얼굴·개인 평가는 하지 마세요.
JSON 으로만 답하세요: summary(3~6문장 요약), scenes(장면별 한 줄, t 는 그 장면 사진의 초), todos(영상에서 드러난 할 일·후속 조치 최대 8개: title 짧게, detail 한두 문장, due 는 말한 기한이 있으면 YYYY-MM-DD 아니면 null), review(${i.mode === 'review' ? '마케팅 시안 검토 의견 3~8개: 자막·문구 오타, 브랜드 톤, 구성·길이·훅, 고칠 점' : '빈 배열'}).
오늘: ${todaySeoul()} (Asia/Seoul).`;
  const blocks: any[] = [];
  for (const fr of i.frames.slice(0, MAX_FRAMES)) {
    blocks.push({ type: 'text', text: `장면 ${mmss(fr.t)}` });
    blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fr.data.replace(/^data:image\/\w+;base64,/, '') } });
  }
  const ask = [`영상 "${f.title}"${i.duration ? ` (길이 ${mmss(i.duration)})` : ''}을 요약하고 할 일을 뽑아 주세요.`, i.hint ? `요청: ${i.hint}` : '', transcript ? `\n[음성 녹취]\n${transcript.slice(0, 30000)}` : sttNote ? `\n(음성 녹취 없음 — ${sttNote})` : '\n(음성 없음)'].filter(Boolean).join('\n');
  blocks.push({ type: 'text', text: ask });
  const r = await provider.chat({ system, tools: [], format: SCHEMA, messages: [{ role: 'user', content: blocks }] });
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenant}, ${u.id}, ${crypto.randomUUID()}, ${provider.name}, ${r.model ?? provider.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0},
      ${r.usage.cache_creation_input_tokens ?? 0}, ${costUsd(r.model ?? provider.model, r.usage)}, 'video')`;
  if (r.stop_reason === 'refusal') throw badRequest('이 영상은 요약할 수 없습니다');
  const text = r.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
  let j: any; try { j = JSON.parse(text); } catch { throw new HttpError(502, 'ai_bad_output', 'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.'); }
  const d: VideoDigest = {
    summary: String(j.summary ?? '').slice(0, 4000),
    scenes: (Array.isArray(j.scenes) ? j.scenes : []).slice(0, MAX_FRAMES).map((s: any) => ({ t: Math.max(0, Number(s?.t) || 0), text: String(s?.text ?? '').slice(0, 300) })).filter((s: any) => s.text),
    todos: (Array.isArray(j.todos) ? j.todos : []).slice(0, 8).map((t: any) => ({ title: String(t?.title ?? '').slice(0, 200), detail: String(t?.detail ?? '').slice(0, 1000), due: /^\d{4}-\d{2}-\d{2}$/.test(t?.due ?? '') ? t.due : null })).filter((t: any) => t.title),
    review: (Array.isArray(j.review) ? j.review : []).slice(0, 10).map((x: unknown) => String(x).slice(0, 500)).filter(Boolean),
    transcript, sttNote, frames: i.frames.length, duration: i.duration ?? null, mode: i.mode, at: new Date().toISOString(),
  };
  const textContent = digestText(d, f.title);
  await sql`update library_files set meta = coalesce(meta, '{}'::jsonb) || ${sql.json({ video_digest: d } as never)}::jsonb, text_content = ${textContent}, text_error = null, text_tried_at = now(), updated_at = now() where id = ${f.id} and tenant = ${tenant}`;
  return { ok: true, fileId: f.id, digest: d, text: textContent };
}
