import assert from 'node:assert/strict';

const owner = 'owner@example.test';
const admin = 'admin@example.test';
const peer = 'peer@example.test';
const member = 'learner+practice@example.test';
const guest = 'guest@example.test';
const added = 'new@example.test';
const timestamp = 1_760_000_000_000;
const markup = '<script>window.t20Ran = true</script><img src=x onerror="window.t20Ran = true">';

export async function run({ page, origin }) {
  const members = [
    { email: owner, role: 'owner', activeSessions: 1 },
    { email: admin, role: 'admin', activeSessions: 2, lastLoginAt: timestamp },
    { email: guest, role: 'member', inAllowlist: false, lastLoginAt: timestamp - 1000 },
    { email: peer, role: 'admin' },
    { email: member, role: 'member', nickname: markup, addedBy: admin, snapshotUpdatedAt: timestamp },
  ].map((data) => ({
    nickname: null, createdAt: timestamp, addedBy: null, lastLoginAt: null, activeSessions: 0,
    snapshotUpdatedAt: null, inAllowlist: true, ...data,
  }));
  const calls = [];
  let account;
  let denied;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = request.postDataJSON();
    calls.push({ path, method, body });
    const error = (status, code) => route.fulfill({ status, json: { error: code } });
    if (path === '/api/me') {
      return account ? route.fulfill({ json: account }) : error(401, 'UNAUTHENTICATED');
    }
    if (denied) return error(403, denied);
    if (path === '/api/admin/members') {
      if (method === 'GET') return route.fulfill({ json: { members } });
      assert.equal(method, 'POST');
      const email = body.email.trim().toLowerCase();
      assert.equal(Object.hasOwn(body, 'role'), false);
      if (!email.includes('@') || email.length > 254) return error(400, 'INVALID_EMAIL');
      if (Array.from(body.nickname.trim()).length > 40) return error(400, 'INVALID_NICKNAME');
      const existing = members.find((item) => item.email === email);
      if (existing?.inAllowlist) return error(409, 'ALREADY_EXISTS');
      const created = { email, nickname: body.nickname.trim() || null, role: 'member', inAllowlist: true };
      if (existing) Object.assign(existing, created);
      else members.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    const target = members.find((item) => path === '/api/admin/members/' + encodeURIComponent(item.email));
    assert.ok(target, '目標 email 是經編碼的單一路徑區段');
    if (method === 'DELETE') {
      members.splice(members.indexOf(target), 1);
      return route.fulfill({ status: 204 });
    }
    assert.equal(method, 'PATCH');
    Object.assign(target, body);
    return route.fulfill({ json: { email: target.email, nickname: target.nickname, role: target.role } });
  });

  const root = page.locator('#app');
  const row = (email) => root.locator('tbody').getByRole('row').filter({
    has: page.locator('td:first-child').and(page.getByRole('cell', { name: email, exact: true })),
  });
  const button = (where, name) => where.getByRole('button', { name, exact: true });
  const status = () => root.getByRole('status').innerText();
  const mount = async ({ cloudEnabled = true, injected = false, confirmRemoval = true } = {}) => {
    await page.goto(origin + '/__harness__');
    await page.evaluate(async ({ cloudEnabled, injected, confirmRemoval }) => {
      const { initAdminPage } = await import('/assets/js/ui/admin-view.js');
      const options = { mount: document.querySelector('#app'), cloudEnabled, confirmRemoval: () => confirmRemoval };
      if (injected) {
        options.account = { email: 'owner@example.test', role: 'owner' };
        options.api = { listMembers: async () => ({ members: [] }) };
      }
      await initAdminPage(options);
    }, { cloudEnabled, injected, confirmRemoval });
  };

  await mount({ cloudEnabled: false });
  assert.equal(await status(), '此頁只在新網址可用');
  assert.deepEqual(calls, []);
  await mount();
  assert.equal(await status(), '需要管理權限');
  assert.equal(await root.getByRole('table').count(), 0);
  account = { email: member, role: 'member' };
  await mount();
  assert.equal(await status(), '需要管理權限');
  assert.equal(await root.getByRole('button').count(), 0);
  assert.deepEqual(calls.map(({ path }) => path), ['/api/me', '/api/me']);
  await mount({ injected: true });
  assert.equal(await root.getByRole('table').count(), 1);
  assert.deepEqual(calls.map(({ path }) => path), ['/api/me', '/api/me']);

  account = { email: admin, role: 'admin' };
  await mount();
  const emailCells = await root.locator('tbody tr td:first-child').allTextContents();
  assert.deepEqual(emailCells, [owner, admin, guest, peer, member]);
  const details = await row(member).getByRole('cell').allTextContents();
  assert.deepEqual(details.slice(0, 8), [
    member, markup, '成員', await row(member).locator('time').first().innerText(), admin,
    '尚未登入', '未登入', await row(member).locator('time').last().innerText(),
  ]);
  assert.deepEqual(await row(member).locator('time').evaluateAll((times) => times.map((time) => time.dateTime)), [
    new Date(timestamp).toISOString(), new Date(timestamp).toISOString(),
  ]);
  assert.equal(await row(admin).getByText('登入中', { exact: true }).count(), 1);
  assert.equal(await root.locator('script, img').count(), 0);
  assert.equal(await page.evaluate(() => window.t20Ran), undefined);
  for (const email of [owner, peer, guest]) assert.equal(await button(row(email), '編輯暱稱').count(), 0);
  for (const email of [admin, member]) assert.equal(await button(row(email), '編輯暱稱').count(), 1);
  for (const name of ['移除', '升為管理員', '降為成員']) assert.equal(await button(root, name).count(), 0);
  assert.equal(await row(guest).getByText('不在名單', { exact: true }).count(), 1);
  await button(row(guest), '加入名單').click();
  await button(row(guest), '編輯暱稱').waitFor();
  assert.equal(await button(row(guest), '加入名單').count(), 0);

  const email = root.getByLabel('Email', { exact: true });
  const nickname = root.getByLabel('暱稱（選填）', { exact: true });
  await email.fill('invalid');
  await button(root, '新增').click();
  await root.getByText('請輸入有效的 Email（最多 254 字）。', { exact: true }).waitFor();
  await email.fill(member);
  await button(root, '新增').click();
  await root.getByText('已在名單中', { exact: true }).waitFor();
  assert.equal(await row(member).getByText(markup, { exact: true }).count(), 1);
  await email.fill(' NEW@Example.Test ');
  await nickname.fill('字'.repeat(41));
  await button(root, '新增').click();
  await root.getByText('暱稱最多 40 字。', { exact: true }).waitFor();
  await nickname.fill('新成員');
  await button(root, '新增').click();
  await row(added).getByText('新成員', { exact: true }).waitFor();
  assert.equal(await row(added).getByText('成員', { exact: true }).count(), 1);
  assert.equal(await email.inputValue(), '');

  await button(row(member), '編輯暱稱').click();
  const changed = '<script>t20()</script>';
  await row(member).getByLabel('暱稱', { exact: true }).fill(changed);
  await button(row(member), '儲存').click();
  await row(member).getByText(changed, { exact: true }).waitFor();
  assert.equal(await root.locator('script').count(), 0);
  assert.ok(calls.some(({ path, method, body }) => method === 'PATCH'
    && path.endsWith(encodeURIComponent(member)) && body.nickname === changed));

  account = { email: owner, role: 'owner' };
  await mount({ confirmRemoval: false });
  assert.equal(await button(row(owner), '編輯暱稱').count(), 1);
  for (const name of ['移除', '升為管理員', '降為成員']) assert.equal(await button(row(owner), name).count(), 0);
  const beforeCancel = calls.length;
  await button(row(peer), '移除').click();
  assert.equal(calls.length, beforeCancel);
  assert.equal(await row(peer).count(), 1);

  await mount();
  await button(row(member), '升為管理員').click();
  await button(row(member), '降為成員').waitFor();
  await button(row(member), '降為成員').click();
  await button(row(member), '升為管理員').waitFor();
  await button(row(peer), '移除').click();
  await row(peer).waitFor({ state: 'detached' });
  assert.ok(calls.some(({ method, path }) => method === 'DELETE' && path.endsWith(encodeURIComponent(peer))));

  denied = 'NOT_STAFF';
  await button(row(member), '升為管理員').click();
  await root.getByText('需要管理權限', { exact: true }).waitFor();
  assert.equal(await root.getByRole('table').count(), 0);
  assert.equal(await root.getByRole('button').count(), 0);
}
