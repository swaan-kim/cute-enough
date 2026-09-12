import { describe, expect, it } from 'vitest';
import { SAMPLE_PETS } from '../data/samplePets';
import { createPetPublicationCache } from './petPublicationCache';

const pending = { ...SAMPLE_PETS[0], approvalStatus: 'pending' as const, designVersion: 1, publishedDesign: undefined, isMine: true };
const approved = { ...pending, approvalStatus: 'approved' as const, designVersion: 2,
  publishedDesign: { ...SAMPLE_PETS[0].publishedDesign!, designVersion: 2 }, designStatus: 'ready' as const };

describe('publication cache synchronization', () => {
  it('applies approval to the owner draft while preserving ownership, room slots, and photo access', () => {
    const cache = createPetPublicationCache();
    cache.ingest(approved);
    const result = cache.apply({ ...pending, houseSlot: 4, ownerPhotoAvailable: true, albumPhotoId: 'owned-photo' });
    expect(result).toMatchObject({ publishedDesign: approved.publishedDesign, approvalStatus: 'approved', isMine: true,
      houseSlot: 4, ownerPhotoAvailable: true, albumPhotoId: 'owned-photo' });
  });
  it('cannot let an older home request overwrite an approval already seen in mine', () => {
    const cache = createPetPublicationCache();
    cache.ingest(approved);
    expect(cache.ingest(pending)).toMatchObject({ designVersion: 2, publishedDesign: approved.publishedDesign, approvalStatus: 'approved' });
  });
  it('retains every uploaded pet and does not import another screen membership or photo URL', () => {
    const cache = createPetPublicationCache();
    cache.ingest({ ...approved, isMine: false, photoUrl: '/private.jpg' });
    const history = [pending, { ...pending, id: 'older-upload' }].map(cache.apply);
    expect(history.map((pet) => pet.id)).toEqual([pending.id, 'older-upload']);
    expect(history[0].isMine).toBe(true);
    expect(history[0].photoUrl).toBe(pending.photoUrl);
    expect(history[1].approvalStatus).toBe('pending');
  });
  it('applies a pause without accepting a mismatched fallback drawing', () => {
    const cache = createPetPublicationCache();
    cache.ingest(approved);
    cache.ingest({ ...approved, approvalStatus: 'paused', publishedDesign: undefined, designStatus: 'unavailable' });
    expect(cache.apply(approved)).toMatchObject({ approvalStatus: 'paused', publishedDesign: undefined, designStatus: 'unavailable' });
  });
});
