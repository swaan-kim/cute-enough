// One-time private migration recipes. Published artwork never reads these IDs.
import type { PetAccessory, PetExpression, PetStyleV1, PetTraitsV1, BrowStyle, TongueShape } from '../types';
import type { PetEarVariant, PetSignature } from '../data/petSignature';
import { normalizePetStyle } from '../lib/petStyle';
import type { BuildPetDesignInput } from '../design/buildPetDesign';
import { createDesignEditor, restoreDesignEditor, type PetDesignEditorState } from '../design/designEditor';
import { validatePetDesign } from '../../supabase/functions/_shared/pet-design';
import type { ReviewCatalogItem, ReviewQueueItem } from './types';
import { getCuratedReviewDraft } from './curatedDrafts';

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
const BROW_STYLES: BrowStyle[] = ['none', 'soft', 'caterpillar', 'angled'];
const TONGUE_SHAPES: TongueShape[] = ['drop', 'round', 'wide', 'side'];

const SAMPLE_EXPRESSIONS: Readonly<Record<string, PetExpression>> = {
  'sample-haneul': { browStyle: 'none', tongueShape: 'wide' },
  'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf003': { browStyle: 'none', tongueShape: 'wide' },
  'sample-gureumi': { browStyle: 'soft', tongueShape: 'round' },
  'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf001': { browStyle: 'soft', tongueShape: 'round' },
};

const DEFAULT_EXPRESSION: PetExpression = { browStyle: 'none', tongueShape: 'drop' };

function hashPetId(petId: string, seed: number) {
  let hash = seed >>> 0;
  for (const character of petId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function getPetExpression(petId?: string): PetExpression {
  if (!petId) return DEFAULT_EXPRESSION;
  const sampleExpression = SAMPLE_EXPRESSIONS[petId];
  if (sampleExpression) return sampleExpression;

  return {
    browStyle: BROW_STYLES[hashPetId(petId, 2166136261) % BROW_STYLES.length],
    tongueShape: TONGUE_SHAPES[hashPetId(petId, 3339675911) % TONGUE_SHAPES.length],
  };
}

const DRAFT_SIGNATURES: Readonly<Record<string, BuildPetDesignInput['signature']>> = {
  'dc852ee9-b0dd-4090-a4f0-c5014bf70d2b': 'chocolate-cookie',
  '617f58af-0866-4955-a290-91d57ebd6a25': 'black-sunglasses',
  'd830288c-8499-4093-a202-5e05f9bff3be': 'strawberry-milk',
  '9abe3197-ca76-4681-ae2c-b37cc9b4f3a6': 'chive-bundle',
  '9372e013-c676-4832-951f-17e45cb8a9c4': 'chew-bone',
  '08a244a0-bb9e-4ca7-9dce-ca9ad6508b9c': 'cheese-wedge',
  'd5e1c8c1-4d66-4c6e-a0fe-2dc98c9bf001': 'cloud-cotton-candy',
};

export function getReviewFixedAccessoryLabel(petId: string): string | undefined {
  const signature = DRAFT_SIGNATURES[petId];
  if (signature === 'cheese-wedge') return '삼각 치즈';
  if (signature === 'cloud-cotton-candy') return '구름 솜사탕 · 하늘색 스카프';
  return undefined;
}

export function makeReviewDesignInput(petId: string | undefined, traits: PetTraitsV1, style?: PetStyleV1, accessory?: PetAccessory | null): BuildPetDesignInput {
  const resolvedStyle = normalizePetStyle(traits, style);
  const signature = (petId ? DRAFT_SIGNATURES[petId] : undefined) ?? getPetSignature(petId);
  return {
    traits, style: resolvedStyle, expression: resolvedStyle.expression ?? getPetExpression(petId),
    signature, earVariant: getPetEarVariant(petId), accessory: signature === 'cheese-wedge' ? undefined : accessory ?? undefined,
  };
}

export function createReviewEditor(item: ReviewQueueItem | ReviewCatalogItem): PetDesignEditorState {
  if (item.draftDesign?.editorState?.editor) {
    return { ...restoreDesignEditor(item.draftDesign.editorState.editor), document: validatePetDesign(item.draftDesign.document) };
  }
  if ('publishedEditorState' in item && item.publishedEditorState?.editor) {
    const state = restoreDesignEditor(item.publishedEditorState.editor);
    return item.publishedDesign ? { ...state, document: validatePetDesign(item.publishedDesign.document) } : state;
  }
  const published = 'publishedDesign' in item ? item.publishedDesign?.document : undefined;
  const curated = 'submittedTraits' in item ? getCuratedReviewDraft(item) : undefined;
  const traits = curated?.traits ?? ('submittedTraits' in item ? item.submittedTraits : item.traits);
  const style = curated?.style ?? ('submittedStyle' in item ? item.submittedStyle : item.publishedStyle);
  return createDesignEditor(makeReviewDesignInput(item.petId, traits, style, item.publishedAccessory), published);
}
