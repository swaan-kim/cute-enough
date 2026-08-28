import { beforeEach, describe, expect, it, vi } from 'vitest';

type AlbumPhoto = { id: string; dataUri: string };

const bridge = vi.hoisted(() => {
  const getPhotos = Object.assign(
    vi.fn<(options?: unknown) => Promise<AlbumPhoto[]>>(),
    {
      getPermission: vi.fn(),
      openPermissionDialog: vi.fn(),
    },
  );

  return { getPhotos };
});

vi.mock('@apps-in-toss/web-framework', () => ({
  Device: { getPhotos: bridge.getPhotos },
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

import { pickOnePhoto } from './toss';

describe('pickOnePhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.getPhotos.mockResolvedValue([
      { id: 'photo-1', dataUri: 'data:image/jpeg;base64,PHOTO' },
    ]);
  });

  it('opens the permission-wrapped photo picker directly', async () => {
    await expect(pickOnePhoto()).resolves.toBe('data:image/jpeg;base64,PHOTO');

    expect(bridge.getPhotos).toHaveBeenCalledWith({
      maxCount: 1, maxWidth: 2048, base64: true,
    });
    expect(bridge.getPhotos.getPermission).not.toHaveBeenCalled();
    expect(bridge.getPhotos.openPermissionDialog).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 'NOT_ALLOWED' }, '강아지 사진을 고르려면 사진 접근을 허용해 주세요.'],
    [{ code: 'INVALID_REQUEST' }, '사진 선택 요청을 처리하지 못했어요. 앱을 다시 열고 시도해 주세요.'],
    [new Error('INVALID_DATA'), '선택한 사진을 읽지 못했어요. 다른 사진을 골라 주세요.'],
  ])('maps the native album failure %# to a useful message', async (nativeError, message) => {
    bridge.getPhotos.mockRejectedValueOnce(nativeError);

    await expect(pickOnePhoto()).rejects.toThrow(message);
  });

  it('maps the SDK permission wrapper error without a separate permission preflight', async () => {
    const permissionError = new Error('앨범 읽기 권한이 거부되었어요.');
    permissionError.name = 'fetchAlbumPhotos permission error';
    bridge.getPhotos.mockRejectedValueOnce(permissionError);

    await expect(pickOnePhoto()).rejects.toThrow('강아지 사진을 고르려면 사진 접근을 허용해 주세요.');
    expect(bridge.getPhotos.getPermission).not.toHaveBeenCalled();
  });

  it('returns null when the native picker is canceled', async () => {
    bridge.getPhotos.mockRejectedValueOnce(new Error('USER_CANCELED'));

    await expect(pickOnePhoto()).resolves.toBeNull();
  });

  it('returns null when the photo picker returns an empty selection', async () => {
    bridge.getPhotos.mockResolvedValueOnce([]);

    await expect(pickOnePhoto()).resolves.toBeNull();
  });

  it('does not fall back to a browser file input inside Toss', async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
    bridge.getPhotos.mockRejectedValueOnce(new Error('BRIDGE_UNAVAILABLE'));

    await expect(pickOnePhoto()).rejects.toThrow('사진을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    expect(inputClick).not.toHaveBeenCalled();
  });
});
