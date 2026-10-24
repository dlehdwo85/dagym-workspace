'use client';
import { Suspense, useEffect, useRef } from 'react';
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
  const fromList = useRef(false);
  const open = (id: string) => { fromList.current = true; router.push(`/messages?room=${id}`); };
  // #242 2단계: 대화방 ← = 직전 화면(목록에서 열었으면 목록, 업무 등에서 왔으면 그 화면). 링크·알림으로 바로 연 방만 목록으로 바꿈(예전엔 늘 목록을 새로 쌓아 뒤로가기가 다시 방으로)
  const back = () => { if (fromList.current || (((window as any).__wosNav ?? 0) > 1 && window.history.length > 1)) router.back(); else router.replace('/messages'); };
  // 대표 16:30 핫픽스(안드로이드 키보드): 대화방이 열려 있으면 휴대폰 하단 탭을 숨기고(AppShell) 칸 높이를 뷰포트에 맞춰 입력창이 키보드 위에 오게. min-h 440 이 키보드로 줄어든 뷰포트보다 커서 입력창이 탭 아래로 밀리던 문제
  useEffect(() => { if (roomId) document.documentElement.setAttribute('data-chat-room', '1'); else document.documentElement.removeAttribute('data-chat-room'); return () => document.documentElement.removeAttribute('data-chat-room'); }, [roomId]);
  return (
    <div className={cx('grid overflow-hidden rounded-card border border-line bg-white shadow-card sm:h-[calc(100dvh-7rem)] sm:min-h-[440px] sm:grid-cols-[320px_minmax(0,1fr)]', roomId ? 'h-[calc(100dvh-4.25rem-var(--sat))] min-h-0' : 'h-[calc(100dvh-8.5rem-var(--sab))] min-h-[440px]')} data-testid="messages-frame">
      <aside className={cx('flex min-h-0 min-w-0 flex-col border-line sm:border-r', roomId && 'hidden sm:flex')}>
        <div className="flex items-center gap-2 px-3 pt-3"><MessageCircle className="size-5 text-teal-700" /><h1 className="text-base font-bold">메시지</h1></div>
        <RoomList activeId={roomId} onOpen={open} live={live} />
      </aside>
      <section className={cx('flex min-h-0 min-w-0 flex-col', !roomId && 'hidden sm:flex')}>
        {roomId ? <ChatRoom key={roomId} id={roomId} live={live} onRead={unread.reload} onBack={back} />
          : <div className="flex flex-1 items-center justify-center p-10"><Empty title="대화를 고르세요" icon={MessageCircle}>왼쪽에서 대화방을 고르거나 ＋ 새 대화를 시작하세요.</Empty></div>}
      </section>
    </div>
  );
}
