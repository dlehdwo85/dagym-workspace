// #1125 2단계(대표 위임 11/23 — ② 브라우저 안 변환): 엑셀 표 읽기(값·병합·열 너비·굵게·채움·테두리·천 단위·날짜). 서버·DB 없이 Node 로 바로 확인.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { readXlsx, cellRef, showNumber } = await import('../../src/lib/xlsxSheet.ts');
const buf = (p) => { const b = readFileSync(new URL(p, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

test('가짜 근로계약서 엑셀: 제목 병합(A1:D1)·굵게 16pt · 표 머리 채움·테두리 · 임금 천 단위 · 서명 줄', async () => {
  const [s] = await readXlsx(buf('../fixtures/contract-sample.xlsx'));
  assert.equal(s.name, '근로계약서'); assert.deepEqual([s.rows, s.cols], [8, 4]);
  const t = s.cells[0][0];
  assert.deepEqual([t.v, t.cs, t.rs, t.s.b, t.s.sz, t.s.ha], ['표준 근로계약서(엑셀 양식)', 4, 1, true, 16, 'center']);
  assert.equal(s.cells[0][1].covered, true, '병합 안쪽 칸');
  const h = s.cells[2][0]; assert.deepEqual([h.v, h.s.b, h.s.fill, h.s.bt], ['항목', true, '#DDEBF7', '1px solid #000']);
  assert.equal(s.cells[5][1].v, '2,500,000', '#,##0 서식');
  assert.equal(s.cells[7][0].v, '(사업주) 시험상호 주식회사   (서명)');
  assert.deepEqual(s.colW.map((w) => Math.round(w)), [16, 30, 14, 24]);
  assert.equal(s.landscape, false); assert.ok(s.margins.l > 0);
});

test('칸 주소·숫자 표시', () => {
  assert.deepEqual(cellRef('B12'), [11, 1]); assert.deepEqual(cellRef('$AA$3'), [2, 26]);
  assert.equal(showNumber('46357', { fmtId: 14 }), '2026-12-01');
  assert.equal(showNumber('1234.5', { fmtId: 4 }), '1,234.5');
  assert.equal(showNumber('0.25', { fmtId: 9 }), '25%');
  assert.equal(showNumber('12', null), '12');
});

test('엑셀이 아닌 파일은 알아듣는 오류', async () => {
  await assert.rejects(readXlsx(new TextEncoder().encode('PK').buffer), /엑셀\(\.xlsx\) 파일이 아닙니다/);
});
