// E2E: 브랜드 실사 몇 장(사람·글자 없음, AI 설명 있음)을 자료실에 바로 넣음 — 295차(단색 표지 금지)·303차(사진 없는 장 대신 자료 요청) 뒤로
// 사진이 하나도 없는 브랜드의 [지금 만들기]·자동 시안은 승인함 대신 수정 요청으로 가므로, 승인 흐름을 보는 단계는 이 사진을 먼저 넣는다.
// 브랜드 이름은 설명·AI 설명에만 넣음 — 이름에 '시안' 같은 낱말이 있으면 파일 이름·태그만으로 글자 든 그래픽으로 판정돼 바탕에서 빠짐
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const V = (caption) => ({ v: 1, fv: 2, at: new Date().toISOString(), caption, scene: `${caption} 모습입니다.`, tags: ['시설'], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good' });

// 320차(대표 11/01 '문구와 관련 없는 사진' — 글과 낱말이 안 맞는 장은 브랜드 사진 아무거나로 채우지 않음) 뒤로는 사진 설명에 그 글의 낱말이 있어야 카드 장에 깔림
//  → caption(k) 으로 글에 맞는 한 줄 설명을 넘김(없으면 '{브랜드} 시설 n')
export async function seedBrandPhotos(sql, { tenant, ownerId, brandName, n = 5, caption = null }) {
  const ids = [];
  for (let k = 0; k < n; k++) {
    const name = `시설 사진 ${k + 1}.jpg`;
    const data = await sharp({ create: { width: 900, height: 1125, channels: 3, background: { r: 40 + k * 35, g: 90 + k * 20, b: 120 + k * 15 } } }).jpeg().toBuffer();
    const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, vision)
      values (${tenant}, 'marketing', '마케팅/사진', ${name}, ${name}, 'image/jpeg', ${data.length}, ${ownerId}, 'ready', 'upload', ${['시설']}, ${sql.json(V(caption ? caption(k + 1) : `${brandName} 시설 ${k + 1}`))}) returning id`;
    await sql`update library_files set description = ${`${brandName} 시설 사진`} where id = ${f.id}`;
    const key = `lib/${tenant}/${f.id}/facility-${k + 1}.jpg`;
    await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
    await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
    await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
    ids.push(f.id);
  }
  return ids;
}
