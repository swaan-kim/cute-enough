import { beforeEach, describe, expect, it, vi } from 'vitest';

type AlbumPhoto = { id: string; dataUri: string; type?: 'PHOTO' };

const bridge = vi.hoisted(() => {
  const getAlbumItems = Object.assign(
    vi.fn<(options?: unknown) => Promise<AlbumPhoto[]>>(),
    { isSupported: vi.fn(() => true) },
  );
  const getPhotos = Object.assign(
    vi.fn<(options?: unknown) => Promise<AlbumPhoto[]>>(),
    {
      getPermission: vi.fn(),
      openPermissionDialog: vi.fn<() => Promise<'allowed' | 'denied'>>(),
    },
  );

  return { getAlbumItems, getPhotos };
});

vi.mock('@apps-in-toss/web-framework', () => ({
  Device: { getAlbumItems: bridge.getAlbumItems, getPhotos: bridge.getPhotos },
  FetchAlbumPhotosPermissionError: class FetchAlbumPhotosPermissionError extends Error {},
  getSchemeUri: vi.fn(),
  Share: { createLink: vi.fn(), sendMessage: vi.fn() },
  User: {
    getAnonymousKey: Object.assign(vi.fn(), { isSupported: vi.fn(() => true) }),
  },
}));

vi.mock('./runtime', () => ({
  isPreviewRuntime: false,
  runtimeEnvironment: 'private',
  shareOgUrl: 'https://example.com/share.png',
}));

import { isPhotoPickerUnavailableError, pickOnePhoto, pickOnePhotoFromBrowser } from './toss';

describe('pickOnePhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bridge.getAlbumItems.isSupported.mockReturnValue(true);
    bridge.getAlbumItems.mockResolvedValue([
      { id: 'photo-1', dataUri: 'PHOTO', type: 'PHOTO' },
    ]);
    bridge.getPhotos.mockResolvedValue([
      { id: 'legacy-photo-1', dataUri: 'LEGACY_PHOTO' },
    ]);
    bridge.getPhotos.openPermissionDialog.mockResolvedValue('denied');
  });

  it('opens the modern selection-focused picker and normalizes its raw base64', async () => {
    await expect(pickOnePhoto()).resolves.toBe('data:image/jpeg;base64,PHOTO');

    expect(bridge.getAlbumItems).toHaveBeenCalledWith({
      maxCount: 2, maxWidth: 1024, base64: true, types: ['PHOTO'],
    });
    expect(bridge.getPhotos).not.toHaveBeenCalled();
  });

  it('uses the permission-wrapped photo API only on older Toss versions', async () => {
    bridge.getAlbumItems.isSupported.mockReturnValueOnce(false);

    await expect(pickOnePhoto()).resolves.toBe('data:image/jpeg;base64,LEGACY_PHOTO');
    expect(bridge.getAlbumItems).not.toHaveBeenCalled();
    expect(bridge.getPhotos).toHaveBeenCalledWith({
      maxCount: 2, maxWidth: 1024, base64: true,
    });
  });

  it.each([
    { code: 'NOT_ALLOWED' },
    new Error('UNSUPPORTED_APP_VERSION'),
    new Error('BRIDGE_UNAVAILABLE'),
    new Error('INVALID_REQUEST: Max items must be higher than 1'),
  ])('recovers from a modern picker compatibility failure through the permission-wrapped picker', async (nativeError) => {
    bridge.getAlbumItems.mockRejectedValueOnce(nativeError);

    await expect(pickOnePhoto()).resolves.toBe('data:image/jpeg;base64,LEGACY_PHOTO');
    expect(bridge.getPhotos).toHaveBeenCalledWith({
      maxCount: 2, maxWidth: 1024, base64: true,
    });
  });

  it('opens the Toss permission dialog and retries the legacy picker when access was denied', async () => {
    bridge.getAlbumItems.mockRejectedValueOnce({ code: 'NOT_ALLOWED' });
    bridge.getPhotos
      .mockRejectedValueOnce({ code: 'NO_PERMISSION' })
      .mockResolvedValueOnce([{ id: 'legacy-photo-1', dataUri: 'AFTER_PERMISSION' }]);
    bridge.getPhotos.openPermissionDialog.mockResolvedValueOnce('allowed');

    await expect(pickOnePhoto()).resolves.toBe('data:image/jpeg;base64,AFTER_PERMISSION');
    expect(bridge.getPhotos.openPermissionDialog).toHaveBeenCalledOnce();
    expect(bridge.getPhotos).toHaveBeenCalledTimes(2);
  });

  it('keeps the permission error when the user declines the recovery dialog', async () => {
    bridge.getAlbumItems.mockRejectedValueOnce({ code: 'NOT_ALLOWED' });
    bridge.getPhotos.mockRejectedValueOnce({ code: 'NO_PERMISSION' });
    bridge.getPhotos.openPermissionDialog.mockResolvedValueOnce('denied');

    await expect(pickOnePhoto()).rejects.toThrow('사진 접근이 꺼져 있어요.');
    expect(bridge.getPhotos.openPermissionDialog).toHaveBeenCalledOnce();
    expect(bridge.getPhotos).toHaveBeenCalledOnce();
  });

  it('keeps an already-prefixed data URI unchanged', async () => {
    bridge.getAlbumItems.mockResolvedValueOnce([
      { id: 'photo-1', dataUri: 'data:image/png;base64,PHOTO', type: 'PHOTO' },
    ]);

    await expect(pickOnePhoto()).resolves.toBe('data:image/png;base64,PHOTO');
  });

  it.each([
    [new Error('INVALID_DATA'), '선택한 사진을 읽지 못했어요. 한 번 더 눌러 다른 사진을 골라주세요.'],
  ])('maps the native album failure %# to a recoverable message', async (nativeError, message) => {
    bridge.getAlbumItems.mockRejectedValueOnce(nativeError);

    const request = pickOnePhoto();
    await expect(request).rejects.toThrow(message);
    await request.catch((error) => expect(isPhotoPickerUnavailableError(error)).toBe(true));
    expect(bridge.getPhotos).not.toHaveBeenCalled();
    expect(bridge.getPhotos.openPermissionDialog).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 'NOT_ALLOWED' }, '사진 접근이 꺼져 있어요. 한 번 더 눌러 기기 사진을 골라주세요.'],
    [{ cause: { errorCode: 'NO_PERMISSION' } }, '사진 접근이 꺼져 있어요. 한 번 더 눌러 기기 사진을 골라주세요.'],
    [new Error('BRIDGE_UNAVAILABLE'), '토스 사진 선택창을 열지 못했어요. 한 번 더 눌러 기기 사진을 골라주세요.'],
  ])('maps the final compatibility picker failure %# to a recoverable message', async (nativeError, message) => {
    bridge.getAlbumItems.mockRejectedValueOnce(nativeError);
    bridge.getPhotos.mockRejectedValueOnce(nativeError);

    const request = pickOnePhoto();
    await expect(request).rejects.toThrow(message);
    await request.catch((error) => expect(isPhotoPickerUnavailableError(error)).toBe(true));
  });

  it('returns null when the native picker is canceled', async () => {
    bridge.getAlbumItems.mockRejectedValueOnce(new Error('USER_CANCELED'));

    await expect(pickOnePhoto()).resolves.toBeNull();
    expect(bridge.getPhotos).not.toHaveBeenCalled();
    expect(bridge.getPhotos.openPermissionDialog).not.toHaveBeenCalled();
  });

  it('returns null when the photo picker returns an empty selection', async () => {
    bridge.getAlbumItems.mockResolvedValueOnce([]);

    await expect(pickOnePhoto()).resolves.toBeNull();
  });

  it('does not open a web input until the user explicitly retries', async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
    bridge.getAlbumItems.mockRejectedValueOnce(new Error('BRIDGE_UNAVAILABLE'));
    bridge.getPhotos.mockRejectedValueOnce(new Error('BRIDGE_UNAVAILABLE'));

    await expect(pickOnePhoto()).rejects.toThrow('한 번 더 눌러 기기 사진을 골라주세요.');
    expect(inputClick).not.toHaveBeenCalled();
  });

  it('keeps waiting for the selected browser file even after the window regains focus', async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const request = pickOnePhotoFromBrowser();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['PHOTO'], 'dog.png', { type: 'image/png' });
    if (!input) throw new Error('browser photo input was not created');

    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));

    await expect(request).resolves.toMatch(/^data:image\/png;base64,/);
    expect(inputClick).toHaveBeenCalledOnce();
  });
});
