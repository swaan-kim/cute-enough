import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runtime: { isPreviewRuntime: false, runtimeEnvironment: 'production', shareOgUrl: 'https://example.com/og.png' },
  createLink: vi.fn(),
  sendMessage: vi.fn(),
  getSchemeUri: vi.fn(),
}));

vi.mock('./runtime', () => mocks.runtime);
vi.mock('@apps-in-toss/web-framework', () => ({
  Device: {}, User: {},
  FetchAlbumPhotosPermissionError: class extends Error {},
  getSchemeUri: mocks.getSchemeUri,
  Share: { createLink: mocks.createLink, sendMessage: mocks.sendMessage },
}));

import { sharePet } from './toss';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.isPreviewRuntime = false;
  mocks.runtime.runtimeEnvironment = 'production';
  mocks.createLink.mockResolvedValue('https://example.com/pet-link');
  mocks.sendMessage.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('sharePet message', () => {
  it.each(['구르미', '하늘'])('keeps the dog emoji after the new message for %s', async (name) => {
    await sharePet('pet-1', name);
    expect(mocks.sendMessage).toHaveBeenCalledWith({ message: `${name} 강아지가 놀러왔어요 🐶\nhttps://example.com/pet-link` });
    expect(mocks.createLink).toHaveBeenCalledWith({ path: 'intoss://cute-enough/pet/pet-1', ogImageUrl: 'https://example.com/og.png' });
  });

  it.each([undefined, '  '])('uses a natural fallback when the name is absent', async (name) => {
    await sharePet('pet-1', name);
    expect(mocks.sendMessage).toHaveBeenCalledWith({ message: '귀여운 강아지가 놀러왔어요 🐶\nhttps://example.com/pet-link' });
  });

  it('uses the same message for browser sharing without changing its link', async () => {
    mocks.runtime.isPreviewRuntime = true;
    mocks.sendMessage.mockRejectedValueOnce(new Error('no bridge in preview'));
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    await sharePet('pet-1', '우유');
    expect(share).toHaveBeenCalledWith({ title: '옆집 강아지', text: '우유 강아지가 놀러왔어요 🐶', url: `${window.location.origin}/pet/pet-1` });
    expect(mocks.createLink).not.toHaveBeenCalled();
  });
});
