import { test, expect, names, openHome } from './fixtures';

test('normal development StrictMode entry loads all house dogs and survives a fresh mount', async ({ page, flow }) => {
  await openHome(page);
  for (const name of names) await expect(page.getByRole('button', { name: `${name} 옮기기 또는 선택` })).toBeVisible();
  const before = flow.count('house'); expect(before).toBeGreaterThan(0);
  await page.reload();
  for (const name of names) await expect(page.getByRole('button', { name: `${name} 옮기기 또는 선택` })).toBeVisible();
  expect(flow.count('house')).toBeGreaterThan(before);
  expect(flow.count('reveal')).toBe(0); expect(flow.grantCount).toBe(0);
});
