import { beforeEach, describe, expect, it, vi } from 'vitest';

type PhotoPermissionStatus = 'notDetermined' | 'denied' | 'allowed';
type PermissionResult = 'denied' | 'allowed';
type AlbumItem = { id: string; dataUri: string; type: 'PHOTO' };

const bridge = vi.hoisted(() => {
  const getAlbumItems = Object.assign(
    vi.fn<(options?: unknown) => Promise<AlbumItem[]>>(),
    { isSupported: vi.fn<() => boolean>() },
  );

  return {
    getAlbumItems,
    getPermission: vi.fn<(permission: unknown) => Promise<PhotoPermissionStatus>>(),
    openPermissionDialog: vi.fn<(permission: unknown) => Promise<PermissionResult>>(),
    requestPermission: vi.fn<(permission: unknown) => Promise<PermissionResult>>(),
  };
});

vi.mock('@apps-in-toss/web-framework', () => ({
  Device: { getAlbumItems: bridge.getAlbumItems },
  getPermission: bridge.getPermission,
  getSchemeUri: vi.fn(),
  openPermissionDialog: bridge.openPermissionDialog,
  requestPermission: bridge.requestPermission,
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
    bridge.getAlbumItems.isSupported.mockReturnValue(true);
    bridge.getPermission.mockResolvedValue('allowed');
    bridge.openPermissionDialog.mockResolvedValue('allowed');
    bridge.requestPermission.mockResolvedValue('allowed');
    bridge.getAlbumItems.mockResolvedValue([
      { id: 'photo-1', dataUri: 'data:image/jpeg;base64,PHOTO', type: 'PHOTO' },
    ]);
  });

  it('opens the album immediately when photo permission is already allowed', async () => {
    await expect(pickOnePhoto()).resolves.toBe('data:image/jpeg;base64,PHOTO');

    expect(bridge.getPermission).toHaveBeenCalledWith({ name: 'photos', access: 'read' });
    expect(bridge.requestPermission).not.toHaveBeenCalled();
    expect(bridge.openPermissionDialog).not.toHaveBeenCalled();
    expect(bridge.getAlbumItems).toHaveBeenCalledWith({
      types: ['PHOTO'], maxCount: 1, maxWidth: 2048, base64: true,
    });
  });

  it('requests first-time photo permission before opening the album', async () => {
    bridge.getPermission.mockResolvedValueOnce('notDetermined');

    await expect(pickOnePhoto()).resolves.toBe('data:image/jpeg;base64,PHOTO');

    expect(bridge.requestPermission).toHaveBeenCalledWith({ name: 'photos', access: 'read' });
    expect(bridge.openPermissionDialog).not.toHaveBeenCalled();
    expect(bridge.getAlbumItems).toHaveBeenCalledOnce();
  });

  it('reopens the permission dialog after a previous denial', async () => {
    bridge.getPermission.mockResolvedValueOnce('denied');

    await expect(pickOnePhoto()).resolves.toBe('data:image/jpeg;base64,PHOTO');

    expect(bridge.openPermissionDialog).toHaveBeenCalledWith({ name: 'photos', access: 'read' });
    expect(bridge.requestPermission).not.toHaveBeenCalled();
    expect(bridge.getAlbumItems).toHaveBeenCalledOnce();
  });

  it.each([
    ['notDetermined', 'requestPermission'],
    ['denied', 'openPermissionDialog'],
  ] as const)('does not open the album when %s permission remains denied', async (status, dialog) => {
    bridge.getPermission.mockResolvedValueOnce(status);
    bridge[dialog].mockResolvedValueOnce('denied');

    await expect(pickOnePhoto()).rejects.toThrow('강아지 사진을 고르려면 사진 접근을 허용해 주세요.');
    expect(bridge.getAlbumItems).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 'NOT_ALLOWED' }, '강아지 사진을 고르려면 사진 접근을 허용해 주세요.'],
    [{ code: 'INVALID_REQUEST' }, '사진 선택 요청을 처리하지 못했어요. 앱을 다시 열고 시도해 주세요.'],
    [new Error('INVALID_DATA'), '선택한 사진을 읽지 못했어요. 다른 사진을 골라 주세요.'],
  ])('maps the native album failure %# to a useful message', async (nativeError, message) => {
    bridge.getAlbumItems.mockRejectedValueOnce(nativeError);

    await expect(pickOnePhoto()).rejects.toThrow(message);
  });

  it('returns null when the native picker is canceled', async () => {
    bridge.getAlbumItems.mockRejectedValueOnce(new Error('USER_CANCELED'));

    await expect(pickOnePhoto()).resolves.toBeNull();
  });

  it('explains unsupported Toss versions without requesting permission', async () => {
    bridge.getAlbumItems.isSupported.mockReturnValueOnce(false);

    await expect(pickOnePhoto()).rejects.toThrow('사진 선택을 사용하려면 토스앱을 최신 버전으로 업데이트해 주세요.');
    expect(bridge.getPermission).not.toHaveBeenCalled();
  });

  it('does not fall back to a browser file input inside Toss', async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
    bridge.getAlbumItems.mockRejectedValueOnce(new Error('BRIDGE_UNAVAILABLE'));

    await expect(pickOnePhoto()).rejects.toThrow('사진을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    expect(inputClick).not.toHaveBeenCalled();
  });
});
