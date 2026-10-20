import type { SessionUser } from './types';

/** 생성 결과(URL)를 자료실(마케팅 공간)에 복사 저장 — 원본 URL 에 의존하지 않게 */
export async function saveUrlToLibrary(u: SessionUser, url: string, mime: string, title: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`결과 내려받기 실패 ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > 50 * 1024 * 1024) throw new Error('결과 파일이 50MB 를 넘습니다');
  const { saveGeneratedFile } = await import('./library');
  const ext = mime.startsWith('video/') ? 'mp4' : 'png';
  const f = await saveGeneratedFile(u, { fileName: `${title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}.${ext}`, mime, data, title, folder: '마케팅', tags: ['제작의뢰실', 'AI 생성'], source: 'ai', space: 'marketing' });
  return f.id;
}
