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

/** 채널별 작성 화면(PC) — 휴대폰은 [앱으로 공유](공유 시트)로 사진·영상을 넘김 */
const WRITE: Record<string, { label: string; url: string }> = {
  blog: { label: '네이버 블로그 글쓰기 열기', url: NAVER_WRITE },
  instagram: { label: '인스타그램 열기(웹 만들기)', url: 'https://www.instagram.com/' },
  facebook: { label: '페이스북 비즈니스 게시물 만들기 열기', url: 'https://business.facebook.com/latest/composer' },
  threads: { label: '스레드 열기', url: 'https://www.threads.com/' },
  youtube: { label: '유튜브 스튜디오 열기(업로드)', url: 'https://studio.youtube.com/' },
  naver_place: { label: '스마트플레이스 열기(소식)', url: 'https://new.smartplace.naver.com/' },
};
const NAME: Record<string, string> = { blog: '네이버 블로그', instagram: '인스타그램', facebook: '페이스북', threads: '스레드', youtube: '유튜브', naver_place: '네이버 플레이스' };
const isPhone = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** 사진·영상 순서대로 내려받기(번호 순, 브라우저가 여러 파일 받기를 물으면 허용) */
function downloadAll(media: { id: string }[]) {
  media.forEach((m, k) => setTimeout(() => { const a = document.createElement('a'); a.href = `/api/library/${m.id}/download`; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); }, k * 700));
}
/** 휴대폰: 캡션을 복사해 두고 사진·영상을 공유 시트로 → 인스타·페이스북·스레드 앱 선택(앱은 공유된 글을 안 받으므로 붙여 넣기) */
async function shareToApp(caption: string, media: { id: string; title: string }[]) {
  try { await navigator.clipboard.writeText(caption); } catch { /* 복사 실패해도 공유는 진행 */ }
  try {
    const files = await Promise.all(media.slice(0, 10).map(async (m, k) => {
      const b = await (await fetch(`/api/library/${m.id}/download`)).blob();
      const ext = (b.type.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg').replace('quicktime', 'mov');
      return new File([b], `${String(k + 1).padStart(2, '0')}.${ext}`, { type: b.type });
    }));
    if (files.length && navigator.canShare?.({ files })) { await navigator.share({ files, text: caption }); toast.ok('글은 복사돼 있습니다 — 앱에서 붙여 넣으세요'); return; }
  } catch (e: any) { if (e?.name === 'AbortError') return; }
  downloadAll(media); toast.ok('이 기기는 바로 공유가 안 됩니다 — 사진을 내려받았고 글은 복사했습니다');
}

/**
 * 상용화 ⑤-1·⑤-2 게시 도우미: 승인된 최신 버전을 사람이 직접 올리도록 돕는다.
 * 네이버 블로그(공식 쓰기 API 없음) + 심사 통과 전의 인스타·페이스북·스레드·유튜브(대표 10/19) — 같은 구조, 채널만 다름.
 * 글 복사 → 사진·영상 순서대로 내려받기(휴대폰은 앱으로 공유) → 작성 화면 열기 → 사람이 올림 → 게시 주소를 붙여 넣어 [게시 확인].
 */
export function PublishHelper({ channel, title, body: raw, media, published = false }: { channel: string; title: string; body: string; media: { id: string; title: string }[]; published?: boolean }) {
  const naver = channel === 'blog';
  const social = ['instagram', 'facebook', 'threads'].includes(channel);
  const body = layoutBody(channel, raw); // 블로그: 소제목·문단 사이 빈 줄(예전 원고도 복사할 때 정리)
  const w = WRITE[channel];
  return (
    <div className="space-y-2 rounded-input border border-emerald-200 bg-emerald-50/40 p-3 text-xs" data-testid="publish-helper" data-channel={channel}>
      <p className="font-semibold text-emerald-900">{published ? '게시된 글 다시 쓰기(복사)' : `${NAME[channel] ?? ''} 게시 도우미`.trim()}</p>
      <ol className="list-decimal space-y-1.5 pl-4">
        <li className="flex flex-wrap items-center gap-2">
          {!social && <Button size="sm" variant="secondary" onClick={() => copy(publishTitle(title))} data-testid="ph-copy-title">제목 복사</Button>}
          <Button size="sm" variant="secondary" onClick={() => copy(body, paragraphs(body))} data-testid="ph-copy-body">{social ? '캡션 복사' : '본문 복사'}</Button>
        </li>
        <li>{media.length ? <span className="flex flex-wrap items-center gap-1.5">사진·영상 순서대로:{media.map((m, k) => <a key={m.id} href={`/api/library/${m.id}/download`} className="rounded-full bg-white px-2 py-0.5 underline" data-testid="ph-media">{k + 1}. {m.title}</a>)}
          {media.length > 1 && <button type="button" className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 font-medium text-emerald-800" onClick={() => downloadAll(media)} data-testid="ph-download-all">모두 내려받기</button>}</span>
          : <span className="text-amber-700">붙일 사진이 없습니다</span>}</li>
        {!published && social && media.length > 0 && isPhone() && <li><button type="button" className="font-medium text-emerald-800 underline" onClick={() => shareToApp(body, media)} data-testid="ph-share">{NAME[channel]} 앱으로 공유</button> — 글은 자동으로 복사됩니다. 앱에서 붙여 넣고 올리기</li>}
        {!published && w && <li><a href={w.url} target="_blank" rel="noopener" className="font-medium text-emerald-800 underline" data-testid={naver ? 'ph-open-naver' : 'ph-open-write'}>{w.label}</a> — 붙여 넣고 사진·영상을 순서대로 올린 뒤 직접 게시</li>}
        {!published && <li>올린 글 주소를 아래에 붙여 넣고 [게시 확인]</li>}
      </ol>
      {naver && !published && <p className="text-amber-800" data-testid="ph-risk">네이버는 자동 게시를 허용하지 않아 직접 올립니다(프로그램이 대신 로그인·발행하면 약관 위반으로 게재 제한될 수 있음). 같은 글을 여러 블로그에 반복해 올리면 저품질 판정 위험이 있습니다.</p>}
      {social && !published && <p className="text-ink-3" data-testid="ph-social-note">{NAME[channel]} 연결·심사가 끝나면 이 단계 없이 워크인에서 바로 게시됩니다(마케팅 › 연결 계정).</p>}
    </div>
  );
}
