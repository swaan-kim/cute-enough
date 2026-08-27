import type { PetSummary } from '../types';

export const SAMPLE_PETS: PetSummary[] = [
  {
    id: 'sample-haneul', name: '하늘',
    photoUrl: '/sample-pets/haneul-01.jpg',
    photoUrls: ['/sample-pets/haneul-01.jpg', '/sample-pets/haneul-02.jpg'],
    traits: { schemaVersion: 1, earShape: 'upright', headShape: 'oval', baseColor: 'cream', secondaryColor: 'white', markingPattern: 'blaze', muzzle: 'short', confidence: 1 },
  },
  {
    id: 'sample-gureumi', name: '구르미',
    photoUrl: '/sample-pets/gureumi-01.jpg',
    photoUrls: ['/sample-pets/gureumi-01.jpg', '/sample-pets/gureumi-02.jpg', '/sample-pets/gureumi-03.jpg'],
    traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'medium', confidence: 1 },
  },
];
