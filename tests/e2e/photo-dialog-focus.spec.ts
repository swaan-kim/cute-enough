import { test, expect, openHome, expectPhoto } from './fixtures';

test('owner photo keeps keyboard focus inside its dialog and restores the original trigger without spending tickets', async ({ page, flow }) => {
  flow.makeOwner();
  await openHome(page);
  await page.getByRole('button', { name: '내가 소개한 강아지', exact: true }).tap();
  const trigger = page.getByRole('button', { name: '사진 바로 보기', exact: true });
  await expect(trigger).toBeEnabled();
  const originalTrigger = await trigger.elementHandle();
  expect(originalTrigger).not.toBeNull();

  // A keyboard user activates the existing owner-photo action. The list stays
  // mounted beneath the overlay, so closing must return to this exact button.
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '강아지 실사 사진' });
  const close = dialog.getByRole('button', { name: '사진 닫기', exact: true });
  await expect(close).toBeFocused();
  await expectPhoto(page, flow.owner!.name!);

  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '이 사진 신고하기', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await originalTrigger!.evaluate((button) => button.isConnected && document.activeElement === button)).toBe(true);

  expect(flow.count('ownerPhoto')).toBe(1);
  expect(flow.calls.find((call) => call.action === 'ownerPhoto')!.body.petId).toBe(flow.owner!.id);
  for (const action of ['reveal', 'albumPhoto', 'rewardStart', 'rewardComplete', 'setFavorite']) {
    expect(flow.count(action), `${action} is not part of owner-photo keyboard navigation`).toBe(0);
  }
  expect(flow.remaining).toBe(2);
  expect(flow.grantCount).toBe(0);
  expect(flow.completionCount).toBe(0);
});
