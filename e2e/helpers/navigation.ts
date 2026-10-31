import type { Page } from '@playwright/test';

/** App tools remain available in the same menu before and after connecting. */
export async function openAppTool(page: Page, name: string) {
  await page.getByRole('button', { name: /Switch connections/ }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
