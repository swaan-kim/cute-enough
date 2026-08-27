export type PetSignature = 'sky-bandana' | 'peach-hairpin' | 'mint-collar' | 'lemon-star';
export type PetEarVariant = 'high-floppy' | 'soft-upright';

interface CuratedPetVisual {
  signature: PetSignature;
  earVariant: PetEarVariant;
}

/** 직접 사진 제공과 사용 허락을 확인한 초기 강아지만 수동으로 등록해요. */
const CURATED_PET_VISUALS: Readonly<Record<string, CuratedPetVisual>> = {
  'sample-haneul': { signature: 'peach-hairpin', earVariant: 'soft-upright' },
  'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf003': { signature: 'peach-hairpin', earVariant: 'soft-upright' },
  'sample-gureumi': { signature: 'sky-bandana', earVariant: 'high-floppy' },
  'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf001': { signature: 'sky-bandana', earVariant: 'high-floppy' },
};

export function getPetSignature(petId?: string): PetSignature | undefined {
  return petId ? CURATED_PET_VISUALS[petId]?.signature : undefined;
}

export function getPetEarVariant(petId?: string): PetEarVariant | undefined {
  return petId ? CURATED_PET_VISUALS[petId]?.earVariant : undefined;
}
