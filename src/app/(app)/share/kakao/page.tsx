'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/components/client';
import { Empty, ErrorBox, Loading } from '@/components/ui';
import { KakaoSend } from '@/components/KakaoSend';

type Msg = { id: number; role: string; draft: { channel: string; subject: string; body: string } | null };

/** V28-2A PC 에서 QR 로 넘어온 카카오톡 보내기 — 휴대폰에서 같은 초안을 열고 카카오톡으로 보낸다 */
function KakaoHandoff() {
  const sp = useSearchParams();
  const t = sp.get('t') ?? ''; const m = Number(sp.get('m'));
  const ok = /^[0-9a-f-]{36}$/.test(t);
  const hist = useApi<{ messages: Msg[] }>(ok ? `/api/tasks/${t}/assist` : null, [t]);
  if (!ok) return <Empty title="잘못된 주소입니다" />;
  if (hist.error) return <ErrorBox error={hist.error} />;
  if (!hist.data) return <Loading />;
  const drafts = hist.data.messages.filter((x) => x.draft?.channel === 'kakao' && (x.draft.subject || x.draft.body));
  const msg = drafts.find((x) => x.id === m) ?? drafts.at(-1);
  if (!msg) return <Empty title="보낼 카카오톡 초안이 없습니다" />;
  const body = [msg.draft!.subject, msg.draft!.body].filter(Boolean).join('\n\n');
  return (
    <div className="mx-auto max-w-lg space-y-3" data-testid="kakao-handoff">
      <h1 className="text-lg font-bold">카카오톡으로 보내기</h1>
      <p className="whitespace-pre-wrap rounded-card border border-line bg-white p-3 text-sm">{body}</p>
      <KakaoSend taskId={t} msgId={msg.id} body={body} big />
      <Link href={`/tasks/${t}`} className="block text-center text-sm text-ink-2 underline">업무로 돌아가기</Link>
    </div>
  );
}
export default function Page() { return <Suspense fallback={<Loading />}><KakaoHandoff /></Suspense>; }
