'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * #242 2단계(대표 10/24 '창 닫기·돌아가기를 누르면 다른 화면으로 넘어가지 않게'): 화면 상태(탭·필터·검색어·보던 달)를 주소 검색어에 둔다.
 * 다른 화면에 갔다 뒤로가기로 와도, 새로 고침·링크 공유에도 같은 화면. 바꿀 때는 기록을 쌓지 않음(replaceState).
 * 기본값이면 주소에서 뺀다. 메뉴·링크 이동이나 뒤로가기로 같은 화면의 다른 주소가 되면 그 주소 값을 따른다.
 */
export function useUrlState(key: string, init: string): [string, (v: string) => void] {
  const sp = useSearchParams();
  const [v, setV] = useState(() => sp.get(key) ?? init);
  const wrote = useRef<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if ((p.get(key) ?? init) === v) { wrote.current = p.toString(); return; }
    if (v === init) p.delete(key); else p.set(key, v);
    wrote.current = p.toString();
    replaceUrl(`${location.pathname}${wrote.current ? `?${wrote.current}` : ''}`);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // 내가 쓴 주소·아직 따라오는 중인 주소(sp ≠ 실제 주소)는 무시
    const s = sp.toString();
    if (s !== new URLSearchParams(location.search).toString() || s === wrote.current) return;
    setV(sp.get(key) ?? init);
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  return [v, setV];
}

/** 이 칸의 기록 값에서 Next 내부 값(__NA·라우터 트리)을 뺀 것 — 이것을 넘겨야 Next 라우터도 새 주소를 알아 useSearchParams 가 따라온다
 *  (내부 값까지 넘기면 Next 는 자기 호출로 보고 라우터를 그대로 둠 → 다음 라우터 갱신 때 옛 주소로 되돌아가거나, 뒤로가기로 돌아온 화면이 ?id= 를 못 읽음) */
export function ownState(): Record<string, unknown> {
  const { __NA, __PRIVATE_NEXTJS_INTERNALS_TREE, ...own } = (window.history.state ?? {}) as Record<string, unknown>;
  void __NA; void __PRIVATE_NEXTJS_INTERNALS_TREE;
  return own;
}
export const replaceUrl = (url: string) => window.history.replaceState(ownState(), '', url);

/** 마지막 뒤로·앞으로 가기(popstate) 시각 — 뒤로가기로 돌아와 다시 그려진 화면만 보던 자리를 되살리려고(새로 들어온 화면은 처음부터) */
let popAt = 0;
if (typeof window !== 'undefined') window.addEventListener('popstate', () => { popAt = Date.now(); });
export const cameBack = () => Date.now() - popAt < 3000;
