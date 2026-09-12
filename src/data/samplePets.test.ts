import { describe, expect, it } from 'vitest';
import { SAMPLE_PETS } from './samplePets';
import { createHash } from 'node:crypto';
import { canonicalPetDesign } from '../../supabase/functions/_shared/pet-design';
import { PREVIEW_PET_DESIGNS } from './previewPetDesigns';

describe('curated sample pets', () => {
  it('uses one pet id per real dog instead of aliases for each photo', () => {
    expect(SAMPLE_PETS.map((pet) => pet.name).sort()).toEqual(['구르미', '하늘']);
    expect(new Set(SAMPLE_PETS.map((pet) => pet.id)).size).toBe(2);
  });

  it('keeps three Gureumi photos and two Haneul photos under their identities', () => {
    expect(SAMPLE_PETS.find((pet) => pet.name === '구르미')?.photoUrls).toHaveLength(3);
    expect(SAMPLE_PETS.find((pet) => pet.name === '하늘')?.photoUrls).toHaveLength(2);
  });

  it('ships complete preview documents with real canonical hashes', () => {
    for (const design of Object.values(PREVIEW_PET_DESIGNS)) {
      expect(createHash('sha256').update(canonicalPetDesign(design.document), 'utf8').digest('hex')).toBe(design.sha256);
      expect(design.document.nodes.length).toBeGreaterThan(1);
    }
  });
});
