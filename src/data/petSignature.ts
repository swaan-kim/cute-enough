export type PetSignature =
  | 'sky-bandana'
  | 'peach-hairpin'
  | 'mint-collar'
  | 'lemon-star'
  | 'milk-carton'
  | 'gray-backpack'
  | 'birthday-star';
export type PetEarVariant = 'high-floppy' | 'soft-upright';

interface CuratedPetVisual {
  signature: PetSignature;
  earVariant?: PetEarVariant;
}

/** 직접 사진 제공과 사용 허락을 확인한 초기 강아지만 수동으로 등록해요. */
const CURATED_PET_VISUALS: Readonly<Record<string, CuratedPetVisual>> = {
  'sample-haneul': { signature: 'peach-hairpin', earVariant: 'soft-upright' },
  'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf003': { signature: 'peach-hairpin', earVariant: 'soft-upright' },
  'sample-gureumi': { signature: 'sky-bandana', earVariant: 'high-floppy' },
  'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf001': { signature: 'sky-bandana', earVariant: 'high-floppy' },
  // 초기 등록 강아지 우유에게만 보이는 전용 우유팩이에요.
  'bfd77d46-e3e7-45d9-ab2c-09692c6a4734': { signature: 'milk-carton' },
  // 초기 등록 강아지 티티와 배추의 사진에서 가져온 전용 포인트예요.
  '36d0b0eb-32b6-48d7-b505-31a58d4bf4f7': { signature: 'gray-backpack' },
  'fb1bca0b-3fbb-4b51-a392-c99866f6195d': { signature: 'birthday-star' },
};

export function getPetSignature(petId?: string): PetSignature | undefined {
  return petId ? CURATED_PET_VISUALS[petId]?.signature : undefined;
}

export function getPetEarVariant(petId?: string): PetEarVariant | undefined {
  return petId ? CURATED_PET_VISUALS[petId]?.earVariant : undefined;
}
