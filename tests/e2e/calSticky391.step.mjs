// 391차(대표 11/13 휴대폰 사진 "이렇게 화면을 내리면 위에 날짜가 안 보인다 · 스크롤을 내려도 날짜가 보일 수 있도록"):
// 캘린더 아래 칩·안내까지 페이지를 내려도 날짜 줄(요일·날짜)이 앱 머리줄 바로 아래에 붙어 보임 — 휴대폰 주·3일 보기 · 월 보기도 · PC 도 같은 규칙
import assert from 'node:assert/strict';

export async function calSticky391({ owner, BASE }) {
  const check = async (view, what) => {
    await owner.goto(`${BASE}/calendar?view=${view}`);
    await owner.locator('.fc-col-header-cell').first().waitFor();
    await owner.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await owner.waitForTimeout(400);
    const m = await owner.evaluate(() => {
      const hdr = [...document.querySelectorAll('header.sticky')].map((h) => h.getBoundingClientRect()).filter((r) => r.height > 0).reduce((a, r) => Math.max(a, r.bottom), 0);
      const cell = document.querySelector('.fc-col-header-cell'); const r = cell.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { y: Math.round(window.scrollY), hdr: Math.round(hdr), top: Math.round(r.top), seen: !!hit?.closest('.fc-col-header') };
    });
    assert.ok(m.y > 40, `${what}: 페이지가 내려감 ${JSON.stringify(m)}`);
    assert.ok(Math.abs(m.top - m.hdr) <= 2, `${what}: 날짜 줄이 앱 머리줄 바로 아래에 붙음 ${JSON.stringify(m)}`);
    assert.ok(m.seen, `${what}: 날짜 줄이 가려지지 않고 보임 ${JSON.stringify(m)}`);
  };
  try {
    await owner.setViewportSize({ width: 390, height: 844 });
    await check('timeGridWeek', '휴대폰 주 보기');
    await check('timeGrid3', '휴대폰 3일 보기');
    await check('dayGridMonth', '휴대폰 월 보기');
    // 391차: 내렸다가 다시 올리면 날짜 줄은 제자리(달력 맨 위)
    await owner.evaluate(() => window.scrollTo(0, 0)); await owner.waitForTimeout(300);
    const back = await owner.evaluate(() => { const c = document.querySelector('.fc-col-header-cell').getBoundingClientRect(); const v = document.querySelector('.fc-view-harness').getBoundingClientRect(); return { c: Math.round(c.top), v: Math.round(v.top) }; });
    assert.ok(back.c - back.v <= 2, `맨 위로 올리면 제자리 ${JSON.stringify(back)}`);
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
  }
}
