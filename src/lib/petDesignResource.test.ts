import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_PETS } from '../data/samplePets';
import { createPetDesignResource, usePetDesign, usesPublishedDesign } from './petDesignResource';
import type { PetDesignDelivery } from '../types';
const mocks = vi.hoisted(() => ({ fetchPetDesign: vi.fn() }));
vi.mock('./api', () => mocks);
const seed = { ...SAMPLE_PETS[0], id: 'stored-design-fixture' };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); mocks.fetchPetDesign.mockReset(); });

describe('published SVG document resource', () => {
  it('accepts a stored document immediately and never compiles a missing approved design', () => {
    expect(createPetDesignResource(seed).getSnapshot().status).toBe('ready');
    expect(createPetDesignResource({ ...seed, publishedDesign: undefined, designStatus: 'missing' }).getSnapshot().status).toBe('error');
    expect(usesPublishedDesign({ ...seed, publishedDesign: undefined, approvalStatus: 'approved' })).toBe(true);
    expect(usesPublishedDesign({ ...seed, publishedDesign: undefined, approvalStatus: 'pending' })).toBe(false);
  });

  it('deduplicates reloads and does not use previous geometry after a failed reload', async () => {
    const load = vi.fn().mockResolvedValue(seed);
    const resource = createPetDesignResource(seed, load);
    await Promise.all([resource.retry(), resource.retry()]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(resource.getSnapshot()).toMatchObject({ status: 'ready', publishedDesign: seed.publishedDesign });
    load.mockRejectedValueOnce(new Error('offline'));
    await resource.retry();
    expect(resource.getSnapshot()).toMatchObject({ status: 'error', publishedDesign: undefined });
  });

  it('rejects unsafe documents, wrong identities, and older design versions', async () => {
    const unsafe = { ...seed.publishedDesign!, document: { ...seed.publishedDesign!.document, nodes: [{ tag: 'script' }] } };
    const load = vi.fn().mockResolvedValueOnce({ ...seed, publishedDesign: unsafe })
      .mockResolvedValueOnce({ ...seed, id: 'another-dog' })
      .mockResolvedValueOnce({ ...seed, designVersion: 1 });
    const resource = createPetDesignResource({ ...seed, designVersion: 2, publishedDesign: { ...seed.publishedDesign!, designVersion: 2 } }, load);
    for (let attempt = 0; attempt < 3; attempt++) {
      await resource.retry();
      expect(resource.getSnapshot().status).toBe('error');
    }
  });

  it('does not allow a late response or a stale parent summary to replace a newer document', async () => {
    let finish!: (value: PetDesignDelivery & { designVersion?: number }) => void;
    const resource = createPetDesignResource(seed, () => new Promise((resolve) => { finish = resolve; }));
    const request = resource.retry();
    const newer = { ...seed, designVersion: 2, publishedDesign: { ...seed.publishedDesign!, designVersion: 2 } };
    resource.seed(newer);
    finish(seed);
    await request;
    resource.seed(seed);
    expect(resource.getSnapshot()).toMatchObject({ status: 'ready', designVersion: 2, publishedDesign: newer.publishedDesign });
  });

  it('reuses a valid document across screens with no expiry or image requests', async () => {
    vi.useFakeTimers();
    const first = renderHook(() => usePetDesign({ ...seed, id: 'no-expiry' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000); window.dispatchEvent(new Event('focus')); });
    expect(first.result.current?.snapshot.status).toBe('ready');
    expect(mocks.fetchPetDesign).not.toHaveBeenCalled();
    first.unmount();
    const second = renderHook(() => usePetDesign({ ...seed, id: 'no-expiry' }));
    expect(second.result.current?.snapshot.status).toBe('ready');
    second.unmount();
  });

  it('reloads an unavailable design once on reconnect without rendering traits', async () => {
    const pet = { ...seed, id: 'reconnect-svg', publishedDesign: undefined, designStatus: 'unavailable' as const };
    mocks.fetchPetDesign.mockResolvedValue({ ...seed, id: pet.id });
    const hook = renderHook(() => usePetDesign(pet));
    expect(hook.result.current?.snapshot.publishedDesign).toBeUndefined();
    await act(async () => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
    expect(mocks.fetchPetDesign).toHaveBeenCalledTimes(1);
    expect(hook.result.current?.snapshot.status).toBe('ready');
    hook.unmount();
  });

  it('removes a ready document after a same-version pause or invalidated API summary', () => {
    for (const patch of [
      { approvalStatus: 'paused' as const },
      { publishedDesign: undefined, designStatus: 'unavailable' as const },
    ]) {
      const resource = createPetDesignResource(seed);
      resource.seed({ ...seed, ...patch });
      expect(resource.getSnapshot()).toMatchObject({ status: 'error', publishedDesign: undefined });
    }
  });

  it('keeps a successful retry when remounted with the same original missing summary', async () => {
    const missing = { ...seed, publishedDesign: undefined, designStatus: 'missing' as const };
    const resource = createPetDesignResource(missing, async () => seed);
    await resource.retry();
    resource.seed({ ...missing });
    expect(resource.getSnapshot().status).toBe('ready');
  });
});
