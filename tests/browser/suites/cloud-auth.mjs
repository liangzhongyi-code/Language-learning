import assert from 'node:assert/strict';

export async function enableCloud(context, origin) {
  await context.route('**/assets/js/config/cloud.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'export const CLOUD_CONFIG = ' + JSON.stringify({ siteOrigin: origin, legacyOrigins: [], newSiteUrl: '' }),
  }));
}

export async function run({ page, context, origin }) {
  const requests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) requests.push(url.pathname);
  });
  await enableCloud(context, origin);
  let loggedIn = false;
  let temporaryFailure = false;
  await context.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') {
      if (temporaryFailure) return route.fulfill({ status: 503, json: { error: 'SERVER' } });
      return loggedIn ? route.fulfill({ json: { accountId: 'acct-1', email: 'learner@example.test', role: 'member' } })
        : route.fulfill({ status: 401, json: { error: 'UNAUTHENTICATED' } });
    }
    if (path === '/api/snapshot/meta') return route.fulfill({ json: { revision: 0 } });
    if (path === '/api/auth/logout') { loggedIn = false; return route.fulfill({ status: 204 }); }
    return route.fulfill({ status: 404 });
  });
  await page.goto(origin + '/#cloud-error=NOT_ALLOWED');
  await page.locator('[data-cloud-login]').waitFor();
  assert.deepEqual(requests, ['/api/me']);
  assert.equal(new URL(page.url()).hash, '');
  assert.match(await page.locator('[data-cloud-account]').innerText(), /尚未開放/);
  assert.equal(await page.locator('[data-cloud-login]').getAttribute('href'), '/api/auth/start?returnTo=%2F');
  loggedIn = true;
  await page.reload();
  await page.locator('.cloud-menu summary').click();
  await page.getByText('learner@example.test', { exact: true }).waitFor();
  await page.getByText('已同步', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: '成員管理' }).count(), 0);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('[data-cloud-action=logout]').click();
  assert.equal(requests.includes('/api/auth/logout'), false);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-cloud-action=logout]').click();
  await page.locator('[data-cloud-login]').waitFor();
  assert.ok(requests.includes('/api/auth/logout'));
  loggedIn = true;
  temporaryFailure = true;
  await page.reload();
  await page.getByRole('button', { name: '再試一次' }).waitFor();
  temporaryFailure = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('.cloud-menu summary').click();
  await page.getByText('learner@example.test', { exact: true }).waitFor();
}
