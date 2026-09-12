type UploadedPhoto = { dataUri: string; receipt: string; uploadedAt: number };
type UploadPhoto = (input: { action: 'submitPhoto'; submissionId: string; photoIndex: number; dataUri: string }) => Promise<{ photoReceipt: string }>;

// Memory only: private photo data and receipts must not persist in browser storage.
// Server receipts expire after 24h; reuse for at most 1h and retain only 3 attempts.
const attempts = new Map<string, Array<UploadedPhoto | undefined>>();
const REUSE_MS = 60 * 60 * 1000;

export function forgetSubmissionPhotos(submissionId: string) {
  attempts.delete(submissionId);
}

/** Resume completed stages without combining five image decodes in one Edge request. */
export async function uploadSubmissionPhotos(submissionId: string, photos: string[], uploadPhoto: UploadPhoto): Promise<string[]> {
  const uploaded = attempts.get(submissionId) ?? [];
  attempts.delete(submissionId);
  attempts.set(submissionId, uploaded);
  while (attempts.size > 3) attempts.delete(attempts.keys().next().value!);
  uploaded.length = photos.length;
  const receipts: string[] = [];
  for (const [photoIndex, dataUri] of photos.entries()) {
    let cached = uploaded[photoIndex];
    if (!cached || cached.dataUri !== dataUri || Date.now() - cached.uploadedAt >= REUSE_MS) {
      const result = await uploadPhoto({ action: 'submitPhoto', submissionId, photoIndex, dataUri });
      if (typeof result?.photoReceipt !== 'string' || !result.photoReceipt) {
        throw new Error('사진 전송 결과를 확인하지 못했어요. 다시 시도해 주세요.');
      }
      cached = { dataUri, receipt: result.photoReceipt, uploadedAt: Date.now() };
      uploaded[photoIndex] = cached;
    }
    receipts.push(cached.receipt);
  }
  return receipts;
}
