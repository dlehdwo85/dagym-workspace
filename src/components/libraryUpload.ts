'use client';
import { api } from './client';
import { shrinkImage } from './Attachments';
import { putFile } from './upload';

/** V12 8번: AI 에 보낼 자료를 회사 자료실(폴더 "AI 요청 첨부")에 올리고 id 를 돌려준다. 사진은 긴 변 1600px 로 줄임 */
export async function uploadToLibrary(raw: File, folder = 'AI 요청 첨부', onProgress?: (pct: number) => void, tags: string[] = ['AI 첨부']): Promise<{ id: string; name: string }> {
  const file = await shrinkImage(raw);
  const r = await api('/api/library', { body: { fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, folder, tags, purpose: 'ai_attach' } });
  const { uploadId } = await putFile(r.upload, file, onProgress);
  await api(`/api/library/${r.id}/complete`, { body: uploadId ? { uploadId } : {} });
  return { id: r.id, name: file.name };
}
/** #109: 영상(video/*)도 — 올린 뒤 화면에서 프레임·음성만 뽑아 AI 에 보낸다(영상 자체는 안 보냄) */
export const AI_ACCEPT = 'image/*,video/*,.pdf,.xlsx,.docx,.pptx,.txt,.csv,.md';
