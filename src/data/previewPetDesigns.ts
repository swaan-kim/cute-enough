import type { PublishedPetDesign } from '../types';
import { validatePetDesign } from '../../supabase/functions/_shared/pet-design';
import documents from './previewPetDesigns.json';

/** Static preview fixtures, never a fallback for a production pet ID. */
export const PREVIEW_PET_DESIGNS: Record<keyof typeof documents, PublishedPetDesign> = Object.fromEntries(
  Object.entries(documents).map(([key, design]) => [key, { ...design, document: validatePetDesign(design.document) }]),
) as Record<keyof typeof documents, PublishedPetDesign>;
