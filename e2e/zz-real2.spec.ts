import { test, expect } from '@playwright/test';
const OUT = '/tmp/claude-1000/-home-gennscar-git-robo-boy/b66ac352-1c68-425b-99c3-40f607e64c90/scratchpad';
test('real stack: pad/bt request', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type().toUpperCase() + ' ' + m.text().slice(0, 400)); });
  page.on('websocket', ws => { ws.on('close', () => errors.push('WS CLOSED ' + ws.url())); });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.route('**/chat/completions', route => route.fulfill({ status: 200, contentType: 'text/event-stream',
    body: `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ kind: 'explanation', message: 'ok from mock' }) } }] })}\n\ndata: [DONE]\n\n` }));
  await page.goto('/');
  await page.getByTitle('Advanced Options').click();
  await page.locator('#ros2Value').fill('127.0.0.1');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByLabel('Status: Connected')).toBeVisible({ timeout: 20000 });
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: '3D panel', exact: true }).click();
  await page.getByLabel('Add workspace panel').first().click();
  await page.getByRole('button', { name: 'TF tree', exact: true }).click();
  await page.waitForTimeout(2000);
  await page.getByLabel('Open Robo-Boy assistant').click();
  const t0 = Date.now();
  await page.getByRole('textbox', { name: /Ask the assistant|Continue/ }).fill('add a new pad to move the robot left and right. check which ros stuff are available.');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    const ok = await page.getByText('ok from mock').count();
    const connected = await page.getByLabel('Status: Connected').count();
    if (ok || !connected) { console.log(`T+${Date.now() - t0}ms reply=${ok} connected=${connected}`); break; }
  }
  console.log('CONNECTED: ' + await page.getByLabel('Status: Connected').count());
  console.log('BODY has error boundary: ' + await page.getByText(/Something went wrong/).count());
  await page.screenshot({ path: `${OUT}/real2.png` });
  console.log('ERRORS ' + JSON.stringify(errors.slice(0, 20), null, 1));
});
