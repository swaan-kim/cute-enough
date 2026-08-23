import type { PetSummary } from '../types';

export const SAMPLE_PETS: PetSummary[] = [
  {
    id: 'sample-bori', name: '보리',
    photoUrl: 'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=1200&q=86',
    traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'caramel', secondaryColor: 'cream', markingPattern: 'brow', muzzle: 'short', confidence: 0.96 },
  },
  {
    id: 'sample-mandu', name: '만두',
    photoUrl: 'https://images.unsplash.com/photo-1537151625747-768eb6cf92b2?auto=format&fit=crop&w=1200&q=86',
    traits: { schemaVersion: 1, earShape: 'semi', headShape: 'round', baseColor: 'white', secondaryColor: 'caramel', markingPattern: 'mask', muzzle: 'medium', confidence: 0.94 },
  },
  {
    id: 'sample-kong', name: '콩이',
    photoUrl: 'https://images.unsplash.com/photo-1558788353-f76d92427f16?auto=format&fit=crop&w=1200&q=86',
    traits: { schemaVersion: 1, earShape: 'upright', headShape: 'oval', baseColor: 'black', secondaryColor: 'caramel', markingPattern: 'brow', muzzle: 'long', confidence: 0.92 },
  },
  {
    id: 'sample-dubu', name: '두부',
    photoUrl: 'https://images.unsplash.com/photo-1518717758536-85ae29035b6d?auto=format&fit=crop&w=1200&q=86',
    traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'oval', baseColor: 'cream', secondaryColor: 'white', markingPattern: 'blaze', muzzle: 'medium', confidence: 0.95 },
  },
  {
    id: 'sample-maru', name: '마루',
    photoUrl: 'https://images.unsplash.com/photo-1517423440428-a5a00ad493e8?auto=format&fit=crop&w=1200&q=86',
    traits: { schemaVersion: 1, earShape: 'upright', headShape: 'round', baseColor: 'gray', secondaryColor: 'white', markingPattern: 'spots', muzzle: 'short', confidence: 0.91 },
  },
];
