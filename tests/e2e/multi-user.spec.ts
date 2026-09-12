import type { Browser, BrowserContext, Page } from '@playwright/test';
import { FlowServer, test, expect, names, petIds, openHome, choose, feed, petThree, expectPhoto } from './fixtures';

async function actor(browser: Browser, server: FlowServer, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    baseURL: 'http://127.0.0.1:4179', serviceWorkers: 'block' });
  const page = await context.newPage(); await server.install(page);
  return { context, page };
}

async function ownerCount(page: Page, count: number) {
  await page.goto('/');
  await page.getByRole('button', { name: '내가 소개한 강아지', exact: true }).tap();
  await expect(page.getByText(`♡ 마음에 담은 사람 ${count}명`, { exact: true })).toBeVisible();
}

test('B favorite persists after a fresh app session and A owner count follows favorite and removal', async ({ browser, page, flow }, testInfo) => {
  // Fixtures begin at creator-approved publication. Submission/moderation authority
  // and real shared storage are covered by the SQL journey, not faked as UI approval.
  const owner = new FlowServer(); owner.userHash = 'browser-owner-a'; owner.favorites = flow.favorites;
  owner.owner = { ...structuredClone(flow.pets[0]), isMine: true, ownerPhotoAvailable: true, houseSlot: undefined };
  owner.pets = owner.pets.slice(1);
  const contexts: BrowserContext[] = [];
  try {
    const a = await actor(browser, owner, page.viewportSize()!); contexts.push(a.context);
    await ownerCount(a.page, 0);
    await openHome(page); await choose(page, names[0]); await feed(page, names[0]); await petThree(page, names[0]); await expectPhoto(page, names[0]);
    await page.getByRole('button', { name: '또 보고 싶어요, 마음에 담기', exact: true }).tap();
    await expect.poll(() => flow.favoriteCount(petIds[0])).toBe(1);
    await expect(page.getByRole('button', { name: '마음에 담았어요, 마음에 담기 취소', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await ownerCount(a.page, 1);

    // A fresh B browser context starts with no shared cookies/storage/memory and
    // reads the persisted fixture state through the real HTTP client again.
    const bAgain = await actor(browser, flow, page.viewportSize()!); contexts.push(bAgain.context);
    await openHome(bAgain.page);
    await bAgain.page.getByRole('button', { name: '강아지 앨범', exact: true }).tap();
    await bAgain.page.getByRole('button', { name: '마음에 담은 친구', exact: true }).tap();
    const albumPet = bAgain.page.getByRole('button', { name: new RegExp(`${names[0]}, 모은 사진 1장.*마음에 담은 친구 사진 보기`) });
    await expect(albumPet).toBeVisible(); await albumPet.tap(); await expectPhoto(bAgain.page, names[0]);
    await expect(bAgain.page.getByRole('button', { name: '마음에 담았어요, 마음에 담기 취소', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(flow.grantCount).toBe(1); expect(flow.remaining).toBe(1);
    await bAgain.page.getByRole('button', { name: '마음에 담았어요, 마음에 담기 취소', exact: true }).tap();
    await expect.poll(() => flow.favoriteCount(petIds[0])).toBe(0);
    await ownerCount(a.page, 0);
    await bAgain.page.getByRole('button', { name: '사진 닫기' }).tap();
    await expect(bAgain.page.getByText('또 보고 싶은 친구를 마음에 담아요', { exact: true })).toBeVisible();
    await bAgain.page.getByRole('button', { name: '모든 친구', exact: true }).tap();
    await bAgain.page.getByRole('button', { name: new RegExp(`${names[0]}, 모은 사진 1장.*사진 보기`) }).tap();
    await expectPhoto(bAgain.page, names[0]);
    await expect(bAgain.page.getByRole('button', { name: '또 보고 싶어요, 마음에 담기', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(flow.count('setFavorite')).toBe(2); expect(flow.count('reveal')).toBe(1);
    expect(flow.grantCount).toBe(1); expect(flow.remaining).toBe(1);
    expect(owner.grantCount).toBe(0); expect(owner.remaining).toBe(2);
    expect(owner.errors).toEqual([]); expect(owner.unexpected).toEqual([]);
    await testInfo.attach('owner-viewer-journey', { contentType: 'application/json', body: JSON.stringify({
      ownerCalls: owner.calls, viewerCalls: flow.calls, finalOwnerFavoriteCount: owner.favoriteCount(petIds[0]),
      viewerPhotoGrants: flow.grantCount, ownerErrors: owner.errors, ownerUnexpected: owner.unexpected,
    }, null, 2) });
  } finally { for (const context of contexts) await context.close(); }
});
