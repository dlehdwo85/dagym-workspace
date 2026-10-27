import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../db';
import { ffmpegOk } from './ffmpeg';

/**
 * #454 ⑦ 비전 AI 검수: 장면 클립마다 사진 2장(30%·75% 지점)을 뽑아 한 번에 묻는다.
 * 걸리는 것 = 화면 안 글자(외국어·깨진 글자·간판·UI 글자) · 한국인이 아닌 사람 · 서양식 배경 · 깨진 화면(손·얼굴 뭉개짐, 이상한 움직임 흔적).
 * 걸린 장면은 한 번 다시 만들고(설정), 그래도 걸리면 '사람 검수 필요'로 승인함에 올린다. AI 가 꺼졌거나 한도면 검수 못 함 = 사람 검수 필요.
 * 209차 #666 ⑦ 하이링크 검수 기준: 같은 사진으로 밝기(평균, AI 없이도 — 어두운 화면이면 다시 만듦)와 주인공 정면 여부(정면 컷 수는 편 단위로 mktVideo 가 셈)도 본다.
 */
export type SceneQa = { checked: boolean; ok: boolean; issues: string[]; front?: boolean | null; luma?: number | null };
/** 어두운 컷 기준 — 사진 2장 평균 밝기(0~255)가 이보다 낮으면 '어두운 화면'(낮 자연광으로 톤 통일, 어두운 컷 0) */
export const DARK_LUMA = 60;
const SCHEMA = { type: 'object', additionalProperties: false, required: ['scenes'], properties: { scenes: { type: 'array', items: { type: 'object', additionalProperties: false,
  required: ['scene', 'foreignText', 'nonKorean', 'westernSetting', 'broken', 'frontFace', 'issues'],
  properties: { scene: { type: 'integer' }, foreignText: { type: 'boolean' }, nonKorean: { type: 'boolean' }, westernSetting: { type: 'boolean' }, broken: { type: 'boolean' }, frontFace: { type: 'boolean' }, issues: { type: 'array', items: { type: 'string' } } } } } } };

/** 클립에서 검수용 사진 2장(JPEG, 긴 변 640) */
async function frames(dir: string, file: string, seconds: number, k: number) {
  const out: Buffer[] = [];
  for (const [n, at] of [[0, 0.3], [1, 0.75]] as const) {
    const name = `qa-${k}-${n}.jpg`;
    await ffmpegOk(['-ss', (Math.max(0.2, seconds * at)).toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=640:640:force_original_aspect_ratio=decrease', '-q:v', '4', name], { cwd: dir, timeoutMs: 30_000 });
    out.push(await readFile(join(dir, name)));
  }
  return out;
}

/** 사진 평균 밝기(0~255) */
async function luma(bufs: Buffer[]) {
  const sharp = (await import('sharp')).default; let sum = 0;
  for (const b of bufs) sum += (await sharp(b).greyscale().stats()).channels[0].mean;
  return Math.round(sum / Math.max(1, bufs.length));
}

export async function qaScenes(tenant: string, actorId: string | null, dir: string, clips: { k: number; file: string; seconds: number; visual: string }[]): Promise<Map<number, SceneQa>> {
  const res = new Map<number, SceneQa>();
  if (!clips.length) return res;
  const shots = new Map<number, Buffer[]>(); const lm = new Map<number, number>();
  try { for (const c of clips) { const fr = await frames(dir, c.file, c.seconds, c.k); shots.set(c.k, fr); lm.set(c.k, await luma(fr)); } }
  catch { for (const c of clips) res.set(c.k, { checked: false, ok: false, issues: ['검수용 사진을 뽑지 못했습니다'], front: null, luma: null }); return res; }
  const dark = (k: number) => (lm.get(k) ?? 255) < DARK_LUMA;
  const skip = (why: string) => { for (const c of clips) res.set(c.k, { checked: false, ok: false, issues: [...(dark(c.k) ? ['어두운 화면'] : []), why], front: null, luma: lm.get(c.k) ?? null }); return res; };
  const P = await import('../ai/provider');
  if (!P.aiEnabled()) return skip('AI 가 꺼져 있어 자동 검수를 못 했습니다');
  try { const { assertMktAi } = await import('../mktAuto'); await assertMktAi(tenant, { video: true }); } catch (e: any) { return skip(`AI 한도로 자동 검수를 못 했습니다(${String(e?.message ?? e).slice(0, 80)})`); }
  const blocks: any[] = [];
  for (const c of clips) {
    blocks.push({ type: 'text', text: `장면 ${c.k + 1} (의도: ${c.visual.slice(0, 200)})` });
    for (const b of shots.get(c.k) ?? []) blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } });
  }
  blocks.push({ type: 'text', text: `위 장면들은 한국 대기업 수준 광고 영상을 위해 AI 가 만든 클립에서 뽑은 사진입니다(장면마다 2장). 장면마다 판단해 JSON 으로만 답하세요.
- foreignText: 화면 안에 글자가 보이면 true(영어·외국어·깨진 글자·간판·화면 UI 글자·숫자 모두. 한글 자막은 나중에 따로 넣으므로 화면 안 글자는 전부 문제)
- nonKorean: 한국인(동아시아인)이 아닌 사람이 보이면 true
- westernSetting: 서양식 주택·외국 거리·외국 간판처럼 한국이 아닌 배경이면 true
- broken: 손가락·얼굴·몸이 뭉개지거나 이상함, 물체가 녹아내림, 심한 흐림·깨짐이면 true
- frontFace: 주인공의 얼굴이 카메라 쪽(정면 또는 3/4 각도)으로 보이고 표정을 알아볼 수 있으면 true(뒷모습·옆모습·손만·사람 없음은 false)
- issues: 문제를 한국어로 짧게(문제가 없으면 빈 배열). scene 은 장면 번호(1부터).` });
  try {
    const p = P.anthropicProvider({ tier: 'default' });
    const r = await p.chat({ system: '당신은 광고 영상 품질 검수자입니다. 보이는 것만 근거로 판단하고, 애매하면 문제로 표시합니다.', tools: [], format: SCHEMA, messages: [{ role: 'user', content: blocks }] });
    await db()`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
      values (${tenant}, ${actorId}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${P.costUsd(r.model ?? p.model, r.usage)}, 'marketing_video_qa')`; // 영상 제작 몫 — 회사 AI 예산에서 뺌(companyBudget VIDEO_PURPOSE)
    const j = JSON.parse((r.content as any[]).filter((x) => x.type === 'text').map((x) => x.text).join(''));
    for (const s of Array.isArray(j?.scenes) ? j.scenes : []) {
      const c = clips.find((x) => x.k === Number(s?.scene) - 1); if (!c) continue;
      const flags = [s.foreignText && '화면 안 글자', s.nonKorean && '한국인이 아닌 사람', s.westernSetting && '서양식 배경', s.broken && '깨진 화면', dark(c.k) && '어두운 화면'].filter(Boolean) as string[];
      const issues = [...new Set([...flags, ...(Array.isArray(s.issues) ? s.issues.map((x: unknown) => String(x).slice(0, 80)) : [])])].slice(0, 6);
      res.set(c.k, { checked: true, ok: !flags.length, issues: flags.length ? issues : [], front: s.frontFace === true, luma: lm.get(c.k) ?? null });
    }
    for (const c of clips) if (!res.has(c.k)) res.set(c.k, { checked: false, ok: false, issues: ['검수 답에 이 장면이 없습니다'], front: null, luma: lm.get(c.k) ?? null });
    return res;
  } catch (e: any) { return skip(`자동 검수 실패(${String(e?.message ?? e).slice(0, 80)})`); }
}
