import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const runtime = vi.hoisted(() => ({
  isPreviewRuntime: false,
  runtimeEnvironment: 'private',
  shareOgUrl: 'https://example.com/share.png',
}));

vi.mock('@apps-in-toss/web-framework', () => ({
  Device: { getAlbumItems: bridge.getAlbumItems, getPhotos: bridge.getPhotos },
  FetchAlbumPhotosPermissionError: class FetchAlbumPhotosPermissionError extends Error {},
  getSchemeUri: vi.fn(),
  Share: { createLink: vi.fn(), sendMessage: vi.fn() },
  User: {
    getAnonymousKey: Object.assign(vi.fn(), { isSupported: vi.fn(() => true) }),
  },
}));

vi.mock('./runtime', () => runtime);

import { isPhotoPickerUnavailableError, pickOnePhoto, pickOnePhotoFromBrowser, pickPhotos, pickPhotosFromBrowser } from './toss';

afterEach(() => {
  vi.restoreAllMocks();
  runtime.isPreviewRuntime = false;
  document.querySelectorAll('input[type="file"]').forEach((input) => input.remove());
});

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

  it('returns every native selection in order, using a five-photo limit by default', async () => {
    bridge.getAlbumItems.mockResolvedValueOnce([
      { id: 'one', dataUri: 'FIRST', type: 'PHOTO' },
      { id: 'two', dataUri: 'data:image/png;base64,SECOND', type: 'PHOTO' },
      { id: 'three', dataUri: 'THIRD', type: 'PHOTO' },
      { id: 'four', dataUri: 'FOURTH', type: 'PHOTO' },
      { id: 'five', dataUri: 'FIFTH', type: 'PHOTO' },
    ]);

    await expect(pickPhotos()).resolves.toEqual([
      'data:image/jpeg;base64,FIRST', 'data:image/png;base64,SECOND',
      'data:image/jpeg;base64,THIRD', 'data:image/jpeg;base64,FOURTH', 'data:image/jpeg;base64,FIFTH',
    ]);
    expect(bridge.getAlbumItems).toHaveBeenCalledWith({
      maxCount: 5, maxWidth: 1024, base64: true, types: ['PHOTO'],
    });
  });

  it.each([[1, 2], [3, 3], [5, 5], [9, 5]])('uses Android-compatible native limits for a capacity of %i', async (capacity, nativeLimit) => {
    await pickPhotos(capacity);

    expect(bridge.getAlbumItems).toHaveBeenCalledWith(expect.objectContaining({ maxCount: nativeLimit }));
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects an invalid capacity %s before opening the picker', async (capacity) => {
    await expect(pickPhotos(capacity)).rejects.toThrow('사진은 1장 이상, 최대 5장까지 선택할 수 있어요.');
    expect(bridge.getAlbumItems).not.toHaveBeenCalled();
    expect(bridge.getPhotos).not.toHaveBeenCalled();
  });

  it.each([1, 3, 5])('rejects all photos when the bridge exceeds the remaining capacity of %i', async (capacity) => {
    bridge.getAlbumItems.mockResolvedValueOnce(Array.from({ length: capacity + 1 }, (_, index) => ({
      id: String(index), dataUri: `PHOTO_${index}`, type: 'PHOTO',
    })));

    const request = pickPhotos(capacity);
    await expect(request).rejects.toThrow(`사진은 최대 ${capacity}장까지 선택할 수 있어요.`);
    await request.catch((error) => expect(isPhotoPickerUnavailableError(error)).toBe(false));
    expect(bridge.getPhotos).not.toHaveBeenCalled();
  });

  it('does not silently drop the second image when using the single-photo compatibility wrapper', async () => {
    bridge.getAlbumItems.mockResolvedValueOnce([
      { id: 'one', dataUri: 'FIRST', type: 'PHOTO' },
      { id: 'two', dataUri: 'SECOND', type: 'PHOTO' },
    ]);

    await expect(pickOnePhoto()).rejects.toThrow('사진은 최대 1장까지 선택할 수 있어요.');
  });

  it('rejects the complete native selection if a later image is unreadable', async () => {
    bridge.getAlbumItems.mockResolvedValueOnce([
      { id: 'one', dataUri: 'FIRST', type: 'PHOTO' },
      { id: 'two', dataUri: '', type: 'PHOTO' },
    ]);

    await expect(pickPhotos()).rejects.toThrow('선택한 사진을 읽지 못했어요.');
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

  it('preserves the capacity and all photos through permission recovery', async () => {
    bridge.getAlbumItems.mockRejectedValueOnce({ code: 'NOT_ALLOWED' });
    bridge.getPhotos
      .mockRejectedValueOnce({ code: 'NO_PERMISSION' })
      .mockResolvedValueOnce([
        { id: 'one', dataUri: 'FIRST' }, { id: 'two', dataUri: 'SECOND' },
      ]);
    bridge.getPhotos.openPermissionDialog.mockResolvedValueOnce('allowed');

    await expect(pickPhotos(3)).resolves.toEqual([
      'data:image/jpeg;base64,FIRST', 'data:image/jpeg;base64,SECOND',
    ]);
    expect(bridge.getPhotos).toHaveBeenNthCalledWith(1, { maxCount: 3, maxWidth: 1024, base64: true });
    expect(bridge.getPhotos).toHaveBeenNthCalledWith(2, { maxCount: 3, maxWidth: 1024, base64: true });
  });

  it('rejects a legacy over-selection without asking for browser fallback', async () => {
    bridge.getAlbumItems.isSupported.mockReturnValueOnce(false);
    bridge.getPhotos.mockResolvedValueOnce([
      { id: 'one', dataUri: 'FIRST' }, { id: 'two', dataUri: 'SECOND' },
    ]);

    const request = pickPhotos(1);
    await expect(request).rejects.toThrow('사진은 최대 1장까지 선택할 수 있어요.');
    await request.catch((error) => expect(isPhotoPickerUnavailableError(error)).toBe(false));
  });

  it('returns an empty selection when the picker is canceled after allowing photo access', async () => {
    bridge.getAlbumItems.mockRejectedValueOnce({ code: 'NOT_ALLOWED' });
    bridge.getPhotos
      .mockRejectedValueOnce({ code: 'NO_PERMISSION' })
      .mockRejectedValueOnce({ code: 'CANCELED' });
    bridge.getPhotos.openPermissionDialog.mockResolvedValueOnce('allowed');

    await expect(pickPhotos()).resolves.toEqual([]);
    expect(bridge.getPhotos).toHaveBeenCalledTimes(2);
  });

  it('returns an empty selection when the permission recovery dialog is canceled', async () => {
    bridge.getAlbumItems.mockRejectedValueOnce({ code: 'NOT_ALLOWED' });
    bridge.getPhotos.mockRejectedValueOnce({ code: 'NO_PERMISSION' });
    bridge.getPhotos.openPermissionDialog.mockRejectedValueOnce({ code: 'USER_CANCELED' });

    await expect(pickPhotos()).resolves.toEqual([]);
    expect(bridge.getPhotos).toHaveBeenCalledOnce();
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

  it.each(['CANCELED', 'CANCELLED', 'USER_CANCELED'])('returns an empty selection for native %s without fallback', async (code) => {
    bridge.getAlbumItems.mockRejectedValueOnce({ code });

    await expect(pickPhotos()).resolves.toEqual([]);
    expect(bridge.getPhotos).not.toHaveBeenCalled();
  });

  it('returns an empty array for an empty native selection', async () => {
    bridge.getAlbumItems.mockResolvedValueOnce([]);
    await expect(pickPhotos()).resolves.toEqual([]);
  });

  it('returns an empty array when the legacy picker is canceled', async () => {
    bridge.getAlbumItems.isSupported.mockReturnValueOnce(false);
    bridge.getPhotos.mockRejectedValueOnce({ code: 'CANCELED' });

    await expect(pickPhotos()).resolves.toEqual([]);
    expect(bridge.getPhotos.openPermissionDialog).not.toHaveBeenCalled();
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

function selectBrowserFiles(files: File[]): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('browser photo input was not created');
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  input.dispatchEvent(new Event('change'));
  return input;
}

function controlFileReaders() {
  const readers: FileReader[] = [];
  vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
    Object.defineProperty(this, 'readyState', { configurable: true, value: FileReader.LOADING });
    readers.push(this);
  });
  const complete = (index: number, result: string) => {
    const reader = readers[index];
    Object.defineProperty(reader, 'result', { configurable: true, value: result });
    Object.defineProperty(reader, 'readyState', { configurable: true, value: FileReader.DONE });
    reader.dispatchEvent(new ProgressEvent('load'));
  };
  return { readers, complete };
}

describe('pickPhotosFromBrowser', () => {
  beforeEach(() => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('enables multiple selection and preserves file order when reads finish out of order', async () => {
    const { readers, complete } = controlFileReaders();
    const request = pickPhotosFromBrowser();
    const input = selectBrowserFiles([
      new File(['one'], 'one.png', { type: 'image/png' }),
      new File(['two'], 'two.jpg', { type: 'image/jpg' }),
      new File(['three'], 'three.webp', { type: 'image/webp' }),
    ]);
    expect(input.multiple).toBe(true);
    expect(readers).toHaveLength(3);
    complete(2, 'data:image/webp;base64,THIRD');
    complete(0, 'data:image/png;base64,FIRST');
    expect(input.isConnected).toBe(true);
    complete(1, 'data:image/jpg;base64,SECOND');

    await expect(request).resolves.toEqual([
      'data:image/png;base64,FIRST', 'data:image/jpeg;base64,SECOND', 'data:image/webp;base64,THIRD',
    ]);
    expect(input.isConnected).toBe(false);
    expect(readers.every((reader) => reader.onload === null && reader.onerror === null && reader.onabort === null)).toBe(true);
  });

  it('accepts five files in a single selection', async () => {
    const request = pickPhotosFromBrowser();
    selectBrowserFiles(Array.from({ length: 5 }, (_, index) => new File([String(index)], `${index}.png`, { type: 'image/png' })));

    await expect(request).resolves.toHaveLength(5);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it.each([1, 3, 5, 9])('validates the full count before reading, for a capacity of %i', async (capacity) => {
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const request = pickPhotosFromBrowser(capacity);
    const limit = Math.min(capacity, 5);
    const input = selectBrowserFiles(Array.from({ length: limit + 1 }, (_, index) => new File(['photo'], `${index}.png`, { type: 'image/png' })));

    await expect(request).rejects.toThrow(`사진은 최대 ${limit}장까지 선택할 수 있어요.`);
    expect(read).not.toHaveBeenCalled();
    expect(input.isConnected).toBe(false);
  });

  it.each([
    new File(['bad'], 'bad.pdf', { type: 'application/pdf' }),
    new File(['bad'], 'bad.png', { type: 'image/gif' }),
    new File(['bad'], 'bad.heic', { type: '' }),
  ])('checks every file format before starting any read', async (badFile) => {
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const request = pickPhotosFromBrowser();
    const input = selectBrowserFiles([new File(['photo'], 'good.png', { type: 'image/png' }), badFile]);

    await expect(request).rejects.toThrow('JPG, PNG 또는 WEBP 사진만 올릴 수 있어요.');
    expect(read).not.toHaveBeenCalled();
    expect(input.isConnected).toBe(false);
  });

  it('accepts a supported extension when a browser omits the MIME type', async () => {
    const request = pickPhotosFromBrowser();
    selectBrowserFiles([new File(['photo'], 'dog.JPG')]);

    await expect(request).resolves.toEqual([expect.stringMatching(/^data:image\/jpeg;base64,/)]);
  });

  it('returns an empty array and removes the input on cancel', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const request = pickPhotosFromBrowser();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    input?.dispatchEvent(new Event('cancel'));

    await expect(request).resolves.toEqual([]);
    expect(read).not.toHaveBeenCalled();
    expect(input?.isConnected).toBe(false);
  });

  it('returns an empty array for a change with no selected files', async () => {
    const request = pickPhotosFromBrowser();
    const input = selectBrowserFiles([]);
    await expect(request).resolves.toEqual([]);
    expect(input.isConnected).toBe(false);
  });

  it.each(['error', 'abort'])('rejects the entire batch and cleans up pending reads on %s', async (eventName) => {
    const { readers } = controlFileReaders();
    const abort = vi.spyOn(FileReader.prototype, 'abort');
    const request = pickPhotosFromBrowser();
    const input = selectBrowserFiles([
      new File(['one'], 'one.png', { type: 'image/png' }),
      new File(['two'], 'two.png', { type: 'image/png' }),
    ]);
    readers[1].dispatchEvent(new ProgressEvent(eventName));

    await expect(request).rejects.toThrow('선택한 사진을 읽지 못했어요.');
    expect(abort).toHaveBeenCalledTimes(2);
    expect(input.isConnected).toBe(false);
    expect(readers.every((reader) => reader.onload === null && reader.onerror === null && reader.onabort === null)).toBe(true);
  });

  it('rejects an unreadable FileReader result', async () => {
    const { complete } = controlFileReaders();
    const request = pickPhotosFromBrowser();
    const input = selectBrowserFiles([new File(['one'], 'one.png', { type: 'image/png' })]);
    complete(0, 'not-a-data-uri');

    await expect(request).rejects.toThrow('선택한 사진을 읽지 못했어요.');
    expect(input.isConnected).toBe(false);
  });

  it('cleans up when reading throws synchronously', async () => {
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(() => { throw new Error('READ_FAILURE'); });
    const request = pickPhotosFromBrowser();
    const input = selectBrowserFiles([new File(['one'], 'one.png', { type: 'image/png' })]);

    await expect(request).rejects.toThrow('선택한 사진을 읽지 못했어요.');
    expect(input.isConnected).toBe(false);
  });

  it('cleans up if the browser cannot open its picker', async () => {
    vi.mocked(HTMLInputElement.prototype.click).mockImplementation(() => { throw new Error('BLOCKED'); });

    await expect(pickPhotosFromBrowser()).rejects.toThrow('기기 사진 선택창을 열지 못했어요.');
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('rejects an invalid capacity without opening an input', async () => {
    await expect(pickPhotosFromBrowser(0)).rejects.toThrow('사진은 1장 이상');
    expect(HTMLInputElement.prototype.click).not.toHaveBeenCalled();
  });

  it('uses the browser batch picker in preview with the requested remaining capacity', async () => {
    runtime.isPreviewRuntime = true;
    const request = pickPhotos(2);
    selectBrowserFiles([
      new File(['one'], 'one.png', { type: 'image/png' }),
      new File(['two'], 'two.png', { type: 'image/png' }),
      new File(['three'], 'three.png', { type: 'image/png' }),
    ]);

    await expect(request).rejects.toThrow('사진은 최대 2장까지 선택할 수 있어요.');
  });

  it('preserves the browser single-photo wrapper cancellation contract', async () => {
    const request = pickOnePhotoFromBrowser();
    document.querySelector('input[type="file"]')?.dispatchEvent(new Event('cancel'));
    await expect(request).resolves.toBeNull();
  });
});
