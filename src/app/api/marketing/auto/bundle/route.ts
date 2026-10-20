import { handler, body } from '@/lib/api';
import { createBundle, bundleInput, updateBundle, bundlePatch } from '@/lib/mktAuto';

/** 대표 10/20 6): 기본 묶음(쇼츠·릴스·블로그·게시물(인스타+페북)·스토리(인스타+페북)) 규칙 5개를 2~3일마다 — 브랜드마다 */
export const POST = handler(async ({ req, user }) => createBundle(user, await body(req, bundleInput)));
/** 로컬 10/20 보완: 묶음 시각·요일/주기·주말 건너뛰기 한 번에 */
export const PATCH = handler(async ({ req, user }) => updateBundle(user, await body(req, bundlePatch)));
