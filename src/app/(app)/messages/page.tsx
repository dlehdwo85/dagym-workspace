'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MessageCircle } from 'lucide-react';
import { Empty, Skeleton, cx } from '@/components/ui';
import { ChatRoom, RoomList, useLive } from '@/components/messenger/Messenger';
import { useApi } from '@/components/client';

/** V13 10번 사내 메신저 · V14 25번 개선: 왼쪽 목록 · 오른쪽 대화 (휴대폰은 한 화면씩). 패널(MessengerDock)과 같은 컴포넌트 */
export default function MessagesPage() {
  return <Suspense fallback={<Skeleton rows={6} />}><Messenger /></Suspense>;
}

function Messenger() {
  const sp = useSearchParams();
  const router = useRouter();
  const roomId = sp.get('room');
  const live = useLive();
  const unread = useApi<{ unread: number }>('/api/chat/unread');
  const open = (id: string) => router.push(`/messages?room=${id}`);
  return (
    <div className="grid h-[calc(100dvh-8.5rem-var(--sab))] min-h-[440px] overflow-hidden rounded-card border border-line bg-white shadow-card sm:h-[calc(100dvh-7rem)] sm:grid-cols-[320px_minmax(0,1fr)]">
      <aside className={cx('flex min-h-0 min-w-0 flex-col border-line sm:border-r', roomId && 'hidden sm:flex')}>
        <div className="flex items-center gap-2 px-3 pt-3"><MessageCircle className="size-5 text-teal-700" /><h1 className="text-base font-bold">메시지</h1></div>
        <RoomList activeId={roomId} onOpen={open} live={live} />
      </aside>
      <section className={cx('flex min-h-0 min-w-0 flex-col', !roomId && 'hidden sm:flex')}>
        {roomId ? <ChatRoom key={roomId} id={roomId} live={live} onRead={unread.reload} onBack={() => router.push('/messages')} />
          : <div className="flex flex-1 items-center justify-center p-10"><Empty title="대화를 고르세요" icon={MessageCircle}>왼쪽에서 대화방을 고르거나 ＋ 새 대화를 시작하세요.</Empty></div>}
      </section>
    </div>
  );
}
