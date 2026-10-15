import { headers } from 'next/headers';
import { openShare } from '@/lib/mailbox';
import { biz } from '@/components/Legal';

export const dynamic = 'force-dynamic';
export const metadata = { title: '자료 내려받기', robots: { index: false, follow: false } };

const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);

/** V21 기간 다운로드 링크(로그인 없음) — 페이지 열람·파일 내려받기를 기록하고, 처음 열리면 업무에 "고객이 자료를 열어봄" */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
  let data: Awaited<ReturnType<typeof openShare>> | null = null;
  try { data = await openShare(token, ip, h.get('user-agent')); } catch { data = null; }
  return (
    <main className="mx-auto min-h-dvh max-w-lg bg-white px-4 py-10">
      {!data ? (
        <p className="text-center text-sm text-ink-2" data-testid="share-gone">링크가 없거나 내려받을 수 있는 기간이 지났습니다. 보낸 분께 다시 요청해 주세요.</p>
      ) : (
        <>
          {/* V34 A5: 워크인 표시 + 메일·문자에서 고른 "보낸 회사" */}
          <p className="text-xs font-semibold tracking-wide text-brand-700">워크인</p>
          <h1 className="mt-1 text-lg font-bold text-ink" data-testid="share-company">{data.company ? `${data.company}에서 보낸 자료` : '보내 드린 자료'}</h1>
          <p className="mt-1 text-xs text-ink-3">{data.expiresAt.slice(0, 10)}까지 내려받을 수 있습니다.</p>
          <ul className="mt-5 divide-y divide-line rounded-card border border-line" data-testid="share-files">
            {data.files.map((f) => (
              <li key={f.n} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.name}</span>
                <span className="text-xs tabular-nums text-ink-3">{size(f.size)}</span>
                <a href={`/api/public/share/${token}/${f.n}`} className="rounded-input bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">내려받기</a>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-10 text-center text-[11px] text-ink-3">워크인(업무·일정 관리 서비스)으로 보낸 자료입니다 · 운영 {biz().name}</p>
    </main>
  );
}
