'use client';
import { Button, toast } from '@/components/ui';
import { layoutBody, publishTitle } from '@/lib/mktText';

const NAVER_WRITE = 'https://blog.naver.com/GoBlogWrite.naver';
/** 본문을 네이버 편집기에 붙여 넣을 때 문단이 유지되도록 HTML(문단) + 일반 글자 둘 다 복사 */
async function copy(text: string, html?: string) {
  try {
    if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
    } else await navigator.clipboard.writeText(text);
    toast.ok('복사했습니다');
  } catch { toast.error('복사하지 못했습니다 — 글을 직접 선택해 복사해 주세요'); }
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paragraphs = (body: string) => body.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

/**
 * 상용화 ⑤-1 게시 도우미: 승인된 최신 버전을 사람이 직접 올리도록 돕는다(네이버 블로그는 공식 쓰기 API 가 없고 자동 게시는 약관 위반 위험).
 * 제목·본문 복사 → 사진 순서대로 내려받기 → 글쓰기 열기 → 사람이 [발행] → 게시 주소를 붙여 넣어 [게시 확인].
 */
export function PublishHelper({ channel, title, body: raw, media }: { channel: string; title: string; body: string; media: { id: string; title: string }[] }) {
  const naver = channel === 'blog';
  const body = layoutBody(channel, raw); // 블로그: 소제목·문단 사이 빈 줄(예전 원고도 복사할 때 정리)
  return (
    <div className="space-y-2 rounded-input border border-emerald-200 bg-emerald-50/40 p-3 text-xs" data-testid="publish-helper">
      <p className="font-semibold text-emerald-900">{naver ? '네이버 블로그 게시 도우미' : '게시 도우미'}</p>
      <ol className="list-decimal space-y-1.5 pl-4">
        <li className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => copy(publishTitle(title))} data-testid="ph-copy-title">제목 복사</Button>
          <Button size="sm" variant="secondary" onClick={() => copy(body, paragraphs(body))} data-testid="ph-copy-body">본문 복사</Button>
        </li>
        <li>{media.length ? <span className="flex flex-wrap gap-1.5">사진 순서대로 내려받기:{media.map((m, k) => <a key={m.id} href={`/api/library/${m.id}/download`} className="rounded-full bg-white px-2 py-0.5 underline" data-testid="ph-media">{k + 1}. {m.title}</a>)}</span> : <span className="text-amber-700">붙일 사진이 없습니다</span>}</li>
        {naver && <li><a href={NAVER_WRITE} target="_blank" rel="noopener" className="font-medium text-emerald-800 underline" data-testid="ph-open-naver">네이버 블로그 글쓰기 열기</a> — 붙여 넣고 사진을 순서대로 올린 뒤 직접 [발행]</li>}
        <li>올린 글 주소를 아래에 붙여 넣고 [게시 확인]</li>
      </ol>
      {naver && <p className="text-amber-800" data-testid="ph-risk">네이버는 자동 게시를 허용하지 않아 직접 올립니다(프로그램이 대신 로그인·발행하면 약관 위반으로 게재 제한될 수 있음). 같은 글을 여러 블로그에 반복해 올리면 저품질 판정 위험이 있습니다.</p>}
    </div>
  );
}
