import { NextResponse, type NextRequest } from 'next/server';
import { z, ZodError, type ZodTypeAny } from 'zod';
import { currentUser } from './auth';
import { db } from './db';
import { HttpError, unauthorized, badRequest, forbidden } from './errors';
import { logError } from './log';
import { describeZod } from './zod-ko';
import type { SessionUser } from './types';

type Ctx<P> = { req: NextRequest; user: SessionUser; params: P };
type PublicCtx<P> = { req: NextRequest; user: SessionUser | null; params: P };

interface Opts {
  public?: boolean;
  /** POST 요청의 Idempotency-Key 처리 (네트워크 재시도 시 중복 생성 방지) */
  idempotent?: boolean;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function checkOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  if (req.headers.get('authorization')?.startsWith('Bearer ')) return; // 네이티브 토큰 요청
  const origin = req.headers.get('origin');
  if (!origin) return; // 동일 출처 fetch 일부는 Origin 미포함 → SameSite=Lax 쿠키로 보호
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  let ok = false;
  try {
    const o = new URL(origin);
    ok = o.host === host || (process.env.APP_URL ? o.host === new URL(process.env.APP_URL).host : false);
  } catch {}
  if (!ok) throw forbidden('허용되지 않은 출처의 요청입니다');
}

export function errorResponse(e: unknown, req?: NextRequest) {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, detail: e.detail } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const d = describeZod(e);
    return NextResponse.json(
      { error: { code: 'validation', message: d.message, detail: { ...e.flatten(), fields: d.fields } } },
      { status: 400 },
    );
  }
  const err = e as Error & { code?: string };
  // 운영 DB 미설정·연결 불가는 일반 500 대신 원인을 알려 준다 (로그인 화면이 그대로 보여 줌)
  if (/DATABASE_URL/.test(err?.message ?? '')) {
    return NextResponse.json({ error: { code: 'not_configured', message: '운영 설정이 아직 끝나지 않았습니다: 데이터베이스가 연결되지 않았습니다. 관리자에게 문의하세요.' } }, { status: 503 });
  }
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'CONNECT_TIMEOUT', '28P01', '3D000', '57P01'].includes(err?.code ?? '')) {
    void logError('api', err, { path: req?.nextUrl.pathname, method: req?.method });
    return NextResponse.json({ error: { code: 'db_unavailable', message: '데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도하고, 계속되면 관리자에게 알려 주세요.' } }, { status: 503 });
  }
  void logError('api', err, { path: req?.nextUrl.pathname, method: req?.method });
  return NextResponse.json({ error: { code: 'internal', message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' } }, { status: 500 });
}

export function handler<P = Record<string, string>>(
  fn: (ctx: Ctx<P>) => Promise<unknown>,
  opts?: Opts & { public?: false },
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;
export function handler<P = Record<string, string>>(
  fn: (ctx: PublicCtx<P>) => Promise<unknown>,
  opts: Opts & { public: true },
): (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;
export function handler<P>(fn: (ctx: any) => Promise<unknown>, opts: Opts = {}) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    try {
      checkOrigin(req);
      const user = await currentUser();
      if (!user && !opts.public) throw unauthorized();
      const params = (await ctx?.params) ?? ({} as P);

      const idemKey = opts.idempotent && req.method === 'POST' ? req.headers.get('idempotency-key') : null;
      if (idemKey && user) {
        if (idemKey.length > 100) throw badRequest('Idempotency-Key 가 너무 깁니다');
        const sql = db();
        const route = req.nextUrl.pathname;
        const inserted = await sql`
          insert into idempotency_keys (user_id, key, route) values (${user.id}, ${idemKey}, ${route})
          on conflict do nothing returning key`;
        if (inserted.length === 0) {
          const prev = await sql<{ status_code: number | null; response: unknown }[]>`
            select status_code, response from idempotency_keys where user_id = ${user.id} and key = ${idemKey}`;
          if (prev[0]?.status_code) {
            return NextResponse.json(prev[0].response, { status: prev[0].status_code, headers: { 'Idempotent-Replay': 'true' } });
          }
          return NextResponse.json({ error: { code: 'in_progress', message: '같은 요청을 처리 중입니다' } }, { status: 409 });
        }
        try {
          const out = await fn({ req, user, params });
          if (out instanceof Response) return out;
          await sql`update idempotency_keys set status_code = 200, response = ${sql.json(out as never)} where user_id = ${user.id} and key = ${idemKey}`;
          return NextResponse.json(out);
        } catch (e) {
          await sql`delete from idempotency_keys where user_id = ${user.id} and key = ${idemKey}`;
          throw e;
        }
      }

      const out = await fn({ req, user, params });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e, req);
    }
  };
}

export async function body<T extends ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw badRequest('요청 본문이 올바른 JSON 이 아닙니다');
  }
  return schema.parse(json);
}

export function clientIp(req: NextRequest) {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

export const zUuid = z.string().uuid();
/** 실제 있는 날짜만 (2026-13-99 같은 값은 DB 오류 대신 400) */
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이어야 합니다')
  .refine((s) => { const d = new Date(s + 'T00:00:00Z'); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, '없는 날짜입니다');
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, '시각은 HH:MM 형식이어야 합니다');
