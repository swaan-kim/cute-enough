import type { PetSummary } from '../types';
import { PREVIEW_PET_DESIGNS as previewDesigns } from './previewPetDesigns';

export const SAMPLE_PETS: PetSummary[] = [
  {
    id: 'sample-haneul', name: '하늘',
    publishedDesign: previewDesigns['sample-haneul'], designVersion: 1, designStatus: 'ready',
    photoUrl: '/sample-pets/haneul-01.jpg',
    photoUrls: ['/sample-pets/haneul-01.jpg', '/sample-pets/haneul-02.jpg'],
    traits: { schemaVersion: 1, earShape: 'upright', headShape: 'oval', baseColor: 'cream', secondaryColor: 'white', markingPattern: 'blaze', muzzle: 'short', confidence: 1 },
  },
  {
    id: 'sample-gureumi', name: '구르미',
    publishedDesign: previewDesigns['sample-gureumi'], designVersion: 1, designStatus: 'ready',
    photoUrl: '/sample-pets/gureumi-01.jpg',
    photoUrls: ['/sample-pets/gureumi-01.jpg', '/sample-pets/gureumi-02.jpg', '/sample-pets/gureumi-03.jpg'],
    traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'medium', confidence: 1 },
  },
];
