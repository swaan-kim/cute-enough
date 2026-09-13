import { test, expect, names, petIds, openHome, choose, feed, petThree, expectPhoto, native, startAd } from './fixtures';

test('two free dogs → zero tickets → ad picker → earned reward → three taps → photo', async ({ page, flow }, testInfo) => {
  await openHome(page);
  for (let i = 0; i < 2; i++) {
    await expect(page.getByRole('region', { name: new RegExp(`강아지 티켓 ${2 - i}장`) })).toBeVisible();
    await choose(page, names[i]); await feed(page, names[i]);
    expect(flow.count('photoPrepare')).toBe(0);
    expect(flow.grantCount).toBe(i);
    await petThree(page, names[i]); await expectPhoto(page, names[i]);
    expect(flow.grantCount).toBe(i + 1);
    await page.getByRole('button', { name: '사진 닫기' }).tap();
  }
  await expect(page.getByRole('region', { name: /강아지 티켓 0장/ })).toBeVisible();
  await startAd(page);
  expect(flow.count('reveal')).toBe(2);
  expect(flow.completionCount).toBe(0);
  await native(page, ['requested', 'show', 'userEarnedReward', 'dismissed']);
  await feed(page, names[2]);
  expect(flow.completionCount).toBe(1);
  expect(flow.grantCount).toBe(2);
  expect(flow.count('photoPrepare')).toBe(0);
  await petThree(page, names[2]); await expectPhoto(page, names[2]);
  expect(flow.remaining).toBe(0); expect(flow.grantCount).toBe(3);
  const reveal = flow.calls.filter((c) => c.action === 'reveal');
  expect(reveal.map((c) => [c.body.petId, c.body.unlockMethod])).toEqual([[petIds[0], 'FREE'], [petIds[1], 'FREE'], [petIds[2], 'REWARDED']]);
  const timing = await page.evaluate(() => (window as any).__flowTiming as Array<{ action: string; at: number; loading?: boolean }>);
  const input = timing.filter((e) => e.action === 'third-input').at(-1)!;
  const request = timing.filter((e) => e.action === 'reveal').at(-1)!;
  const modal = timing.find((e) => e.action === 'modal-visible' && e.at > input.at)!;
  expect(request.at - input.at, 'Request begins during the final 900 ms reaction').toBeLessThan(400);
  expect(modal.at - input.at, 'Reaction remains visible before the modal').toBeGreaterThanOrEqual(850);
  expect(timing.filter((event) => event.action === 'modal-visible').every((event) => !event.loading), 'Fast images open without a skeleton flash').toBe(true);
  await page.screenshot({ path: testInfo.outputPath('reward-photo-mobile.png') });
});

test('ad dismissal without reward cancels the session and spends nothing', async ({ page, flow }) => {
  flow.remaining = 0; await openHome(page); await startAd(page);
  await native(page, ['show', 'dismissed']);
  await expect.poll(() => flow.count('rewardCancel')).toBe(1);
  await expect(page.getByText('광고 시청을 완료해야 이 친구를 만날 수 있어요.', { exact: true }).first()).toBeVisible();
  expect(flow.count('rewardComplete')).toBe(0); expect(flow.count('reveal')).toBe(0); expect(flow.grantCount).toBe(0);
  await page.getByRole('button', { name: '충전 기다리기' }).tap();
  await expect(page.getByRole('region', { name: /강아지 티켓 0장/ })).toBeVisible();
});

test('failed native load offers retry and never opens a reward session', async ({ page, flow }) => {
  flow.remaining = 0;
  await page.addInitScript(() => { (window as any).__nativeAutoLoad = false; });
  await openHome(page);
  await page.getByRole('button', { name: /광고 보고 한 마리 더 만나기/ }).tap();
  await page.getByRole('button', { name: new RegExp(names[2]) }).last().tap();
  await expect.poll(() => page.evaluate(() => (window as any).__nativeFixture.events.filter((e: any) => e.name === 'load').length)).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).__nativeFixture.failLoad());
  await expect(page.getByRole('button', { name: '광고 다시 준비하기' })).toBeVisible();
  expect(flow.count('rewardStart')).toBe(0); expect(flow.count('reveal')).toBe(0); expect(flow.count('rewardComplete')).toBe(0);
});

test('duplicate earned events and manual continue spend one reward once', async ({ page, flow }) => {
  flow.remaining = 0; await openHome(page); await startAd(page);
  await native(page, ['show', 'userEarnedReward', 'userEarnedReward']);
  await expect(page.getByRole('button', { name: '받은 보상으로 계속하기', exact: true })).toBeVisible();
  await expect.poll(() => flow.completionCount).toBe(1);
  expect(flow.grantCount).toBe(0);
  await page.getByRole('button', { name: '받은 보상으로 계속하기', exact: true }).tap();
  await feed(page, names[2]); await petThree(page, names[2]); await expectPhoto(page, names[2]);
  await native(page, ['userEarnedReward', 'dismissed', 'dismissed']);
  expect(flow.count('rewardComplete')).toBe(1); expect(flow.grantCount).toBe(1); expect(flow.count('reveal')).toBe(1);
});

for (const accessKind of ['replay', 'owner'] as const) {
  test(`${accessKind} downloads only on the third input without spending a ticket`, async ({ page, flow }) => {
    if (accessKind === 'owner') flow.makeOwner(); else flow.makeReplay();
    const name = accessKind === 'owner' ? '우리집' : names[0];
    await openHome(page); await choose(page, name); await feed(page, name);
    expect(flow.count('photoPrepare')).toBe(0);
    expect(flow.photos).toHaveLength(0);
    expect(flow.count('reveal')).toBe(0); expect(flow.count('ownerPhoto')).toBe(0);
    expect(flow.grantCount).toBe(0); expect(flow.remaining).toBe(2);
    await petThree(page, name); await expectPhoto(page, name);
    expect(flow.photos).toHaveLength(1);
    expect(flow.count(accessKind === 'owner' ? 'ownerPhoto' : 'reveal')).toBe(1);
    expect(flow.grantCount).toBe(0); expect(flow.remaining).toBe(2);
  });
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`final smile lasts 900 ms with saved geometry: ${reducedMotion}`, async ({ page, flow }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    await page.clock.install();
    await openHome(page); await choose(page, names[0]); await feed(page, names[0]);
    // Use the browser clock, not the Node clock (they can differ by a few ms).
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
    const originalEyes = await page.locator('.feed-zone [data-design-part$="-eye"]').evaluateAll((eyes) => eyes.map((eye) => eye.outerHTML));
    const sha = await page.locator('.feed-zone [data-design-sha256]').getAttribute('data-design-sha256');
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: `${names[0]} 쓰다듬기, ${i}번 완료` }).tap();
      await expect(page.locator('.feed-zone .pet-smile-arc')).toHaveCount(2);
      await page.clock.runFor(450);
      await expect(page.locator('.feed-zone .pet-smile-arc')).toHaveCount(0);
    }
    expect(flow.count('photoPrepare')).toBe(0);
    expect(flow.count('reveal')).toBe(0); expect(flow.photos).toHaveLength(0);
    await page.getByRole('button', { name: `${names[0]} 쓰다듬기, 2번 완료` }).tap();
    await expect.poll(() => flow.count('reveal')).toBe(1);
    await page.clock.runFor(250);
    await expect(page.locator('.feed-zone .pet-smile-arc')).toHaveCount(2);
    expect(await page.locator('.feed-zone [data-design-part$="-eye"]').evaluateAll((eyes) => eyes.map((eye) => eye.outerHTML))).toEqual(originalEyes);
    await expect(page.locator('.feed-zone [data-design-sha256]')).toHaveAttribute('data-design-sha256', sha!);
    const motion = await page.locator('.feed-zone .dog-tail').first().evaluate((tail) => ({
      tail: getComputedStyle(tail).animationName,
      body: getComputedStyle(tail.closest('.dog-avatar')!).animationName,
    }));
    if (reducedMotion === 'reduce') expect(motion).toEqual({ tail: 'none', body: 'none' });
    else { expect(motion.tail).toMatch(/petreactionwag/); expect(motion.body).toBe('petreactionfinal'); }
    await page.screenshot({ path: testInfo.outputPath(`final-smile-${reducedMotion}.png`) });
    await page.clock.runFor(649);
    await expect(page.getByRole('dialog', { name: '강아지 실사 사진' })).toHaveCount(0);
    await expect(page.locator('.feed-zone .pet-smile-arc')).toHaveCount(2);
    await page.clock.runFor(1);
    await expect(page.getByRole('dialog', { name: '강아지 실사 사진' })).toBeVisible();
    expect(flow.count('reveal')).toBe(1); expect(flow.count('photoPrepare')).toBe(0);
  });
}

test('slow photo keeps one skeleton until decoded and close prevents a stale overlay', async ({ page, flow }) => {
  flow.photoDelayMs = 2_500;
  await openHome(page); await choose(page, names[0]); await feed(page, names[0]); await petThree(page, names[0]);
  await expect(page.getByText('사진을 꺼내고 있어요', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '강아지 실사 사진' })).toHaveCount(1);
  await expectPhoto(page, names[0]);
  await page.getByRole('button', { name: '사진 닫기' }).tap();
  await choose(page, names[1]); await feed(page, names[1]); await petThree(page, names[1]);
  await expect(page.getByText('사진을 꺼내고 있어요', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '사진 닫기' }).tap();
  await expect(page.getByRole('region', { name: '강아지들이 있는 집' })).toBeVisible();
  // Wait past the controlled HTTP delay to observe the actual late completion.
  await page.waitForTimeout(2_700);
  await expect(page.getByRole('dialog', { name: '강아지 실사 사진' })).toHaveCount(0);
});

test('leaving before the third input requests no photo and never opens a modal', async ({ page, flow }) => {
  flow.makeReplay();
  await openHome(page); await choose(page, names[0]); await feed(page, names[0]);
  const dog = page.locator('.feed-zone');
  await dog.tap(); await dog.tap();
  expect(flow.count('photoPrepare')).toBe(0);
  await page.evaluate(() => (window as any).__nativeFixture.navigate('backEvent'));
  await expect(page.getByRole('region', { name: '강아지들이 있는 집' })).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(flow.count('reveal')).toBe(0); expect(flow.grantCount).toBe(0); expect(flow.remaining).toBe(2);
  expect(flow.photos).toHaveLength(0);
  await expect(page.getByRole('dialog', { name: '강아지 실사 사진' })).toHaveCount(0);
});
