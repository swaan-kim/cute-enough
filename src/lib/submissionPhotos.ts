export const MAX_SUBMISSION_PHOTOS = 5;

/** Preserve selection order; dataUri is accepted only for older one-photo callers. */
export function getSubmissionPhotos(input: { dataUri?: unknown; dataUris?: unknown }): string[] {
  const photos = input.dataUris === undefined ? [input.dataUri] : input.dataUris;
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > MAX_SUBMISSION_PHOTOS) {
    throw new Error('강아지 사진은 1장부터 최대 5장까지 올릴 수 있어요.');
  }
  if (photos.some((photo) => typeof photo !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo))) {
    throw new Error('사진 처리를 마친 뒤 다시 등록해 주세요.');
  }
  if (input.dataUris !== undefined && input.dataUri !== undefined && input.dataUri !== photos[0]) {
    throw new Error('대표 사진이 달라졌어요. 사진을 다시 확인해 주세요.');
  }
  return [...photos];
}
