// #1139(대표 11/24 '영업·마케팅 페이지가 잠겨 보이게, 잠금 표시는 사이드바에서'): 회사가 켜지 않은 공간 = 사이드바 자물쇠 + '상담 후 사용'
// → 누르면 안내(금액 없음) + [상담 신청](연락처 미리 채움) → '상담 신청됨' · 휴대폰(390) 프로필 시트에도 같은 줄 · 가로 넘침 없음
import assert from 'node:assert/strict';

export async function spaceLock({ owner, staff, ctx, sql, BASE, SHOTS }) {
  const [t0] = await sql`select spaces from tenants where id = 'default'`;
  try {
    await sql`update tenants set spaces = array_remove(spaces, 'marketing') where id = 'default'`;
    await sql`delete from space_consults where tenant = 'default'`;
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(BASE + '/');
    const row = owner.getByTestId('space-locked-marketing');
    await row.waitFor();
    assert.match(await row.innerText(), /마케팅[\s\S]*상담 후 사용/);
    await owner.screenshot({ path: `${SHOTS}/1139-sidebar-lock.png` });
    await row.click();
    const page = owner.getByTestId('space-locked-page'); await page.waitFor();
    assert.ok(!/\d[\d,]*\s*원/.test(await page.innerText()), '금액은 쓰지 않음');
    const form = owner.getByTestId('space-consult-form'); await form.waitFor();
    assert.equal(await form.getByTestId('space-consult-pick-marketing').isChecked(), true, '누른 공간이 골라져 있음');
    assert.ok((await form.getByTestId('space-consult-email').inputValue()).includes('@'), '연락처 미리 채움');
    await form.getByTestId('space-consult-phone').fill('010-0000-1139');
    await form.getByTestId('space-consult-send').click();
    await owner.getByTestId('space-consult-pending-marketing').waitFor();
    assert.equal((await sql`select count(*)::int n from space_consults where tenant = 'default' and status = 'requested'`)[0].n, 1);
    await owner.screenshot({ path: `${SHOTS}/1139-consult-sent.png` });
    // 직원(휴대폰 390): 프로필 시트에 잠긴 공간 줄 · 안내 화면은 '관리자가 신청' · 가로 넘침 없음
    await staff.goto(BASE + '/spaces/locked?space=marketing');
    await staff.getByTestId('space-consult-staff').waitFor();
    assert.ok(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '390 가로 넘침 없음');
  } finally {
    await sql`update tenants set spaces = ${t0.spaces} where id = 'default'`;
    await sql`delete from space_consults where tenant = 'default'`;
  }
}
