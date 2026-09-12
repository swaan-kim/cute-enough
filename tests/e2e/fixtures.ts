import { test as base, expect, type Page } from '@playwright/test';
import designs from '../../src/data/previewPetDesigns.json' with { type: 'json' };
import type { PetSummary } from '../../src/types';

export const names = ['하늘', '구름', '보리', '두부'];
export const petIds = names.map((_, i) => `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6d8AAAAASUVORK5CYII=', 'base64');
type Body = Record<string, any>;
type Call = { action: string; body: Body };
type Session = { petId: string; earned: boolean; cancelled: boolean; consumed: boolean };

export class FlowServer {
  userHash = 'browser-flow-fixture-user';
  favorites = new Map<string, Set<string>>();
  calls: Call[] = [];
  unexpected: string[] = [];
  errors: string[] = [];
  photos: string[] = [];
  remaining = 2;
  grantCount = 0;
  completionCount = 0;
  photoDelayMs = 0;
  prepareDelayMs = 0;
  failPhoto = false;
  sessions = new Map<string, Session>();
  results = new Map<string, Body>();
  pets: PetSummary[] = names.map((name, i) => ({
    id: petIds[i], name, houseSlot: i + 1, designVersion: 1, designStatus: 'ready',
    publishedDesign: structuredClone(designs['sample-haneul']) as unknown as PetSummary['publishedDesign'],
    traits: { schemaVersion: 1, earShape: 'upright', headShape: 'oval', baseColor: 'cream', secondaryColor: 'white', markingPattern: 'none', muzzle: 'short', confidence: 1 },
    photoAvailable: true, approvalStatus: 'approved', isMine: false, shareable: false,
    collection: { totalCount: 3, collectedCount: 0, collectedToday: false, canCollectToday: true },
    unlockedPhotoCount: 0, hasUnseenPhotos: true,
  }));
  owner?: PetSummary;
  favoriteCount(petId: string) { return this.favorites.get(petId)?.size ?? 0; }
  withFavorite(pet: PetSummary) { return { ...pet, isFavorite: this.favorites.get(pet.id)?.has(this.userHash) ?? false }; }
  count(action: string) { return this.calls.filter((call) => call.action === action).length; }
  status() {
    const earned = [...this.sessions.values()].filter((s) => s.earned).length;
    return { allowance: { date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()), freeUsed: 2 - this.remaining,
      remaining: this.remaining, nextChargeAt: new Date(Date.now() + 10_800_000).toISOString(), rewardedUsed: earned,
      rewardedLimit: 2, rewardedRemaining: 2 - earned, bonusTickets: 0, uploadCredit: false, uploadUsed: false },
      capabilities: { ads: true, share: false, notifications: false }, serverNow: new Date().toISOString(),
      adCredits: [...this.sessions].filter(([, s]) => s.earned && !s.consumed).map(([sessionId, s]) => ({ sessionId, petId: s.petId, canRebind: false })) };
  }
  progress() {
    const metPetIds = this.pets.filter((p) => p.collection?.collectedToday).map((p) => p.id);
    return { date: this.status().allowance.date, metPetIds, metCount: metPetIds.length, totalCount: 4, completed: metPetIds.length === 4 };
  }
  makeReplay(index = 0) {
    const pet = this.pets[index];
    pet.collection = { collectedCount: 1, totalCount: 3, collectedToday: true, canCollectToday: false, todayPhotoId: `${pet.id}-photo` };
    pet.albumPhotoId = `${pet.id}-photo`; pet.unlockedPhotoCount = 1;
    pet.revisitUntil = new Date(Date.now() + 3_600_000).toISOString();
  }
  makeOwner() {
    this.owner = { ...structuredClone(this.pets[0]), id: '10000000-0000-4000-8000-000000000005', name: '우리집', isMine: true, ownerPhotoAvailable: true, houseSlot: undefined };
  }
  photo(petId: string) {
    return { petId, photoId: `${petId}-photo`, photoUrl: `http://127.0.0.1:4179/e2e-photo/${petId}.png`,
      signedUrlExpiresAt: new Date(Date.now() + 300_000).toISOString(), photoCaption: '브라우저 테스트 사진' };
  }
  async answer(body: Body): Promise<Body> {
    const { action, petId, sessionId, requestId } = body;
    this.calls.push({ action, body });
    expect(body.userHash).toBe(this.userHash);
    expect(body.designFormat).toBe('svg-scene-v1');
    if (action === 'house') return { pets: this.pets.map((pet) => this.withFavorite(pet)), dailyPets: this.pets.map((pet) => this.withFavorite(pet)), ownerBonusPet: this.owner, allowance: this.status().allowance,
      rewardStatus: this.status(), dailyProgress: this.progress(), serverNow: new Date().toISOString() };
    if (action === 'rewardStatus') return this.status();
    if (action === 'notificationSettings') return { enabled: false, available: false };
    if (action === 'mine') return { pets: this.owner ? [{ ...this.owner, favoriteCount: this.favoriteCount(this.owner.id) }] : [] };
    if (action === 'design') return { pet: this.pets.find((p) => p.id === petId) ?? this.owner };
    if (action === 'album') return { pets: this.pets.filter((pet) => (pet.unlockedPhotoCount ?? 0) > 0)
      .map((pet) => ({ ...this.withFavorite(pet), unlockedPhotos: [{ photoId: pet.albumPhotoId!, unlockedAt: new Date().toISOString(), source: 'reveal' }] }))
      .filter((pet) => !body.favoritesOnly || pet.isFavorite), legacyGiftCount: 0 };
    if (action === 'albumPhoto') {
      const pet = this.pets.find((candidate) => candidate.albumPhotoId === body.photoId);
      expect(pet?.unlockedPhotoCount).toBeGreaterThan(0);
      return { ...this.photo(pet!.id), allowance: this.status().allowance, rewardStatus: this.status(), dailyProgress: this.progress(),
        collection: pet!.collection, unlockedPhotoCount: pet!.unlockedPhotoCount, albumPhotoId: pet!.albumPhotoId,
        isFavorite: this.withFavorite(pet!).isFavorite, revisitUntil: pet!.revisitUntil, hasUnseenPhotos: true };
    }
    if (action === 'setFavorite') {
      const pet = this.pets.find((candidate) => candidate.id === petId);
      expect(pet?.unlockedPhotoCount).toBeGreaterThan(0);
      expect(pet?.approvalStatus).toBe('approved'); expect(pet?.isMine).toBe(false);
      expect(typeof body.isFavorite).toBe('boolean');
      const users = this.favorites.get(petId) ?? new Set<string>();
      if (body.isFavorite) users.add(this.userHash); else users.delete(this.userHash);
      this.favorites.set(petId, users);
      return { petId, isFavorite: users.has(this.userHash), favoriteCount: users.size };
    }
    if (action === 'rewardStart') {
      expect(requestId).toBeTruthy();
      if (!this.sessions.has(requestId)) this.sessions.set(requestId, { petId, earned: false, cancelled: false, consumed: false });
      return { ...this.status(), sessionId: requestId };
    }
    if (action === 'rewardComplete') {
      const session = this.sessions.get(sessionId); expect(session).toBeTruthy();
      if (!session!.earned) { session!.earned = true; this.completionCount++; }
      return this.status();
    }
    if (action === 'rewardCancel') {
      const session = this.sessions.get(sessionId); expect(session).toBeTruthy();
      if (!session!.earned) session!.cancelled = true;
      return this.status();
    }
    if (action === 'photoPrepare') {
      expect(requestId).toBeTruthy();
      const pet = this.pets.find((p) => p.id === petId);
      if (body.accessKind === 'owner') expect(this.owner?.id).toBe(petId);
      else { expect(body.accessKind).toBe('replay'); expect(pet?.collection?.collectedToday).toBe(true); }
      if (this.prepareDelayMs) await new Promise((resolve) => setTimeout(resolve, this.prepareDelayMs));
      return this.photo(petId);
    }
    if (action === 'ownerPhoto') {
      expect(this.owner?.id).toBe(petId);
      return { ...this.photo(petId), ownerPhotoAvailable: true };
    }
    if (action === 'reveal') {
      const pet = this.pets.find((p) => p.id === petId)!; expect(pet).toBeTruthy();
      expect(requestId).toBeTruthy();
      if (this.results.has(requestId)) return this.results.get(requestId)!;
      if (body.photoIntent !== 'replay') {
        if (body.unlockMethod === 'REWARDED') {
          const session = this.sessions.get(body.adSessionId);
          expect(session).toMatchObject({ earned: true, consumed: false, petId });
          session!.consumed = true;
        } else { expect(body.unlockMethod).toBe('FREE'); expect(this.remaining).toBeGreaterThan(0); this.remaining--; }
        this.grantCount++;
        this.makeReplay(this.pets.indexOf(pet));
      } else expect(pet.collection?.collectedToday).toBe(true);
      const result = { ...this.photo(petId), allowance: this.status().allowance, rewardStatus: this.status(), dailyProgress: this.progress(),
        collection: pet.collection, unlockedPhotoCount: pet.unlockedPhotoCount, albumPhotoId: pet.albumPhotoId, hasUnseenPhotos: true,
        revisitUntil: pet.revisitUntil, alreadyRevealed: body.photoIntent === 'replay', isFavorite: this.withFavorite(pet).isFavorite };
      this.results.set(requestId, result); return result;
    }
    throw new Error(`Unexpected local API action: ${action}`);
  }
  async install(page: Page) {
    page.on('pageerror', (error) => this.errors.push(error.message));
    await page.addInitScript((userHash) => { Object.assign(window, { __nativeUserHash: userHash }); }, this.userHash);
    // Observe browser timing, without replacing the production API behavior.
    await page.addInitScript(() => {
      const log: Array<{ action: string; at: number; body?: unknown; loading?: boolean }> = [];
      Object.assign(window, { __flowTiming: log });
      const original = window.fetch;
      window.fetch = (input, init) => {
        if (typeof init?.body === 'string' && String(input).includes('/functions/v1/pet-api')) {
          const body = JSON.parse(init.body); log.push({ action: body.action, at: performance.now(), body });
        }
        return original(input, init);
      };
      document.addEventListener('pointerup', (event) => {
        const target = event.target instanceof Element ? event.target.closest('.feed-zone') : null;
        if (target?.getAttribute('aria-label')?.includes('2번 완료')) log.push({ action: 'third-input', at: performance.now() });
      }, true);
      const observer = new MutationObserver(() => {
        if (document.querySelector('[aria-label="강아지 실사 사진"]') && log.at(-1)?.action !== 'modal-visible') {
          if (log.some((entry) => entry.action === 'third-input')) log.push({ action: 'modal-visible', at: performance.now(),
            loading: Boolean(document.querySelector('[aria-label="강아지 실사 사진"] .photo-skeleton')) });
        }
      });
      observer.observe(document, { subtree: true, childList: true });
    });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'http://127.0.0.1:4179') {
        if (url.pathname === '/e2e-api/functions/v1/pet-api') {
          try { await route.fulfill({ json: await this.answer(route.request().postDataJSON()) }); }
          catch (error) { this.errors.push(String(error)); await route.fulfill({ status: 500, json: { error: 'Fixture rejected request', code: 'FIXTURE_FAILURE' } }); }
          return;
        }
        if (url.pathname.startsWith('/e2e-photo/')) {
          this.photos.push(url.pathname);
          if (this.photoDelayMs) await new Promise((resolve) => setTimeout(resolve, this.photoDelayMs));
          await route.fulfill({ status: this.failPhoto ? 503 : 200, body: png, contentType: 'image/png' }); return;
        }
        await route.continue(); return;
      }
      // Only the exact existing presentation assets are replaced locally.
      if (url.origin === 'https://static.toss.im' && /^\/2d-emojis\/png\/4x\/u1F(360|9B4|356)\.png$/.test(url.pathname)) {
        await route.fulfill({ body: png, contentType: 'image/png' }); return;
      }
      // Real TDS injects its published font CSS; deterministic local font fallback.
      if (url.origin === 'https://static.toss.im' && url.pathname.startsWith('/fonts/')) {
        await route.fulfill({ body: '', contentType: 'text/css' }); return;
      }
      this.unexpected.push(route.request().url()); await route.abort('blockedbyclient');
    });
  }
}

export const test = base.extend<{ flow: FlowServer }>({
  flow: async ({ page }, use, testInfo) => {
    const flow = new FlowServer(); await flow.install(page); await use(flow);
    if (testInfo.status !== testInfo.expectedStatus) console.log('Flow failure evidence', JSON.stringify({ calls: flow.calls, errors: flow.errors, unexpected: flow.unexpected }));
    await testInfo.attach('flow-evidence', { body: JSON.stringify({ calls: flow.calls, photos: flow.photos, grants: flow.grantCount,
      native: await page.evaluate(() => (window as any).__nativeFixture?.events).catch(() => []),
      timing: await page.evaluate(() => (window as any).__flowTiming).catch(() => []) }, null, 2), contentType: 'application/json' });
    expect(flow.unexpected, 'Unexpected external requests are blocked').toEqual([]);
    expect(flow.errors, 'No application or fixture errors').toEqual([]);
  },
});
export { expect };
export async function openHome(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('region', { name: '강아지들이 있는 집' })).toBeVisible();
  await expect(page.getByRole('button', { name: `${names[0]} 옮기기 또는 선택` })).toBeEnabled();
}
export async function choose(page: Page, name: string) {
  // House pets wander by design: tap observed bounds without waiting for animation stability.
  const target = page.getByRole('button', { name: `${name} 옮기기 또는 선택` });
  const box = await target.boundingBox(); expect(box).toBeTruthy();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
}
export async function feed(page: Page, name: string) {
  await page.getByRole('button', { name: '고구마 간식', exact: true }).tap();
  await page.getByRole('button', { name: `${name}에게 간식 주기` }).tap();
  await expect(page.getByRole('button', { name: `${name} 쓰다듬기, 0번 완료` })).toBeVisible();
}
export async function petThree(page: Page, name: string) {
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: `${name} 쓰다듬기, ${i}번 완료` }).tap();
}
export async function expectPhoto(page: Page, name: string) {
  const photo = page.getByRole('img', { name: `${name}의 실제 모습` });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.getByText('사진을 꺼내고 있어요', { exact: true })).toHaveCount(0);
}
export async function native(page: Page, types: string[]) {
  await page.evaluate((values) => values.forEach((type) => (window as any).__nativeFixture.emitShow(type)), types);
}
export async function startAd(page: Page, name = names[2]) {
  await page.getByRole('button', { name: /광고 보고 한 마리 더 만나기/ }).tap();
  await page.getByRole('button', { name: new RegExp(name) }).filter({ hasText: name }).last().tap();
  await page.getByRole('button', { name: '광고 보고 이 친구 만나기', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).__nativeFixture.events.filter((e: any) => e.name === 'show').length)).toBe(1);
}
