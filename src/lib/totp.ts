import { createHmac, randomBytes } from 'node:crypto';

/** V12 3번 2단계 인증: RFC 6238 TOTP (30초·6자리·SHA1) — Google Authenticator·Microsoft Authenticator 등 OTP 앱 호환 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newSecret() {
  const b = randomBytes(20);
  let bits = '', out = '';
  for (const x of b) bits += x.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function decode(s: string) {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(c); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function totp(secret: string, at = Date.now(), step = 30) {
  const counter = Math.floor(at / 1000 / step);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}
/** 앞뒤 30초까지 허용 (휴대폰 시계 차이) */
export function verifyTotp(secret: string, code: string, at = Date.now()) {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => totp(secret, at + w * 30_000) === c);
}
export const otpauthUrl = (secret: string, email: string) => `otpauth://totp/${encodeURIComponent(`워크인:${email}`)}?secret=${secret}&issuer=${encodeURIComponent('워크인')}&digits=6&period=30`;
