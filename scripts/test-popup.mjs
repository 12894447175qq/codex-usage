// Optional browser regression check; uses the existing Playwright installation.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../extension/', import.meta.url));
const server = createServer(async (request, response) => {
  const path = request.url.split('?')[0];
  if (!/^\/(dashboard\.(html|css|js)|(?:data|token-scale)\.mjs|icons\/icon\.svg)$/.test(path)) {
    response.writeHead(404); response.end(); return;
  }
  try {
    response.setHeader('content-type', path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript');
    response.end(await readFile(root + path));
  } catch { response.writeHead(500); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.CODEX_USAGE_TEST_BROWSER || 'msedge' });
  const context = await browser.newContext({ viewport: { width: 560, height: 600 } });
  await context.addInitScript(() => {
    window.fixtureTokenDays = JSON.parse(localStorage.getItem('fixtureTokenDays') || 'null');
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const yesterday = new Date(`${date}T00:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const oldDate = yesterday.toISOString().slice(0, 10);
    const todayNoon = Date.parse(`${date}T12:00:00+08:00`);
    const row = { model: 'gpt-5.3-codex', inputTokens: 60, cacheReadTokens: 30, cacheCreationTokens: 10, outputTokens: 5, totalTokens: 105, costUSD: null, knownCostUSD: .25, costKnown: false, calls: 2, unknownCostCalls: 1 };
    const resetsAt = new Date(Date.now() + 2 * 86400000).toISOString();
    const weekly = (capturedAt, remainingPercent, reset = resetsAt) => ({ date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(capturedAt)), capturedAt, remainingPercent, resetsAt: reset, limitId: 'codex', window: 'weekly' });
    const report = { schemaVersion: 5, days: [{ date: oldDate, models: [row] }, { date, models: [row, { ...row, model: 'other', costUSD: .5, knownCostUSD: .5, costKnown: true }] }], syncedAt: new Date().toISOString(), version: 'fixture', pricingSource: 'fixture', warnings: [], quota: {
      weekly: [weekly(new Date(todayNoon - 9 * 86400000).toISOString(), 33, new Date(todayNoon - 2 * 86400000).toISOString()), weekly(new Date(todayNoon - 86400000).toISOString(), 98), weekly(new Date(todayNoon - 30 * 60000).toISOString(), 95), weekly(new Date(todayNoon - 5 * 60000).toISOString(), 93), weekly(new Date(todayNoon).toISOString(), 90)],
      fiveHour: [{ ...weekly(new Date().toISOString(), 5), window: 'five-hour' }],
      current: [weekly(new Date().toISOString(), 90), { ...weekly(new Date().toISOString(), 5), window: 'five-hour' }],
    } };

    window.chrome = {
      storage: { local: {
        get: async () => ({ preferences: JSON.parse(localStorage.getItem('preferences') || '{"quota-bucket":"five-hour:codex","metric":"costUSD","range":"custom","layout":"stacked","from":"2026-10-20","to":"2026-10-01"}') }),
        set: async ({ preferences }) => localStorage.setItem('preferences', JSON.stringify(preferences)),
      } },
      runtime: { sendMessage: async request => {
        if (request.type === 'sync') { window.fixtureSyncCount = (window.fixtureSyncCount || 0) + 1; window.fixtureLastForce = request.force; }
        if (window.fixturePauseSync && request.type === 'sync') return new Promise(resolve => { window.fixtureFinishSync = () => { window.fixturePauseSync = false; resolve({ ok: true, report }); }; });
        if (window.fixtureQuotaSnapshots) return { ok: true, report: { ...report, quota: { ...report.quota, weekly: window.fixtureQuotaSnapshots } } };
        if (window.fixtureTokenDays) return { ok: true, report: { ...report, days: window.fixtureTokenDays } };
        if (window.fixtureEmptyQuota) return { ok: true, report: { ...report, quota: { ...report.quota, weekly: [], current: [] } } };
        if (window.fixtureEmptyUsage) return { ok: true, report: { ...report, days: [], quota: { weekly: [], fiveHour: [], current: [] } } };
        if (request.type === 'floating') { window.fixtureFloatingOpened = true; return { ok: true, windowId: 7 }; }
        if (window.fixtureQuotaError) return { ok: true, report: { ...report, quota: { ...report.quota, current: [], error: 'fixture quota unavailable' } } };
        if (request.type === 'dashboard') return { ok: true, url: 'http://127.0.0.1:4317' };
        if (request.type === 'sync' && window.fixtureFailSync) return { ok: false, report: { ...report, stale: true }, error: 'fixture offline' };
        return { ok: true, report };
      } },
    };
  });
  const page = await context.newPage();
  const chooseRange = value => page.locator(`[data-range="${value}"]`).click();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}/dashboard.html`;
  await page.goto(url);
  await page.getByRole('status').filter({ hasText: '已同步' }).waitFor();
  assert.deepEqual(await page.getByRole('tab').allTextContents(), ['Token', '额度']);
  assert.equal(await page.locator('#tokens').textContent(), '210');
  assert.equal(await page.locator('#cost, #cost-note, #cost-panel, #tab-cost').count(), 0);
  assert.equal(await page.locator('#usage-summary-line, #usage-summary, #export-csv').count(), 0);
  assert.ok(!/CSV|次调用|缓存读取占输入/.test(await page.locator('main').textContent()));
  assert.equal(await page.locator('#layout').inputValue(), 'grouped');
  assert.ok(!/费用|USD/.test(await page.locator('main').textContent()));
  assert.equal(await page.locator('[data-range="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-range]').count(), 3);
  assert.equal(await page.locator('#custom-dates').count(), 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('preferences')).range), '1');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('preferences')).metric), 'totalTokens');
  await page.locator('#legend button').filter({ hasText: 'gpt-5.3-codex' }).click();
  assert.equal(await page.locator('#model').inputValue(), 'gpt-5.3-codex');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.model), 'gpt-5.3-codex');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#model').inputValue(), 'all');
  await chooseRange('7');
  await page.locator('#model').selectOption('gpt-5.3-codex');
  await page.locator('#layout').selectOption('grouped');
  await page.getByRole('tab', { name: 'Token', exact: true }).click();
  assert.ok(await page.locator('#token-chart rect').count() > 0);
  await page.reload();
  await page.getByRole('status').filter({ hasText: '已同步' }).waitFor();
  assert.equal(await page.locator('#range').inputValue(), '7');
  assert.equal(await page.locator('#model').inputValue(), 'gpt-5.3-codex');
  assert.equal(await page.locator('#layout').inputValue(), 'grouped');
  assert.equal(await page.locator('#tab-tokens').getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: '打开独立浮窗', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureFloatingOpened), true);
  await page.getByRole('tab', { name: '额度', exact: true }).click();
  assert.equal(await page.locator('#quota-current').count(), 0);
  assert.equal(await page.locator('#quota-cycle').count(), 0);
  assert.ok(!(await page.locator('body').textContent()).includes('5 小时'));
  assert.equal(await page.locator('#quota-bucket').inputValue(), 'weekly:codex');
  assert.equal(await page.locator('#usage-filters').isVisible(), true);
  assert.equal(await page.locator('#usage-cards').isVisible(), true);
  assert.equal(await page.locator('#model').isDisabled(), true);
  assert.equal(await page.locator('#token-tools').isHidden(), true);
  assert.match(await page.locator('#model-label').textContent(), /账户/);
  assert.equal(await page.locator('#quota-chart circle').count(), 4, 'multi-day ranges preserve every observation, including same-day changes');
  assert.match(await page.locator('#quota-chart path').getAttribute('d'), /L/);
  assert.match(await page.locator('#quota-period').textContent(), /4 条观测/);
  assert.equal(await page.locator('#quota-latest').textContent(), '90%');
  await chooseRange('1');
  assert.equal(await page.locator('#quota-chart circle').count(), 3, 'a single day preserves its observations');
  assert.match(await page.locator('#quota-period').textContent(), /3 条观测/);
  await page.reload();
  await page.getByRole('status').filter({ hasText: '已同步' }).waitFor();
  assert.equal(await page.locator('#quota-bucket').inputValue(), 'weekly:codex');
  assert.equal(await page.locator('#range').inputValue(), '1');
  assert.equal(await page.locator('#quota-chart circle').count(), 3);
  const ticks = await page.locator('#quota-chart .axis-time').evaluateAll(nodes => nodes.map(n => { const b = n.getBoundingClientRect(); return { left: b.left, right: b.right }; }));
  assert.ok(ticks.every((tick, i) => i === 0 || tick.left >= ticks[i - 1].right), 'quota time labels must not overlap');
  await page.locator('#quota-chart svg').hover({ position: { x: 150, y: 60 } });
  assert.equal(await page.locator('#tooltip').isVisible(), true);
  await page.mouse.move(0, 0);
  await page.locator('#quota-chart circle').first().focus();
  assert.equal(await page.locator('#tooltip').isVisible(), true);
  await page.locator('#tab-quota').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#tab-tokens').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#model').isDisabled(), false);
  await page.keyboard.press('ArrowRight');
  const footer = await page.locator('footer').boundingBox();
  assert.ok(footer.y + footer.height <= 600, 'compact popup must show chart and sync status together');
  await page.screenshot({ path: '/tmp/codex-usage-ui-0.8.0-quota-test.png' });
  await chooseRange('30');
  assert.equal(await page.locator('#quota-chart circle').count(), 5);
  const path = await page.locator('#quota-chart path').getAttribute('d');
  assert.equal((path.match(/M /g) ?? []).length, 2, 'reset periods and missing days must not be connected');
  assert.equal((path.match(/L /g) ?? []).length, 3);
  await page.getByRole('tab', { name: 'Token', exact: true }).click();
  await chooseRange('7');
  assert.match(await page.getByRole('status').textContent(), /已同步/);
  await page.evaluate(() => { window.fixtureFailSync = true; });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '同步失败' }).waitFor();
  assert.match(await page.locator('#meta').textContent(), /缓存/);
  assert.equal(await page.locator('#tokens').textContent(), '210');
  await page.getByRole('tab', { name: 'Token', exact: true }).click();
  await page.screenshot({ path: '/tmp/codex-usage-popup-0.6.0.png' });
  await page.evaluate(() => { window.fixtureFailSync = false; window.fixtureQuotaError = true; });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.locator('#refresh:enabled').waitFor();
  await page.getByRole('tab', { name: '额度', exact: true }).click();
  assert.match(await page.locator('#quota-state').textContent(), /读取失败/);
  assert.equal(await page.locator('#quota-observation').getAttribute('open'), '');
  assert.equal(await page.locator('#quota-chart circle').count(), 4);
  assert.match(await page.locator('#quota-chart path').getAttribute('d'), /L/);
  assert.match(await page.locator('#quota-state').textContent(), /保留此前快照/);
  await page.evaluate(() => { window.fixtureQuotaError = false; });
  await page.setViewportSize({ width: 1000, height: 850 });
  await page.goto(url + '?window=1');
  await page.getByRole('status').filter({ hasText: '已同步' }).waitFor();
  assert.equal(await page.locator('#open-floating').isHidden(), true);
  assert.equal(await page.locator('#window-help').isVisible(), true);
  assert.equal(await page.locator('body').evaluate(element => element.clientWidth), 1000);
  await page.screenshot({ path: '/tmp/codex-usage-floating-0.7.0.png' });
  await page.setViewportSize({ width: 400, height: 600 });
  assert.ok(await page.locator('body').evaluate(element => element.scrollWidth <= element.clientWidth));
  await page.getByRole('tab', { name: 'Token', exact: true }).click();
  await page.evaluate(() => { window.fixturePauseSync = true; });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  assert.equal(await page.locator('main').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('#refresh').isDisabled(), true);
  assert.equal(await page.locator('#refresh-label').textContent(), '同步中');
  await page.evaluate(() => window.fixtureFinishSync());
  await page.locator('#refresh:enabled').waitFor();
  assert.equal(await page.locator('main').getAttribute('aria-busy'), 'false');
  await chooseRange('1');
  await page.evaluate(() => { window.fixtureEmptyQuota = true; });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.locator('#refresh:enabled').waitFor();
  await page.evaluate(() => { window.fixtureEmptyQuota = false; window.fixturePauseSync = true; });
  const beforeQuotaClick = await page.evaluate(() => window.fixtureSyncCount);
  await page.getByRole('tab', { name: '额度', exact: true }).click();
  assert.equal(await page.locator('#quota-chart circle').count(), 0);
  assert.match(await page.getByRole('status').textContent(), /更新周额度/);
  assert.equal(await page.evaluate(() => window.fixtureLastForce), false);
  await page.getByRole('tab', { name: '额度', exact: true }).click();
  await page.getByRole('tab', { name: '额度', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureSyncCount), beforeQuotaClick + 1, 'quota clicks must share an in-flight update');
  await page.evaluate(() => window.fixtureFinishSync());
  await page.locator('#refresh:enabled').waitFor();
  assert.equal(await page.locator('#quota-chart circle').count(), 3, 'quota click fills an empty graph without a manual refresh');
  await page.getByRole('tab', { name: 'Token', exact: true }).click();
  await page.evaluate(() => { window.fixtureFailSync = true; });
  await page.getByRole('tab', { name: '额度', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '同步失败' }).waitFor();
  assert.equal(await page.locator('#quota-chart circle').count(), 3, 'failed automatic quota update must preserve history');
  await page.evaluate(() => { window.fixtureFailSync = false; });
  await page.getByRole('tab', { name: 'Token', exact: true }).click();
  await page.evaluate(() => { window.fixtureEmptyUsage = true; });
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.locator('#refresh:enabled').waitFor();
  assert.equal(await page.locator('#token-chart .empty').count(), 1);
  await page.getByRole('button', { name: '查看最近 7 天', exact: true }).click();
  assert.equal(await page.locator('[data-range="7"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#range').inputValue(), '7');
  await page.evaluate(() => { window.fixtureEmptyUsage = false; });
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await page.locator('#refresh:enabled').waitFor();
  assert.ok(await page.locator('#token-chart rect').count() > 0);
  // Reference-style grouped bars with two empty intervals across three magnitudes.
  await page.setViewportSize({ width: 560, height: 600 });
  await page.evaluate(() => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(`${date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() - (6 - i));
      return { date: day.toISOString().slice(0, 10), models: [1500 + i * 120, 1200 + i * 90, 103200 + i * 120, 3106212 + i * 800].map((totalTokens, j) => ({ model: ['gpt-5.6-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-sol'][j], totalTokens, inputTokens: totalTokens, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0 })) };
    });
    window.fixtureTokenDays = days;
    localStorage.setItem('fixtureTokenDays', JSON.stringify(days));
  });
  await page.goto(url);
  await page.getByRole('status').filter({ hasText: '已同步' }).waitFor();
  await page.locator('#model').selectOption('all');
  await page.locator('#layout').selectOption('grouped');
  await chooseRange('7');
  assert.equal(await page.locator('.token-bar').count(), 28);
  assert.equal(await page.locator('.axis-break').count(), 2);
  assert.equal(await page.locator('#axis-note').isVisible(), true);
  const small = page.locator('.token-bar[data-model="gpt-5.6-sol"]').first();
  assert.ok(Number(await small.locator('rect').getAttribute('height')) > 10, 'small model remains visible across million-token differences');
  await small.focus();
  assert.match(await page.locator('#tooltip').textContent(), /Token 1,500/);
  const beforeValues = await page.locator('.token-bar').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-value')));
  await page.locator('#tab-tokens').focus();
  await page.screenshot({ path: '/tmp/codex-usage-0.10.0-token-breaks.png' });
  const tokenFooter = await page.locator('footer').boundingBox();
  assert.ok(tokenFooter.y + tokenFooter.height <= 600, 'Token chart and sync status fit in the compact popup');
  await page.locator('.axis-break').first().click();
  assert.equal(await page.locator('.axis-break').count(), 0);
  assert.equal(await page.locator('#axis-toggle').textContent(), '恢复断轴');
  assert.deepEqual(await page.locator('.token-bar').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-value'))), beforeValues);
  await page.locator('#axis-toggle').click();
  assert.equal(await page.locator('.axis-break').count(), 2);
  await page.locator('.axis-break').first().focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.axis-break').count(), 0);
  await page.locator('#axis-toggle').click();
  await page.locator('#layout').selectOption('stacked');
  assert.ok(await page.locator('.axis-break').count() > 0);
  assert.deepEqual(await page.locator('.token-bar').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-value'))), beforeValues);
  const columns = await page.locator('.token-bar').evaluateAll(nodes => {
    const groups = new Map();
    for (const node of nodes) { const key = node.getAttribute('data-date'); if (!groups.has(key)) groups.set(key, []); const rect = node.querySelector('rect'); groups.get(key).push({ y: +rect.getAttribute('y'), height: +rect.getAttribute('height') }); }
    return [...groups.values()];
  });
  for (const column of columns) for (let i = 1; i < column.length; i++) assert.ok(Math.abs(column[i].y + column[i].height - column[i - 1].y) < 1e-7, 'stacked bars meet at cumulative scale boundaries');
  await page.reload();
  await page.getByRole('status').filter({ hasText: '已同步' }).waitFor();
  assert.equal(await page.locator('#layout').inputValue(), 'stacked', 'explicit layout choice survives subsequent opens');
  await page.locator('#layout').selectOption('grouped');
  await chooseRange('1');
  assert.equal(await page.locator('.token-bar').count(), 4);
  await chooseRange('30');
  assert.equal(await page.locator('#range').inputValue(), '30');
  await page.setViewportSize({ width: 400, height: 600 });
  await page.goto(url + '?window=1');
  await page.getByRole('status').filter({ hasText: '已同步' }).waitFor();
  await chooseRange('7');
  assert.ok(await page.locator('body').evaluate(element => element.scrollWidth <= element.clientWidth));
  assert.equal(await page.locator('.axis-break').count(), 2);
  await page.getByRole('tab', { name: '额度', exact: true }).click();
  assert.equal(await page.locator('#token-tools').isHidden(), true);
  assert.equal(await page.locator('#quota-chart circle').count(), 4);
  // A reset and subsequent consumption on the same day must survive 7/30-day views.
  await page.evaluate(() => {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const yesterday = new Date(`${date}T00:00:00Z`); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const oldDate = yesterday.toISOString().slice(0, 10);
    const oldReset = new Date(Date.parse(`${oldDate}T14:00:00+08:00`) + 3 * 86400000).toISOString();
    const reset = new Date(Date.parse(`${oldDate}T14:00:00+08:00`) + 7 * 86400000).toISOString();
    const observation = (stamp, remainingPercent, resetsAt = reset) => ({ capturedAt: new Date(stamp).toISOString(), remainingPercent, resetsAt, window: 'weekly', limitId: 'codex' });
    window.fixtureQuotaSnapshots = [observation(`${oldDate}T12:40:00+08:00`, 10, oldReset), observation(`${oldDate}T13:59:00+08:00`, 9, oldReset), observation(`${oldDate}T14:00:10+08:00`, 100), observation(`${oldDate}T14:05:00+08:00`, 99), observation(`${oldDate}T21:00:00+08:00`, 90), observation(`${date}T08:30:00+08:00`, 85)];
  });
  await page.getByRole('tab', { name: '额度', exact: true }).click();
  await page.locator('#refresh:enabled').waitFor();
  await chooseRange('7');
  assert.equal(await page.locator('#quota-chart circle').count(), 6);
  const resetPoint = page.locator('#quota-chart circle[data-remaining="100"]');
  const afterPoint = page.locator('#quota-chart circle[data-remaining="99"]');
  const eveningPoint = page.locator('#quota-chart circle[data-remaining="90"]');
  assert.equal(await resetPoint.count(), 1);
  assert.equal(await eveningPoint.count(), 1);
  const resetX = Number(await resetPoint.getAttribute('cx')), afterX = Number(await afterPoint.getAttribute('cx')), eveningX = Number(await eveningPoint.getAttribute('cx'));
  assert.ok(resetX < afterX && afterX < eveningX, 'intraday observations need distinct chronological positions');
  const firstInterval = Date.parse(await afterPoint.getAttribute('data-captured-at')) - Date.parse(await resetPoint.getAttribute('data-captured-at'));
  const secondInterval = Date.parse(await eveningPoint.getAttribute('data-captured-at')) - Date.parse(await afterPoint.getAttribute('data-captured-at'));
  assert.ok(Math.abs((afterX - resetX) / (eveningX - afterX) - firstInterval / secondInterval) < 1e-8);
  assert.equal(await page.locator('#quota-chart .quota-cycle-start').count(), 1);
  const resetPath = await page.locator('#quota-chart path').getAttribute('d');
  assert.equal((resetPath.match(/M /g) ?? []).length, 2);
  assert.equal((resetPath.match(/L /g) ?? []).length, 4);
  await eveningPoint.focus();
  assert.match(await page.locator('#tooltip').textContent(), /剩余 90%/);
  await page.locator('#tab-quota').focus();
  await page.screenshot({ path: '/tmp/codex-usage-0.10.1-weekly-reset-regression.png' });
  await chooseRange('30');
  assert.equal(await page.locator('#quota-chart circle').count(), 6);
  await chooseRange('1');
  assert.equal(await page.locator('#quota-chart circle').count(), 1);
  assert.equal(await page.locator('#quota-latest').textContent(), '85%');
  assert.deepEqual(errors, []);
  console.log('PASS: 7/30-day quota preserves same-day reset 100% and evening 90%, timestamp-proportional positions, reset/gap breaks, today filter and tooltips; removed usage summary/CSV, broken-axis Token bars, keyboard, stacked geometry, compact footer, 400px window, preference migration, quota auto-update/deduplication/failure history; no browser errors.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
