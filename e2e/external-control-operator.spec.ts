import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('operator page recovers its controls after a failed poll, keeps its key on reload, and fits mobile', async ({ page }) => {
  const state = {
    allowControl: true, gatewayReady: true, owner: null,
    requests: [{ requestId: 'request-1', label: 'Remote session', intent: 'acquire', ownerApproved: true, decision: null as boolean | null }],
    events: [{ time: '2026-10-09T10:00:00Z', message: 'Access enabled. Each request still needs approval.' }],
  };
  let offline = false;
  const commands: unknown[] = [];
  await page.route('http://robot-operator.test/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) {
      expect(request.headers().authorization).toBe('Bearer operator-test-key');
      if (offline) return route.abort();
      if (request.method() === 'POST') {
        const command = request.postDataJSON();
        commands.push(command);
        if (path === '/api/access') state.allowControl = command.allowControl;
        if (path === '/api/decision') state.requests[0].decision = command.approve;
      }
      return route.fulfill({ json: state });
    }
    const files: Record<string, [string, string]> = {
      '/': ['html', 'text/html'], '/operator.js': ['js', 'text/javascript'], '/operator.css': ['css', 'text/css'],
    };
    const asset = files[path];
    if (!asset) return route.fulfill({ status: 404 });
    return route.fulfill({ contentType: asset[1], body: readFileSync(resolve('infra/ros/external_control_ui.' + asset[0]), 'utf8') });
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('http://robot-operator.test/#key=operator-test-key');
  const approve = page.getByRole('button', { name: 'Approve', exact: true });
  await expect(approve).toBeEnabled();
  expect(commands).toEqual([]); // An open switch never automatically approves.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(page.url()).toBe('http://robot-operator.test/');
  offline = true;
  await expect(page.locator('#access')).toHaveText('Connection unavailable');
  await expect(approve).toBeDisabled();
  offline = false;
  // The snapshot is identical to the last successful poll; controls must recover.
  await expect(approve).toBeEnabled();
  await page.reload();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText(/Robot approval sent/)).toBeVisible();
  expect(commands).toEqual([{ requestId: 'request-1', approve: true }]);
  await expect(page.locator('#owner')).toHaveText('No one');
  await page.getByRole('button', { name: 'Disable access', exact: true }).click();
  await expect(approve).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Deny', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  expect(commands).toEqual([{ requestId: 'request-1', approve: true }, { allowControl: false }, { requestId: 'request-1', approve: false }]);
});
