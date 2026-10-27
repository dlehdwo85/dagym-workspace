'use client';
import { Play } from 'lucide-react';
import { cx } from './ui';

/**
 * 대표 10/21 02:00 핫픽스: 릴스·쇼츠 영상 시안이 <img> 로 그려져 빈 칸으로 보임 → mime 이 video/* 면 <video> 로.
 * - 썸네일(카드·목록): 첫 프레임 정지 화면(#t=0.1) + ▶ 배지, 같은 버전에 이미지(-thumb)가 있으면 그것을 poster 로.
 * - 크게 보기·상세 미리보기: controls·playsinline·preload=metadata(세로 9:16 그대로).
 * 자료실·업무 첨부도 같은 컴포넌트를 쓴다. 서버는 video/mp4 + Range 206 을 이미 지원.
 */
export const isVideoMime = (m: string | null | undefined) => /^video\//.test(m ?? '');
export const isImageMime = (m: string | null | undefined) => /^image\//.test(m ?? '');
export type MediaInfo = { id: string; mime: string | null };
/** 같은 버전 안에서 영상의 포스터로 쓸 이미지(첫 이미지) */
export const posterFrom = (info: MediaInfo[] | null | undefined, selfId: string) => info?.find((x) => x.id !== selfId && isImageMime(x.mime))?.id ?? null;
export const mimeOf = (info: MediaInfo[] | null | undefined, id: string) => info?.find((x) => x.id === id)?.mime ?? null;

export function MediaThumb({ src, mime, poster, className, alt = '' }: { src: string; mime: string | null | undefined; poster?: string | null; className?: string; alt?: string }) {
  if (!isVideoMime(mime)) return <img src={src} alt={alt} className={className} loading="lazy" />;
  return (
    <span className={cx('relative block overflow-hidden bg-black', className)} data-testid="media-video-thumb">
      <video src={`${src}#t=0.1`} poster={poster ?? undefined} muted playsInline preload="metadata" className="size-full object-cover" aria-label={alt || '영상'} />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/55 p-1.5 text-white"><Play className="size-4" fill="currentColor" /></span></span>
    </span>
  );
}
/** lazy(#210 승인함): 사진은 화면 가까이 올 때 받고, 영상은 누를 때 받음(넘겨 보기 둘째 장부터·블로그 본문 사진) */
export function MediaFull({ src, mime, poster, className, alt = '', onClick, lazy = false }: { src: string; mime: string | null | undefined; poster?: string | null; className?: string; alt?: string; onClick?: (e: React.MouseEvent) => void; lazy?: boolean }) {
  if (!isVideoMime(mime)) return <img src={src} alt={alt} className={className} onClick={onClick} loading={lazy ? 'lazy' : undefined} />;
  return <video src={src} poster={poster ?? undefined} controls playsInline preload={lazy ? 'none' : 'metadata'} className={cx('bg-black', className)} onClick={onClick} data-testid="media-video" aria-label={alt || '영상'} />;
}
