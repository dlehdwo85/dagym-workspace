'use client';
import { api } from './client';
import { shrinkImage } from './Attachments';

/** V12 8번: AI 에 보낼 자료를 회사 자료실(폴더 "AI 요청 첨부")에 올리고 id 를 돌려준다. 사진은 긴 변 1600px 로 줄임 */
export async function uploadToLibrary(raw: File, folder = 'AI 요청 첨부'): Promise<{ id: string; name: string }> {
  const file = await shrinkImage(raw);
  const r = await api('/api/library', { body: { fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, folder, tags: ['AI 첨부'] } });
  const up = await fetch(r.upload.url, { method: 'PUT', headers: r.upload.headers, body: file });
  if (!up.ok) throw new Error(`파일 전송 실패 (${up.status})`);
  await api(`/api/library/${r.id}/complete`, { body: {} });
  return { id: r.id, name: file.name };
}
export const AI_ACCEPT = 'image/*,.pdf,.xlsx,.docx,.pptx,.txt,.csv,.md';
