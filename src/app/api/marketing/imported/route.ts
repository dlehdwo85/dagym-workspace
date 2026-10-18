import { handler } from '@/lib/api';
import { importedData } from '@/lib/opsImport';

/** 가져온 운영실 원본(마케팅 공간 관리자만, 전화 기록 조회는 감사 기록) */
export const GET = handler(async ({ req, user }) => importedData(user, { key: req.nextUrl.searchParams.get('key') ?? undefined, offset: Number(req.nextUrl.searchParams.get('offset')) || 0 }));
