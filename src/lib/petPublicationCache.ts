import type { PetSummary } from '../types';

const version = (pet: Partial<PetSummary>) => pet.designVersion ?? pet.publishedDesign?.designVersion ?? 1;

/** One user's in-memory publication snapshot; never changes ownership, photos, tickets or room slots. */
export function createPetPublicationCache() {
  const latest = new Map<string, Partial<PetSummary>>();
  const apply = <T extends PetSummary>(pet: T): T => {
    const saved = latest.get(pet.id);
    return saved && version(saved) >= version(pet) ? { ...pet, ...saved } : pet;
  };
  return {
    apply,
    ingest<T extends PetSummary>(pet: T): T {
      const previous = latest.get(pet.id);
      if ((pet.approvalStatus || pet.publishedDesign) && (!previous || version(pet) >= version(previous))) {
        latest.set(pet.id, {
          name: pet.name, traits: pet.traits, publishedStyle: pet.publishedStyle, publishedAccessory: pet.publishedAccessory,
          designVersion: version(pet), publishedDesign: pet.publishedDesign, designStatus: pet.designStatus,
          ...(pet.approvalStatus ? { approvalStatus: pet.approvalStatus } : {}),
        });
      }
      return apply(pet);
    },
  };
}
