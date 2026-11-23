// #1135 주요 메모 암호화(설계 docs/research/SECURE_MEMO_DESIGN_2026-11-23.md)
// - 대표 키: 서버 설정 MEMO_VAULT_KEY(무작위 32바이트 base64) — 저장소·DB 에 없음. 없으면 주요 메모만 잠김(일반 메모는 사용)
// - 회사별 키 = HKDF-SHA256(대표 키, 회사 id) → 한 회사 키가 다른 회사 암호문을 못 풂
// - AES-256-GCM, 메모마다 새 난수(IV), 메모 번호를 AAD 로 묶어 다른 메모 줄로 옮겨 붙이면 풀리지 않음
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { HttpError } from './errors';

export const VAULT_VER = 1;
export type MemoSecret = { username?: string; password?: string; note?: string };

function master(): Buffer | null {
  const raw = process.env.MEMO_VAULT_KEY?.trim();
  if (!raw) return null;
  const b = Buffer.from(raw, 'base64');
  return b.length >= 32 ? b : null; // 짧거나 모양이 틀린 키는 없는 것으로(약한 키로 암호화하지 않음)
}
export const vaultReady = () => !!master();

function tenantKey(tenant: string) {
  const m = master();
  if (!m) throw new HttpError(503, 'vault_off', '주요 메모 암호화 키가 아직 설정되지 않았습니다 — 플랫폼 관리자 설정이 필요합니다(일반 메모는 쓸 수 있습니다)');
  return Buffer.from(hkdfSync('sha256', m, Buffer.from(tenant, 'utf8'), Buffer.from('workin-memo-vault-v1', 'utf8'), 32));
}

export function sealSecret(tenant: string, memoId: string, data: MemoSecret): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', tenantKey(tenant), iv);
  c.setAAD(Buffer.from(memoId, 'utf8'));
  const enc = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function openSecret(tenant: string, memoId: string, payload: string | null): MemoSecret {
  if (!payload) return {};
  const [v, iv, tag, data] = payload.split('.');
  if (v !== 'v1') throw new HttpError(500, 'vault_version', '알 수 없는 암호문 형식입니다');
  try {
    const d = createDecipheriv('aes-256-gcm', tenantKey(tenant), Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(memoId, 'utf8'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')) as MemoSecret;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    // 키가 바뀌었거나 암호문이 손상됨 — 값은 어디에도 남기지 않는다
    throw new HttpError(500, 'vault_open_failed', '주요 메모를 풀 수 없습니다 — 암호화 키가 바뀌었을 수 있습니다. 플랫폼 관리자에게 알려 주세요');
  }
}
