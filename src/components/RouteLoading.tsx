// 238차(#742 대표 10/28 '버튼을 누르면 화면이 즉시 넘어가게'): 다음 화면을 받는 동안 바로 보이는 틀(제목 줄 + 목록 줄) — 이전 화면이 멈춘 채 남지 않게.
// AppShell 이 메뉴·링크를 누른 뒤 0.12초 안에 화면이 안 바뀌면 본문 자리에 그림
export function RouteLoading() {
  return (
    <div className="space-y-3" role="status" aria-label="불러오는 중" data-testid="route-loading">
      <div className="flex items-center gap-2"><span className="skeleton h-6 w-32 rounded" /><span className="ml-auto skeleton h-8 w-20 rounded-input" /></div>
      <div className="space-y-2">
        {[52, 77, 61, 85, 46, 70].map((w, i) => (
          <div key={i} className="flex items-center gap-3 rounded-input bg-white px-3 py-2.5">
            <span className="skeleton size-5 rounded-full" /><span className="skeleton h-3.5 rounded" style={{ width: `${w}%` }} />
            <span className="ml-auto skeleton h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
