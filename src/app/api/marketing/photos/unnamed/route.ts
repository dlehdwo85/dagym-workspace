import { handler } from '@/lib/api';
import { unnamedPhotos } from '@/lib/mktPhotos';

/** 290차 브랜드 이름 없는 사진 정리: 어느 브랜드 이름도 없는 실사 + 추천 브랜드·까닭(사람이 확인 뒤 지정) */
export const GET = handler(async ({ req, user }) => unnamedPhotos(user, { offset: Number(req.nextUrl.searchParams.get('offset')) || 0, limit: Number(req.nextUrl.searchParams.get('limit')) || 48 }));
