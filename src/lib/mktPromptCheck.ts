/**
 * #534(대표 10/23 'AI 마케터가 힉스필드나 자체 제작에 넘기는 프롬프트 수준이 낮다'): 제작 프롬프트 필수 칸 8개 · 검사 점수 · 빠진 칸 보강.
 * 근거: docs/handoff/AI_KIT_RESEARCH_2026-10-23.md · TECHTREE_VIDEOS_2026-10-23.md(참고 파일을 이름으로·실제 배경 사진·짧은 동작 지시) · MKT_AGENT_SKILLS_2026-10-22.md · kit-ko-copy
 * ① 장면(누가·어디서·무엇을 + 작은 감정 변화) ② 한국인·한국 배경 ③ 카메라(렌즈·앵글·움직임) ④ 빛·브랜드 키트 색 ⑤ 구도(4:5·9:16, 아래 24% 비움)
 * ⑥ 소품 ⑦ 금지(화면 글자·로고·외국어 간판·손 왜곡) ⑧ 자료실 참고 사진
 * 검사는 프롬프트 글 자체를 봄(사람이 고친 프롬프트도) — 빠진 칸은 AI 가 쓴 칸(fields)으로, 없으면 기본값으로 프롬프트 끝에 한 줄씩 붙임. 순수 함수.
 */
export type PromptFields = { who?: string; where?: string; action?: string; emotion?: string; lens?: string; angle?: string; movement?: string; light?: string; props?: string[] };
export type PromptCtx = { aspect: string; px: string; video: boolean; brandColors: string[]; refAvailable: number };
export type PromptCheck = { score: number; before: number; items: { key: string; label: string; ok: boolean; note?: string }[]; fixed: string[]; by: 'ai' | 'default' | null };
export const PROMPT_ITEMS = [
  { key: 'scene', label: '장면(누가·어디서·무엇을·감정 변화)' }, { key: 'korean', label: '한국인·한국 배경' }, { key: 'camera', label: '카메라(렌즈·앵글·움직임)' },
  { key: 'light', label: '빛·브랜드 키트 색' }, { key: 'composition', label: '구도(비율·아래 24% 비움)' }, { key: 'props', label: '소품' },
  { key: 'negative', label: '금지(화면 글자·로고·외국어 간판·손 왜곡)' }, { key: 'refs', label: '자료실 참고 사진' },
] as const;
type Key = (typeof PROMPT_ITEMS)[number]['key'];
type P = { promptEn: string; negativeEn?: string | null; refMediaIds?: string[] | null };

function tests(p: P, c: PromptCtx): Record<Key, boolean> {
  const t = p.promptEn ?? ''; const n = `${p.negativeEn ?? ''} ${t}`;
  return {
    scene: /\bscene\b/i.test(t) && /(emotion|feeling|expression|relie[fv]|smile|surprise|mood (shift|change)|from [a-z-]+ to [a-z-]+)/i.test(t),
    korean: /korean/i.test(t) && /(south korea|seoul|busan|korean (apartment|street|office|cafe|café|neighborhood|city|home|gym|complex|setting|location))/i.test(t),
    camera: /\b\d{2,3}\s?mm\b/i.test(t) && /(eye[- ]level|low[- ]angle|high[- ]angle|overhead|top[- ]down|bird'?s[- ]eye|over[- ]the[- ]shoulder|waist[- ]level)/i.test(t)
      && /(static|locked[- ]off|tripod|handheld|push[- ]in|pull[- ]back|dolly|pan|tilt|tracking|orbit|crane|slow (zoom|move))/i.test(t),
    light: /(light|lighting|sunlight|daylight|golden hour|window glow)/i.test(t) && (!c.brandColors.length || c.brandColors.some((x) => t.toLowerCase().includes(x.toLowerCase())) || /brand (kit )?colou?r/i.test(t)),
    composition: t.includes(c.aspect) && /bottom\s*24\s*%/i.test(t),
    props: /\bprops?\s*:\s*\S/i.test(t),
    negative: /(text|letters|typography|captions?)/i.test(n) && /logo/i.test(n) && /(foreign[- ]language|non-korean|english) (sign|signage|signs|text|letters)|foreign (sign|signage|signs)/i.test(n) && /(hand|finger)/i.test(n),
    refs: (p.refMediaIds?.length ?? 0) > 0,
  };
}
/** 칸별 ✓/✗ + 점수(8칸 중 맞은 비율) */
export function checkPrompt(p: P, c: PromptCtx) {
  const ok = tests(p, c);
  const items = PROMPT_ITEMS.map((x) => ({ key: x.key as string, label: x.label as string, ok: ok[x.key], ...(x.key === 'refs' && !ok.refs ? { note: c.refAvailable ? '참고 사진을 고르지 않음' : "자료실에 쓸 사진이 없음 — '마케팅/시안 바탕(글자 없는 사진)' 폴더에 올리면 자동으로 연결" } : {}) }));
  return { score: Math.round((items.filter((x) => x.ok).length / items.length) * 100), items };
}
const DEF = { who: 'a Korean adult in their 30s in casual everyday clothes', where: 'a real everyday place in South Korea', action: 'naturally using the product or service in a candid moment',
  emotion: 'from mild worry to quiet relief', lens: '35mm', angle: 'eye-level', light: 'soft natural daylight', props: ['everyday items that fit the place'] };
const clip = (v: unknown, n = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** 검사 → 빠진 칸 보강(AI 가 쓴 칸 우선, 없으면 기본값) → 다시 검사. refs 는 여기서 못 채움(부르는 쪽이 자료실 사진을 고름) */
export function supplementPrompt(p: P, c: PromptCtx, f?: PromptFields | null): { promptEn: string; negativeEn: string; check: PromptCheck } {
  const before = checkPrompt(p, c); const miss = new Set(before.items.filter((x) => !x.ok).map((x) => x.key));
  const v = (k: keyof typeof DEF & keyof PromptFields) => clip(f?.[k]) || (DEF[k] as string);
  const props = Array.isArray(f?.props) && f!.props.filter(Boolean).length ? f!.props.map((x) => clip(x, 40)).filter(Boolean).slice(0, 5) : DEF.props;
  const lines: string[] = [];
  if (miss.has('scene')) lines.push(`Scene: ${v('who')} at ${v('where')}, ${v('action')}; small emotional change: ${v('emotion')}.`);
  if (miss.has('korean')) lines.push('People & place: all people are Korean (East Asian); the setting is clearly South Korea.');
  if (miss.has('camera')) lines.push(`Camera: ${v('lens')} lens, ${v('angle')}, ${clip(f?.movement) || (c.video ? 'slow push-in' : 'static on a tripod')}.`);
  if (miss.has('light')) lines.push(`Light: ${v('light')}${c.brandColors.length ? `; brand kit color accents ${c.brandColors.join(', ')} on props, clothing or background` : ''}.`);
  if (miss.has('composition')) lines.push(`Composition: ${c.aspect} (${c.px}); keep the bottom 24% of the frame clean (no subject, no text) for Korean captions.`);
  if (miss.has('props')) lines.push(`Props: ${props.join(', ')}.`);
  const negativeEn = miss.has('negative') ? [p.negativeEn, 'on-screen text, letters, captions, logos, watermark, foreign-language signage, distorted hands, extra fingers'].filter(Boolean).join(', ') : String(p.negativeEn ?? '');
  const promptEn = (lines.length ? `${String(p.promptEn ?? '').trim()}\n\n${lines.join('\n')}` : String(p.promptEn ?? '')).slice(0, 4000);
  const after = checkPrompt({ ...p, promptEn, negativeEn }, c);
  const fixed = [...miss].filter((k) => after.items.find((i) => i.key === k)?.ok);
  const aiFields = !!f && Object.values(f).some((x) => (Array.isArray(x) ? x.length : !!x));
  return { promptEn, negativeEn: negativeEn.slice(0, 1000), check: { score: after.score, before: before.score, items: after.items, fixed, by: fixed.length ? (aiFields ? 'ai' : 'default') : null } };
}
