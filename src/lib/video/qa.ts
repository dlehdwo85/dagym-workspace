import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../db';
import { ffmpegOk } from './ffmpeg';

/**
 * #454 ⑦ 비전 AI 검수: 장면 클립마다 사진 2장(30%·75% 지점)을 뽑아 한 번에 묻는다.
 * 걸리는 것 = 화면 안 글자(외국어·깨진 글자·간판·UI 글자) · 한국인이 아닌 사람 · 서양식 배경 · 깨진 화면(손·얼굴 뭉개짐, 이상한 움직임 흔적).
 * 걸린 장면은 한 번 다시 만들고(설정), 그래도 걸리면 '사람 검수 필요'로 승인함에 올린다. AI 가 꺼졌거나 한도면 검수 못 함 = 사람 검수 필요.
 */
export type SceneQa = { checked: boolean; ok: boolean; issues: string[] };
const SCHEMA = { type: 'object', additionalProperties: false, required: ['scenes'], properties: { scenes: { type: 'array', items: { type: 'object', additionalProperties: false,
  required: ['scene', 'foreignText', 'nonKorean', 'westernSetting', 'broken', 'issues'],
  properties: { scene: { type: 'integer' }, foreignText: { type: 'boolean' }, nonKorean: { type: 'boolean' }, westernSetting: { type: 'boolean' }, broken: { type: 'boolean' }, issues: { type: 'array', items: { type: 'string' } } } } } } };

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

export async function qaScenes(tenant: string, actorId: string | null, dir: string, clips: { k: number; file: string; seconds: number; visual: string }[]): Promise<Map<number, SceneQa>> {
  const res = new Map<number, SceneQa>();
  const skip = (why: string) => { for (const c of clips) res.set(c.k, { checked: false, ok: false, issues: [why] }); return res; };
  if (!clips.length) return res;
  const P = await import('../ai/provider');
  if (!P.aiEnabled()) return skip('AI 가 꺼져 있어 자동 검수를 못 했습니다');
  try { const { assertMktAi } = await import('../mktAuto'); await assertMktAi(tenant); } catch (e: any) { return skip(`AI 한도로 자동 검수를 못 했습니다(${String(e?.message ?? e).slice(0, 80)})`); }
  const blocks: any[] = [];
  for (const c of clips) {
    const fr = await frames(dir, c.file, c.seconds, c.k);
    blocks.push({ type: 'text', text: `장면 ${c.k + 1} (의도: ${c.visual.slice(0, 200)})` });
    for (const b of fr) blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } });
  }
  blocks.push({ type: 'text', text: `위 장면들은 한국 대기업 수준 광고 영상을 위해 AI 가 만든 클립에서 뽑은 사진입니다(장면마다 2장). 장면마다 판단해 JSON 으로만 답하세요.
- foreignText: 화면 안에 글자가 보이면 true(영어·외국어·깨진 글자·간판·화면 UI 글자·숫자 모두. 한글 자막은 나중에 따로 넣으므로 화면 안 글자는 전부 문제)
- nonKorean: 한국인(동아시아인)이 아닌 사람이 보이면 true
- westernSetting: 서양식 주택·외국 거리·외국 간판처럼 한국이 아닌 배경이면 true
- broken: 손가락·얼굴·몸이 뭉개지거나 이상함, 물체가 녹아내림, 심한 흐림·깨짐이면 true
- issues: 문제를 한국어로 짧게(문제가 없으면 빈 배열). scene 은 장면 번호(1부터).` });
  try {
    const p = P.anthropicProvider({ tier: 'default' });
    const r = await p.chat({ system: '당신은 광고 영상 품질 검수자입니다. 보이는 것만 근거로 판단하고, 애매하면 문제로 표시합니다.', tools: [], format: SCHEMA, messages: [{ role: 'user', content: blocks }] });
    await db()`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
      values (${tenant}, ${actorId}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${P.costUsd(r.model ?? p.model, r.usage)}, 'marketing_studio')`;
    const j = JSON.parse((r.content as any[]).filter((x) => x.type === 'text').map((x) => x.text).join(''));
    for (const s of Array.isArray(j?.scenes) ? j.scenes : []) {
      const c = clips.find((x) => x.k === Number(s?.scene) - 1); if (!c) continue;
      const flags = [s.foreignText && '화면 안 글자', s.nonKorean && '한국인이 아닌 사람', s.westernSetting && '서양식 배경', s.broken && '깨진 화면'].filter(Boolean) as string[];
      const issues = [...new Set([...flags, ...(Array.isArray(s.issues) ? s.issues.map((x: unknown) => String(x).slice(0, 80)) : [])])].slice(0, 6);
      res.set(c.k, { checked: true, ok: !flags.length, issues: flags.length ? issues : [] });
    }
    for (const c of clips) if (!res.has(c.k)) res.set(c.k, { checked: false, ok: false, issues: ['검수 답에 이 장면이 없습니다'] });
    return res;
  } catch (e: any) { return skip(`자동 검수 실패(${String(e?.message ?? e).slice(0, 80)})`); }
}
