// V21 메일 계정·명함 설정 화면 + 업무 [메일로 보내기] 시안(보내는 주소·받는 사람·첨부·명함 미리보기). 실제 발송은 API 시험(모의 SMTP)에서
import assert from 'node:assert/strict';
export async function v21({ owner, BASE, SHOTS, sql }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  const call = (path, method, body) => owner.evaluate(async ([p, m, b]) => {
    const r = await fetch(p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return r.json();
  }, [path, method, body]);
  await call('/api/org/company-profiles', 'PUT', { key: 'hilink', name: 'HI-LINK 시험', phone: '1555-0000', address: '시험시 시험로 36, 8층', website: 'www.hilink.test' });
  await owner.goto(`${BASE}/admin/mail`);
  await owner.getByTestId('mail-account-form').waitFor();
  await owner.getByRole('radio', { name: '네이버 메일' }).waitFor();
  await owner.getByTestId('mail-signature').getByRole('button', { name: 'HI-LINK 시험' }).click();
  await owner.getByTestId('sig-intro').fill('시험 소개 한 줄');
  await owner.getByTestId('sig-save').click();
  await owner.frameLocator('[data-testid="sig-preview"]').getByText('시험 소개 한 줄').waitFor();
  await owner.screenshot({ path: `${SHOTS}/v21-mail-settings.png`, fullPage: true });
  // 연결된 계정(시험용 행) → 업무에서 시안
  await sql`insert into mail_accounts (tenant, provider, host, port, secure, username, from_email, from_name, password_enc) values ('default', 'naver', 'smtp.naver.com', 465, true, 'office', 'office@mail.test', '시험회사', 'v1.x.y.z')
    on conflict (tenant) do nothing`;
  const t = await call('/api/tasks', 'POST', { title: '메일 시안 시험', approvalRequired: false });
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('mail-compose-open').click();
  const c = owner.getByTestId('mail-compose');
  await c.waitFor();
  assert.match(await c.getByTestId('mail-from-line').innerText(), /office@mail\.test/);
  await c.getByTestId('mail-company-hilink').click();
  await c.getByTestId('mail-to').fill('customer@client.test');
  await c.getByTestId('mail-body').fill('안녕하세요.\n\n제안서를 보내 드립니다.');
  const pv = owner.frameLocator('[data-testid="mail-preview"]');
  await pv.getByText('제안서를 보내 드립니다.').waitFor();
  await pv.getByText('HI-LINK 시험').waitFor();
  await pv.getByText('시험시 시험로 36, 8층').waitFor();
  assert.equal(await pv.getByText(/APART/i).count(), 0);
  assert.ok(await c.getByTestId('mail-send').isEnabled());
  await owner.screenshot({ path: `${SHOTS}/v21-mail-compose.png` });
  await owner.keyboard.press('Escape');
  await sql`delete from mail_accounts where tenant = 'default'`;
}
