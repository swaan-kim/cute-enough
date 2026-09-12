import { describe, expect, it } from 'vitest';
import { getSubmissionPhotos } from './submissionPhotos';

const photo = (index: number) => `data:image/jpeg;base64,PHOTO${index}`;

describe('submission photos', () => {
  it('keeps all five photos in the chosen order in a separate array', () => {
    const dataUris = Array.from({ length: 5 }, (_, i) => photo(i));
    expect(getSubmissionPhotos({ dataUris })).toEqual(dataUris);
    expect(getSubmissionPhotos({ dataUris })).not.toBe(dataUris);
  });
  it('supports a legacy single photo and an unambiguous cover', () => {
    expect(getSubmissionPhotos({ dataUri: photo(0) })).toEqual([photo(0)]);
    expect(getSubmissionPhotos({ dataUri: photo(0), dataUris: [photo(0), photo(1)] })).toEqual([photo(0), photo(1)]);
  });
  it.each([[], Array.from({ length: 6 }, (_, i) => photo(i)), null, 'PHOTO'])('rejects a missing or excessive photo list: %j', (dataUris) => {
    expect(() => getSubmissionPhotos({ dataUris })).toThrow('최대 5장');
  });
  it.each([undefined, '', null, 3, 'data:image/png;base64,RAW'])('rejects an unprocessed or missing photo: %j', (dataUri) => {
    expect(() => getSubmissionPhotos({ dataUri })).toThrow('사진 처리');
  });
  it('does not silently replace the first photo', () => {
    expect(() => getSubmissionPhotos({ dataUri: photo(1), dataUris: [photo(0)] })).toThrow('대표 사진');
  });
});
