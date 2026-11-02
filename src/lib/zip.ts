import * as zlib from 'node:zlib';

/** 332차(대표 11/02 16:1x ④ [선택 n개 내려받기(zip)]): 압축 없이 담기만 하는 zip(사진·PDF·HWP 는 이미 압축됨) — 이름 UTF-8, 4GB·65,535개 미만(ZIP64 없음) */
const TABLE = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; } return t; })();
function crcOf(b: Buffer): number {
  const f = (zlib as unknown as { crc32?: (b: Buffer) => number }).crc32;
  if (typeof f === 'function') return f(b) >>> 0;
  let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d: Date) {
  const k = new Date(d.getTime() + 9 * 3600e3); const y = Math.max(1980, k.getUTCFullYear());
  return { time: (k.getUTCHours() << 11) | (k.getUTCMinutes() << 5) | (k.getUTCSeconds() >> 1), date: ((y - 1980) << 9) | ((k.getUTCMonth() + 1) << 5) | k.getUTCDate() };
}
export type ZipFile = { name: string; data: Buffer; mtime?: Date };
export function buildZip(files: ZipFile[]): Buffer {
  const parts: Buffer[] = []; const central: Buffer[] = []; let offset = 0; const used = new Map<string, number>();
  for (const f of files) {
    let name = f.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 180) || '파일';
    const n = (used.get(name) ?? 0) + 1; used.set(name, n);
    if (n > 1) { const m = /^(.*?)(\.[^.]+)?$/.exec(name)!; name = `${m[1]} (${n})${m[2] ?? ''}`; } // 같은 이름은 (2)·(3)
    const nameB = Buffer.from(name, 'utf8'); const crc = crcOf(f.data); const { time, date } = dosTime(f.mtime ?? new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(nameB.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(0, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(f.data.length, 20); cen.writeUInt32LE(f.data.length, 24); cen.writeUInt16LE(nameB.length, 28); cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34); cen.writeUInt16LE(0, 36); cen.writeUInt32LE(0, 38); cen.writeUInt32LE(offset, 42);
    parts.push(local, nameB, f.data); central.push(cen, nameB); offset += local.length + nameB.length + f.data.length;
  }
  const cenSize = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...central, end]);
}
