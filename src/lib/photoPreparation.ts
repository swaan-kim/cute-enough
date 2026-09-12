/** A single encounter's disposable image buffer, never a photo-access grant. */
export type PreparedPhoto = {
  petId: string;
  photoId: string;
  photoUrl: string;
  signedUrlExpiresAt: string;
  photoCaption?: string;
};

type Photo = { photoId?: string; photoUrl: string; signedUrlExpiresAt?: string };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PREPARE_AGE_MS = 5 * 60_000;
const IMAGE_LOAD_ERROR = '사진을 불러오지 못했어요. 다시 불러와 주세요.';
const IMAGE_TOO_LARGE_ERROR = '사진이 너무 커서 불러오지 못했어요.';

export function createPhotoPreparation(petId: string, requestId: string) {
  let disposed = false;
  let started = false;
  let prepared: { photo: PreparedPhoto; deadline: number; image: Promise<string> } | undefined;
  let finalImage: { photoUrl: string; image: Promise<string> } | undefined;
  let preparationExpiry: ReturnType<typeof setTimeout> | undefined;
  const controllers = new Set<AbortController>();
  const objectUrls = new Set<string>();
  const abortError = () => new DOMException('사진 준비를 취소했어요.', 'AbortError');

  function clearPreparationExpiry() {
    clearTimeout(preparationExpiry);
    preparationExpiry = undefined;
  }

  function releaseImages() {
    clearPreparationExpiry();
    for (const controller of controllers) controller.abort();
    controllers.clear();
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
    prepared = undefined;
  }

  async function download(photoUrl: string): Promise<string> {
    if (disposed) throw abortError();
    const controller = new AbortController();
    controllers.add(controller);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 12_000);
    let objectUrl: string | undefined;
    try {
      const response = await fetch(photoUrl, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(IMAGE_LOAD_ERROR);
      if (Number(response.headers.get('Content-Length')) > MAX_IMAGE_BYTES) throw new Error(IMAGE_TOO_LARGE_ERROR);
      const blob = await response.blob();
      if (!blob.size || blob.size > MAX_IMAGE_BYTES || !blob.type.startsWith('image/')) throw new Error('사진을 불러오지 못했어요.');
      if (disposed || controller.signal.aborted) throw abortError();
      objectUrl = URL.createObjectURL(blob);
      objectUrls.add(objectUrl);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        const abort = () => { image.src = ''; finish(abortError()); };
        const finish = (error?: unknown) => {
          image.onload = null; image.onerror = null;
          controller.signal.removeEventListener('abort', abort);
          if (error) reject(error); else resolve();
        };
        controller.signal.addEventListener('abort', abort, { once: true });
        image.onerror = () => finish(new Error(IMAGE_LOAD_ERROR));
        if (typeof image.decode !== 'function') image.onload = () => finish();
        image.src = objectUrl!;
        if (typeof image.decode === 'function') void image.decode().then(() => finish(), (error) => finish(error));
        if (controller.signal.aborted) abort();
      });
      if (disposed || controller.signal.aborted) throw abortError();
      return objectUrl;
    } catch (error) {
      if (objectUrl && objectUrls.delete(objectUrl)) URL.revokeObjectURL(objectUrl);
      if (disposed || (controller.signal.aborted && !timedOut)) throw abortError();
      if (timedOut) throw new Error('사진을 불러오는 데 시간이 오래 걸려요. 다시 불러와 주세요.');
      // Native fetch/blob/decode errors are browser-dependent and may be in
      // English. Only intentional cancellation should look like cancellation.
      throw new Error(error instanceof Error && error.message === IMAGE_TOO_LARGE_ERROR ? IMAGE_TOO_LARGE_ERROR : IMAGE_LOAD_ERROR);
    } finally {
      clearTimeout(timeout);
      controllers.delete(controller);
    }
  }

  return {
    petId, requestId,
    prefetch(load: (signal: AbortSignal) => Promise<PreparedPhoto>) {
      if (started || disposed) return;
      started = true;
      const controller = new AbortController();
      controllers.add(controller);
      void load(controller.signal).then((photo) => {
        const deadline = Math.min(Date.parse(photo.signedUrlExpiresAt), Date.now() + MAX_PREPARE_AGE_MS);
        if (disposed || controller.signal.aborted || photo.petId !== petId || !photo.photoId || !(deadline > Date.now())) return;
        const image = download(photo.photoUrl);
        const candidate = { photo, deadline, image };
        prepared = candidate;
        // Expire an abandoned preparation even if the user never finishes or
        // leaves. A committed/displayed image instead lives until close/dispose.
        preparationExpiry = setTimeout(() => {
          if (prepared === candidate) releaseImages();
        }, Math.max(0, deadline - Date.now()));
        // A failed speculative fetch is silent; final authorization still runs.
        void image.catch(() => undefined);
      }).catch(() => undefined).finally(() => controllers.delete(controller));
    },
    async resolve(photo: Photo): Promise<string> {
      if (disposed) throw abortError();
      const candidate = prepared;
      if (candidate && photo.photoId === candidate.photo.photoId && candidate.deadline > Date.now()) {
        try {
          const url = await candidate.image;
          if (disposed) throw abortError();
          if (prepared === candidate && candidate.deadline > Date.now()) {
            clearPreparationExpiry();
            prepared = undefined;
            finalImage = { photoUrl: photo.photoUrl, image: Promise.resolve(url) };
            return url;
          }
        } catch { if (disposed) throw abortError(); }
      }
      if (!finalImage || finalImage.photoUrl !== photo.photoUrl) {
        // A changed/expired candidate must not keep downloading beside the final photo.
        releaseImages();
        finalImage = { photoUrl: photo.photoUrl, image: download(photo.photoUrl) };
      }
      return finalImage.image;
    },
    dispose() {
      disposed = true;
      releaseImages();
      finalImage = undefined;
    },
  };
}

export type PhotoPreparation = ReturnType<typeof createPhotoPreparation>;
